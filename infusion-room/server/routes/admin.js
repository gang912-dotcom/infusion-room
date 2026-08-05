import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { isUniqueConstraintError } from '../lib/validation.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const router = Router()

// ─── accounts ───────────────────────────────────────────────────────
router.get('/accounts', (req, res) => {
  res.json(db.prepare(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM accounts ORDER BY id',
  ).all())
})

router.post('/accounts', (req, res) => {
  const { username, display_name, password, role = 'staff' } = req.body ?? {}
  if (!username || !display_name || !password) {
    return res.status(400).json({ error: 'username, display_name, password가 필요합니다' })
  }
  if (!['staff', 'admin'].includes(role)) {
    return res.status(400).json({ error: '유효하지 않은 role입니다' })
  }

  const now = Date.now()
  try {
    const info = db.prepare(
      `INSERT INTO accounts (username, display_name, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(username, display_name, bcrypt.hashSync(password, 10), role, now, now)
    logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: 'account', targetId: info.lastInsertRowid })
    res.status(201).json({ id: info.lastInsertRowid })
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(409).json({ error: '이미 존재하는 아이디입니다' })
    throw err
  }
})

function countOtherActiveAdmins(excludeId) {
  return db.prepare(
    "SELECT COUNT(*) c FROM accounts WHERE role = 'admin' AND is_active = 1 AND id != ?",
  ).get(excludeId).c
}

router.patch('/accounts/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id)
  if (!account) return res.status(404).json({ error: '존재하지 않는 계정입니다' })

  const { display_name, password, is_active, role } = req.body ?? {}
  if (role !== undefined && !['staff', 'admin'].includes(role)) {
    return res.status(400).json({ error: '유효하지 않은 role입니다' })
  }

  const nextRole = role ?? account.role
  const nextIsActive = is_active !== undefined ? (is_active ? 1 : 0) : account.is_active
  const wasActiveAdmin = account.role === 'admin' && account.is_active === 1
  const staysActiveAdmin = nextRole === 'admin' && nextIsActive === 1
  if (wasActiveAdmin && !staysActiveAdmin && countOtherActiveAdmins(account.id) === 0) {
    return res.status(400).json({ error: '마지막 admin 계정은 비활성화하거나 권한을 변경할 수 없습니다' })
  }

  const fields = []
  const params = []
  if (display_name !== undefined) { fields.push('display_name = ?'); params.push(display_name) }
  if (password) { fields.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)) }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(nextIsActive) }
  if (role !== undefined) { fields.push('role = ?'); params.push(role) }
  if (fields.length === 0) return res.status(400).json({ error: '변경할 값이 없습니다' })

  fields.push('updated_at = ?')
  params.push(Date.now(), account.id)
  db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: 'account', targetId: account.id })
  res.json({ ok: true })
})

// ─── staff ──────────────────────────────────────────────────────────
// 서명 원본(base64)은 일부러 안 싣는다 — 직원 수만큼 수십 KB가 붙으면 목록이 무거워진다.
// 화면은 '등록됨/없음'만 알면 되고, 원본은 GET /staff/:id/signature로 따로 가져간다.
router.get('/staff', (req, res) => {
  res.json(db.prepare(
    'SELECT id, name, is_active, sort_order, (signature IS NOT NULL) AS has_signature FROM staff ORDER BY sort_order',
  ).all())
})

// ─── 직원 자필 서명 ─────────────────────────────────────────────────
// 4b에서 기록지의 라인담당·믹스담당 칸에 이 이미지를 넣는다.
const SIGNATURE_MAX_BYTES = 500 * 1024
const SIGNATURE_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,']

router.put('/staff/:id/signature', (req, res) => {
  const staff = db.prepare('SELECT id FROM staff WHERE id = ?').get(req.params.id)
  if (!staff) return res.status(404).json({ error: '존재하지 않는 직원입니다' })

  const { signature } = req.body ?? {}
  if (signature !== null && typeof signature !== 'string') {
    return res.status(400).json({ error: '서명 형식이 올바르지 않습니다' })
  }
  if (typeof signature === 'string') {
    if (!SIGNATURE_PREFIXES.some((p) => signature.startsWith(p))) {
      return res.status(400).json({ error: 'PNG 또는 JPG 이미지만 등록할 수 있습니다' })
    }
    if (signature.length > SIGNATURE_MAX_BYTES) {
      return res.status(400).json({ error: '서명 이미지가 너무 큽니다 (500KB 이하)' })
    }
  }

  db.prepare('UPDATE staff SET signature = ? WHERE id = ?').run(signature, staff.id)
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: 'staff', targetId: staff.id })
  res.json({ ok: true })
})

router.post('/staff', (req, res) => {
  const { name } = req.body ?? {}
  if (!name) return res.status(400).json({ error: 'name이 필요합니다' })
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM staff').get().m
  const info = db.prepare(
    'INSERT INTO staff (name, is_active, sort_order, created_at) VALUES (?, 1, ?, ?)',
  ).run(name, maxOrder + 1, Date.now())
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: 'staff', targetId: info.lastInsertRowid })
  res.status(201).json({ id: info.lastInsertRowid })
})

router.patch('/staff/:id', (req, res) => {
  const staff = db.prepare('SELECT id FROM staff WHERE id = ?').get(req.params.id)
  if (!staff) return res.status(404).json({ error: '존재하지 않는 직원입니다' })

  const { name, is_active, sort_order } = req.body ?? {}
  const fields = []
  const params = []
  if (name !== undefined) { fields.push('name = ?'); params.push(name) }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(sort_order) }
  if (fields.length === 0) return res.status(400).json({ error: '변경할 값이 없습니다' })

  params.push(staff.id)
  db.prepare(`UPDATE staff SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: 'staff', targetId: staff.id })
  res.json({ ok: true })
})

