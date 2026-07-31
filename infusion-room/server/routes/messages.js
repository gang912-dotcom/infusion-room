import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import db from '../db.js'

const router = Router()

// 직원 화면에 쪽지가 살아있는 시간. 이 시간이 지나면 조회에서 빠진다(row는 남음).
export const MESSAGE_TTL_MS = 10 * 60 * 1000
const MAX_CONTENT_LENGTH = 1000

const inboxStmt = db.prepare(`
  SELECT m.id, m.from_account, a.display_name AS from_name, m.content,
         m.broadcast_id, m.created_at
  FROM messages m JOIN accounts a ON a.id = m.from_account
  WHERE m.to_account = ? AND m.read_at IS NULL AND m.created_at > ?
  ORDER BY m.created_at ASC
`)

const recipientsStmt = db.prepare(
  'SELECT id, display_name FROM accounts WHERE is_active = 1 AND id != ? ORDER BY display_name',
)

const activeAccountStmt = db.prepare('SELECT id FROM accounts WHERE id = ? AND is_active = 1')

const insertStmt = db.prepare(
  `INSERT INTO messages (from_account, to_account, content, broadcast_id, created_at, read_at)
   VALUES (?, ?, ?, ?, ?, NULL)`,
)

const markReadStmt = db.prepare(
  'UPDATE messages SET read_at = ? WHERE id = ? AND to_account = ? AND read_at IS NULL',
)

// 전체발송은 대상 수만큼 insert가 나가므로 트랜잭션으로 묶는다(중간에 깨져 일부만 가는 일 없게).
const insertBroadcast = db.transaction((rows) => {
  for (const row of rows) insertStmt.run(...row)
})

// ─── 내 수신함 (살아있는 것만) ──────────────────────────────────────
router.get('/messages', (req, res) => {
  const serverNow = Date.now()
  const messages = inboxStmt.all(req.account.id, serverNow - MESSAGE_TTL_MS)
  res.json({ server_now: serverNow, messages })
})

// ─── 받는 사람 목록 (작성창용, 로그인만 하면 누구나) ─────────────────
router.get('/messages/recipients', (req, res) => {
  res.json({ recipients: recipientsStmt.all(req.account.id) })
})

// ─── 보내기 (1:1 / 전체발송 / 답장) ─────────────────────────────────
router.post('/messages', (req, res) => {
  const { to, content, in_reply_to: inReplyTo } = req.body ?? {}
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return res.status(400).json({ error: '내용을 입력하세요' })
  if (text.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `내용은 ${MAX_CONTENT_LENGTH}자를 넘을 수 없습니다` })
  }

  const me = req.account.id
  const now = Date.now()

  // 답장이면 원본을 읽음처리(답장 = 닫기). 원본이 없거나 남의 것이면 조용히 무시하고 답장만 보낸다.
  if (inReplyTo !== undefined && inReplyTo !== null) {
    markReadStmt.run(now, inReplyTo, me)
  }

  if (to === 'all') {
    const targets = recipientsStmt.all(me)
    const broadcastId = randomUUID()
    insertBroadcast(targets.map((t) => [me, t.id, text, broadcastId, now]))
    return res.json({ ok: true, sent: targets.length, broadcast_id: broadcastId })
  }

  const toId = Number(to)
  if (!Number.isInteger(toId)) return res.status(400).json({ error: '받는 사람이 필요합니다' })
  if (toId === me) return res.status(400).json({ error: '자기 자신에게는 보낼 수 없습니다' })
  if (!activeAccountStmt.get(toId)) {
    return res.status(400).json({ error: '존재하지 않거나 사용하지 않는 계정입니다' })
  }

  const info = insertStmt.run(me, toId, text, null, now)
  res.json({ ok: true, id: info.lastInsertRowid })
})

// ─── 확인(닫기) — 멱등 ──────────────────────────────────────────────
router.post('/messages/:id/read', (req, res) => {
  markReadStmt.run(Date.now(), Number(req.params.id), req.account.id)
  res.json({ ok: true })
})

export default router
