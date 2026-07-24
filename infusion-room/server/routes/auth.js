import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { SESSION_COOKIE_NAME } from '../middleware/requireAuth.js'

const router = Router()
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return res.status(400).json({ error: 'username과 password가 필요합니다' })
  }

  const account = db.prepare(
    'SELECT id, password_hash, is_active FROM accounts WHERE username = ?',
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
  res.json({ ok: true })
})

router.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token)
  res.clearCookie(SESSION_COOKIE_NAME)
  res.json({ ok: true })
})

export default router