// ─── 쪽지 로그 (감사) ───────────────────────────────────────────────
// 직원 화면의 10분 휘발과 무관하게 주고받은 전부를 보여준다.
// 내용 수정은 없고 삭제만 가능하다 — 본문을 고칠 수 있으면 감사 기록의 의미가 없어지므로.
router.get('/messages', (req, res) => {
  const { from, to, account, limit = 200, offset = 0 } = req.query ?? {}

  const where = []
  const params = []
  if (account) {
    where.push('(m.from_account = ? OR m.to_account = ?)')
    params.push(Number(account), Number(account))
  }
  // 날짜(YYYY-MM-DD)는 로컬 자정 기준 epoch 범위로. to는 그날 끝까지 포함해야 하므로 +1일.
  if (from) {
    const t = new Date(`${from}T00:00:00`).getTime()
    if (!Number.isNaN(t)) { where.push('m.created_at >= ?'); params.push(t) }
  }
  if (to) {
    const t = new Date(`${to}T00:00:00`).getTime()
    if (!Number.isNaN(t)) { where.push('m.created_at < ?'); params.push(t + 24 * 60 * 60 * 1000) }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) c FROM messages m ${whereSql}`).get(...params).c
  const messages = db.prepare(`
    SELECT m.id, m.from_account, fa.display_name AS from_name,
           m.to_account, ta.display_name AS to_name,
           m.content, m.broadcast_id, m.created_at, m.read_at
    FROM messages m
    JOIN accounts fa ON fa.id = m.from_account
    JOIN accounts ta ON ta.id = m.to_account
    ${whereSql}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset))

  res.json({ messages, total })
})

// ─── settings ───────────────────────────────────────────────────────
// 전체발송 묶음 삭제 — 화면이 broadcast_id로 묶어 '한 건'으로 보여주므로 삭제도 묶음 단위다.
// 수신자마다 row가 하나씩이라 개별로 지우게 하면 8명이면 8번을 눌러야 한다.
// (경로가 3세그먼트라 아래 '/messages/:id'와 겹치지 않는다.)
router.delete('/messages/broadcast/:broadcastId', (req, res) => {
  const info = db.prepare('DELETE FROM messages WHERE broadcast_id = ?').run(req.params.broadcastId)
  if (info.changes === 0) {
    return res.status(404).json({ error: '존재하지 않는 전체발송입니다' })
  }
  logAccess(req, ACTIONS.MESSAGE_DELETE, { targetType: 'message_broadcast' })
  res.json({ ok: true, deleted: info.changes })
})

