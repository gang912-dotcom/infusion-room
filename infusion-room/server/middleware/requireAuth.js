import db from '../db.js'

export const SESSION_COOKIE_NAME = 'sid'

export function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' })

  const account = db.prepare(
    `SELECT a.id, a.username, a.display_name, a.role
     FROM auth_tokens t JOIN accounts a ON a.id = t.account_id
     WHERE t.token = ? AND t.expires_at > ? AND a.is_active = 1`,
  ).get(token, Date.now())

  if (!account) return res.status(401).json({ error: '로그인이 필요합니다' })

  req.account = account
  next()
}

export function requireAdmin(req, res, next) {
  if (req.account?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다' })
  }
  next()
}
