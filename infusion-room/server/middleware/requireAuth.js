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

// 열람 전용(viewer, 1단계)은 쓰기를 못 한다 — UI 버튼만 숨기면 API 직접 호출로 뚫리므로
// 서버에서 막는다. 읽기(보드·이용기록·기록지·환자조회)는 전부 GET이라 'viewer면 GET만 허용'으로
// 충분하다. 유일한 예외: 환자 상세 열람 로그(POST detail-view)는 편집이 아니라 '누가 봤나'
// 감사 기록이라 열람 계정의 접근도 남긴다.
const VIEWER_POST_OK = /^\/patients\/[^/]+\/detail-view$/
export function blockViewerWrites(req, res, next) {
  if (req.account?.role === 'viewer' && req.method !== 'GET') {
    if (req.method === 'POST' && VIEWER_POST_OK.test(req.path)) return next()
    return res.status(403).json({ error: '열람 전용 계정입니다 — 편집 권한이 없습니다' })
  }
  next()
}
