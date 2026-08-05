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

// 처음 열 때 한 번에 주는 최근 대화 수. 그 위는 안 올려도 된다 —
// 근무 중 확인용이지 이력 조회용이 아니다(전체는 DB에 남는다).
const RECENT_LIMIT = 200

const recentStmt = db.prepare(`
  SELECT c.id, c.account_id, a.display_name AS author, a.role, c.content, c.created_at
  FROM chat_messages c JOIN accounts a ON a.id = c.account_id
  WHERE c.id > ?
  ORDER BY c.id DESC LIMIT ?
`)

const insertStmt = db.prepare(
  'INSERT INTO chat_messages (account_id, content, created_at) VALUES (?, ?, ?)',
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

// since를 주면 그 이후만, 안 주면 최근 RECENT_LIMIT개.
// 어느 쪽이든 오래된 것부터(오름차순) 돌려준다 — 화면이 그대로 이어 붙이면 되게.
router.get('/chat', (req, res) => {
  const since = Number(req.query.since)
  const hasSince = Number.isInteger(since) && since >= 0
  const rows = recentStmt.all(hasSince ? since : 0, hasSince ? RECENT_LIMIT : RECENT_LIMIT).reverse()
  res.json({
    messages: rows,
    notice: readNotice(),
    // 메시지가 없어도 배지 비교가 되도록 항상 숫자를 준다.
    latest_id: db.prepare('SELECT COALESCE(MAX(id), 0) m FROM chat_messages').get().m,
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

// ─── 공지 (관리자 전용) ──────────────────────────────────────────────
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

// 대화가 길어지면 관리자가 비운다. 한 줄 삭제는 만들지 않았다 —
// 누가 무엇을 지웠는지 따지기 시작하면 채팅이 기록물이 된다(그 용도가 아니다).
adminChatRouter.delete('/chat', (req, res) => {
  const { changes } = db.prepare('DELETE FROM chat_messages').run()
  res.json({ deleted: changes })
})

export default router
