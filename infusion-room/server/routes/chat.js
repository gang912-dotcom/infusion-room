import { Router } from 'express'
import db from '../db.js'

const router = Router()

// ─── 전체 채팅방 ─────────────────────────────────────────────────────
// 계정 전원이 같은 방 하나를 본다. 읽음 확인도, 방 목록도 없다(게임 채팅창).
// 쪽지(messages)와 다른 것이다 — 쪽지는 1:1이고 10분 뒤 화면에서 사라진다.
//
// 실시간은 폴링으로 낸다. 창이 열려 있으면 클라가 2초마다 since 이후만 받아가고,
// 닫혀 있으면 보드 폴링(3초)에 실려 오는 latest_id로 배지만 띄운다 → 요청이 늘지 않는다.
const MAX_CONTENT_LENGTH = 500

// 채팅창은 **당일 것만** 보여준다. 지난 대화는 관리 페이지에서 날짜별로 본다.
// 자정 기준은 서버 로컬 시각이다(운영 PC가 KST고, 근무자가 말하는 '오늘'과 같아야 한다).
function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 지운 것은 채팅창에서 빠진다. 관리 페이지에서는 '삭제됨'으로 남는다.
const todayStmt = db.prepare(`
  SELECT c.id, c.account_id, a.display_name AS author, a.role, c.content, c.created_at
  FROM chat_messages c JOIN accounts a ON a.id = c.account_id
  WHERE c.id > ? AND c.created_at >= ? AND c.deleted = 0
  ORDER BY c.id ASC
`)

const insertStmt = db.prepare(
  'INSERT INTO chat_messages (account_id, content, created_at) VALUES (?, ?, ?)',
)

// 배지용 최신 id도 '당일 + 안 지워진 것' 기준이어야 화면과 어긋나지 않는다.
const latestIdStmt = db.prepare(
  'SELECT COALESCE(MAX(id), 0) m FROM chat_messages WHERE created_at >= ? AND deleted = 0',
)

// 당일 지워진 id 목록. 폴링은 '새 메시지'만 가져오므로 이게 없으면 관리자가 지운 뒤에도
// 이미 열려 있는 다른 채팅창에는 그 줄이 그대로 남는다(새로고침해야 사라진다).
// 당일 것만이라 목록이 길어질 일이 없다.
const deletedIdsStmt = db.prepare(
  'SELECT id FROM chat_messages WHERE created_at >= ? AND deleted = 1',
)

// 공지는 한 줄이고 이력이 필요 없어 settings에 둔다(테이블을 새로 만들 이유가 없다).
const NOTICE_KEYS = { text: 'chat_notice', by: 'chat_notice_by', at: 'chat_notice_at' }
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
const putSettingStmt = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)

function readNotice() {
  const text = getSettingStmt.get(NOTICE_KEYS.text)?.value ?? ''
  if (!text) return null
  return {
    text,
    by: getSettingStmt.get(NOTICE_KEYS.by)?.value ?? '',
    at: Number(getSettingStmt.get(NOTICE_KEYS.at)?.value ?? 0) || null,
  }
}

// since를 주면 그 이후만, 안 주면 오늘 것 전부. 항상 오래된 것부터(오름차순).
// day_start를 함께 준다 — 클라가 자정을 넘겼는지 알고 목록을 비울 수 있어야 한다.
router.get('/chat', (req, res) => {
  const since = Number(req.query.since)
  const dayStart = todayStart()
  res.json({
    messages: todayStmt.all(Number.isInteger(since) && since > 0 ? since : 0, dayStart),
    notice: readNotice(),
    latest_id: latestIdStmt.get(dayStart).m,
    day_start: dayStart,
    deleted_ids: deletedIdsStmt.all(dayStart).map((r) => r.id),
  })
})

router.post('/chat', (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  if (!content) return res.status(400).json({ error: '내용을 입력해주세요' })
  if (content.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `${MAX_CONTENT_LENGTH}자까지 보낼 수 있습니다` })
  }
  const info = insertStmt.run(req.account.id, content, Date.now())
  // 보드 revision은 올리지 않는다 — 채팅 한 줄에 전 단말이 보드를 다시 그릴 이유가 없다.
  // 다른 단말은 자기 폴링 주기에 가져간다.
  res.status(201).json({ id: info.lastInsertRowid })
})

// ─── 관리자 전용 ─────────────────────────────────────────────────────
// index.js에서 '/api/admin' + requireAdmin으로 따로 마운트된다.
export const adminChatRouter = Router()

adminChatRouter.put('/chat/notice', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (text.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `${MAX_CONTENT_LENGTH}자까지 쓸 수 있습니다` })
  }
  const now = Date.now()
  db.transaction(() => {
    putSettingStmt.run(NOTICE_KEYS.text, text, now)
    putSettingStmt.run(NOTICE_KEYS.by, req.account.display_name ?? '', now)
    putSettingStmt.run(NOTICE_KEYS.at, String(now), now)
  })()
  // 빈 문자열이면 공지를 내린 것이다(readNotice가 null을 준다).
  res.json({ ok: true, notice: readNotice() })
})

// 날짜 목록 — 관리 페이지의 날짜 선택기가 쓴다. 지운 것도 세어 보여준다
// (그 날 대화가 있었다는 사실 자체가 내역이다).
// localtime으로 묶는다 — 저장은 epoch ms(UTC)지만 사람이 말하는 날짜는 로컬이다.
adminChatRouter.get('/chat/dates', (req, res) => {
  res.json(db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date,
           COUNT(*) AS total,
           SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deleted_count
    FROM chat_messages
    GROUP BY date
    ORDER BY date DESC
  `).all())
})

// 특정 날짜의 전체 대화(지운 것 포함). date는 'YYYY-MM-DD'.
adminChatRouter.get('/chat', (req, res) => {
  const date = String(req.query.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다' })
  }
  res.json(db.prepare(`
    SELECT c.id, c.account_id, a.display_name AS author, a.role, c.content, c.created_at, c.deleted
    FROM chat_messages c JOIN accounts a ON a.id = c.account_id
    WHERE date(c.created_at / 1000, 'unixepoch', 'localtime') = ?
    ORDER BY c.id ASC
  `).all(date))
})

// 선택 삭제 — 소프트다. 채팅창에서는 사라지고 관리 페이지에는 '삭제됨'으로 남는다.
// 되돌리기도 같은 라우트로 한다(deleted: false).
adminChatRouter.post('/chat/deleted', (req, res) => {
  const { ids, deleted } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '대상이 없습니다' })
  }
  if (!ids.every((id) => Number.isInteger(id))) {
    return res.status(400).json({ error: 'ids는 정수 배열이어야 합니다' })
  }
  const stmt = db.prepare('UPDATE chat_messages SET deleted = ? WHERE id = ?')
  const value = deleted === false ? 0 : 1
  db.transaction(() => { for (const id of ids) stmt.run(value, id) })()
  res.json({ ok: true, changed: ids.length, deleted: value === 1 })
})

export default router
