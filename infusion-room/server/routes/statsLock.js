import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const KEY = 'stats_password_hash'
const hashOf = db.prepare('SELECT value FROM settings WHERE key = ?')

// 두 라우트가 같은 settings 키를 다뤄 한 파일에 두되, 권한이 달라 라우터를 가른다.
// index.js에서 statsRouter는 requireAuth 뒤에, statsAdminRouter는 requireAdmin 뒤에 붙인다.
// 한 라우터로 묶으면 재설정까지 로그인만으로 열려 버린다.
export const statsRouter = Router()
export const statsAdminRouter = Router()

// ─── 통계 화면 잠금 해제 ─────────────────────────────────────────────
// 검증을 서버가 하는 이유: 암호를 클라이언트로 내려보내면 화면을 잠근 의미가 없다.
// 로그인한 사람이면 누구나 시도할 수 있다 — 근무자가 원장님 대신 열어 드리는 일이 있다.
//
// 이 잠금은 '원장님이 보는 화면을 아무나 열어 두지 않는다'는 뜻이지 데이터 비밀이 아니다.
// 같은 세션 기록이 이용기록 탭에 그대로 있고 그쪽은 안 잠근다. 그래서 시도 횟수 제한을
// 따로 두지 않았다 — bcrypt가 한 번에 100ms쯤 걸려 무차별 대입 속도를 이미 깎는다.
statsRouter.post('/stats/unlock', (req, res) => {
  const { password } = req.body ?? {}
  const row = hashOf.get(KEY)
  if (!row) return res.status(500).json({ error: '통계 암호가 설정되어 있지 않습니다' })
  if (typeof password !== 'string' || !bcrypt.compareSync(password, row.value)) {
    return res.status(401).json({ error: '암호가 맞지 않습니다' })
  }
  res.json({ ok: true })
})

// ─── 암호 재설정 (관리자) ────────────────────────────────────────────
statsAdminRouter.put('/stats-password', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : ''
  if (password.length < 4) {
    return res.status(400).json({ error: '암호는 4자 이상이어야 합니다' })
  }
  db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(bcrypt.hashSync(password, 10), Date.now(), KEY)
  // 무엇을 바꿨는지는 남기되 값은 남기지 않는다.
  logAccess(req, ACTIONS.ACCOUNT_CHANGE, { targetType: `setting:${KEY}` })
  res.json({ ok: true })
})
