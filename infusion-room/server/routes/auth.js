import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { SESSION_COOKIE_NAME, requireAuth } from '../middleware/requireAuth.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const router = Router()
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return res.status(400).json({ error: 'username과 password가 필요합니다' })
  }

  const account = db.prepare(
    'SELECT id, username, display_name, role, password_hash, is_active FROM accounts WHERE username = ?',
  ).get(username)

  if (!account || !account.is_active || !bcrypt.compareSync(password, account.password_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' })
  }

  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO auth_tokens (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, account.id, now, now + THIRTY_DAYS_MS)

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: THIRTY_DAYS_MS,
    sameSite: 'lax',
  })
  // 성공한 로그인만 기록한다(실패는 대상 아님). requireAuth를 안 거치는 경로라 accountId를 직접 넘긴다.
  logAccess(req, ACTIONS.LOGIN, { accountId: account.id })
  res.json({
    ok: true,
    account: { id: account.id, username: account.username, display_name: account.display_name, role: account.role },
  })
})

// 이미 유효한 쿠키가 있는지 확인할 때 사용(새로고침 시 재로그인 방지)
router.get('/me', requireAuth, (req, res) => {
  res.json({ account: req.account })
})

router.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token)
  res.clearCookie(SESSION_COOKIE_NAME)
  res.json({ ok: true })
})

export default router