// 개별 쪽지 삭제 — 소프트 삭제가 아니라 실제 DELETE라 되돌릴 수 없다(사용자 결정).
// 감사 기록을 지우는 행위라 access_logs에 남긴다.
router.delete('/messages/:id', (req, res) => {
  const msg = db.prepare('SELECT id FROM messages WHERE id = ?').get(req.params.id)
  if (!msg) return res.status(404).json({ error: '존재하지 않는 쪽지입니다' })

  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id)
  logAccess(req, ACTIONS.MESSAGE_DELETE, { targetType: 'message', targetId: msg.id })
  res.json({ ok: true })
})

router.get('/settings', (req, res) => {
  res.json(db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all())
})

router.patch('/settings/:key', (req, res) => {
  const setting = db.prepare('SELECT key FROM settings WHERE key = ?').get(req.params.key)
  if (!setting) return res.status(404).json({ error: '존재하지 않는 설정입니다' })

  const { value } = req.body ?? {}
  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'value가 필요합니다' })
  }

  db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(String(value), Date.now(), req.params.key)
  // settings는 키가 문자열이라 INTEGER인 target_id에 못 담는다. 어떤 설정을 바꿨는지는
  // 감사 기록에서 중요한 정보라 target_type에 'setting:<key>' 형태로 붙여 보존한다
  // (스키마 변경 없이. 설정 변경 전체 조회는 target_type LIKE 'setting:%').
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: `setting:${req.params.key}` })
  res.json({ ok: true })
})

// ─── 휴지통 완전삭제 ─────────────────────────────────────────────────
// 소프트삭제(deleted=1)된 세션을 DB에서 실제로 지운다. 되돌릴 수 없다.
// 관리자 전용인 이유: 데이터관리 탭 자체는 모든 근무자가 볼 수 있고, 여기는 복구가 없다.
//
// **deleted=1인 것만 지운다.** 살아 있는 세션 id가 섞여 오면 그건 무시한다 —
// 실수로든 버그로든 진행 중 기록이 사라지는 경로를 만들지 않는다.
//
// 자식 행을 먼저 지워야 한다(foreign_keys = ON). session_notes는 손자
// (session_note_symptoms·session_note_actions)까지 있어 순서가 있다.
const PURGE_CHILDREN = [
  'DELETE FROM session_note_symptoms WHERE note_id IN (SELECT id FROM session_notes WHERE session_id = ?)',
  'DELETE FROM session_note_actions  WHERE note_id IN (SELECT id FROM session_notes WHERE session_id = ?)',
  'DELETE FROM session_notes  WHERE session_id = ?',
  'DELETE FROM rounds         WHERE session_id = ?',
  'DELETE FROM vitals         WHERE session_id = ?',
  'DELETE FROM session_orders WHERE session_id = ?',
]

router.post('/sessions/purge', (req, res) => {
  const { ids } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '지울 대상이 없습니다' })
  }
  if (!ids.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: 'ids는 정수 배열이어야 합니다' })
  }

  const isDeleted = db.prepare('SELECT 1 FROM sessions WHERE id = ? AND deleted = 1')
  const children = PURGE_CHILDREN.map((sql) => db.prepare(sql))
  const removeSession = db.prepare('DELETE FROM sessions WHERE id = ? AND deleted = 1')

  const purged = []
  const skipped = []
  db.transaction(() => {
    for (const id of ids) {
      if (!isDeleted.get(id)) { skipped.push(id); continue }
      for (const stmt of children) stmt.run(id)
      removeSession.run(id)
      purged.push(id)
    }
  })()

  // 되돌릴 수 없는 삭제다 — 건수를 감사 기록에 남긴다(id는 이미 사라져 참조가 무의미).
  logAccess(req, ACTIONS.SESSION_PURGE, { targetType: `count:${purged.length}` })
  res.json({ purged: purged.length, skipped: skipped.length })
})

export default router
