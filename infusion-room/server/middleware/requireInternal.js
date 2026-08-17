import crypto from 'node:crypto'
import db, { FRIEND_HZ_USERNAME } from '../db.js'

// ─── 서버 간 호출 인증 ────────────────────────────────────────────────
// 프렌즈(사내 메신저) 서버가 이 서버를 부를 때 쓴다. 사람 세션 쿠키(requireAuth)를 쓰지
// 않는 이유는 부르는 쪽이 사람이 아니라 서버라서다 — 프렌즈 서버는 이 앱 계정이 없고,
// 있다 해도 남의 로그인 쿠키를 들고 다니게 하는 것이 더 나쁘다.
//
// 이 통로는 /api/internal 아래 읽기 라우트에만 붙는다. requireAuth 전체를 토큰으로
// 뚫어 주면 그 토큰 하나로 배정·처방·계정까지 손댈 수 있게 된다.
const HEADER = 'x-internal-token'
const ACTOR_HEADER = 'x-actor'

// 토큰이 짧으면 지키는 것이 12만 명분 진료 기록이라 그냥 통과시킬 수 없다.
// 그렇다고 기동을 막지는 않는다 — 수액실 본체는 연동과 무관하게 떠 있어야 한다.
const MIN_TOKEN_LENGTH = 32

let warned = false
function configuredToken() {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) return null
  if (token.length < MIN_TOKEN_LENGTH) {
    if (!warned) {
      warned = true
      console.error(
        `[internal] INTERNAL_API_TOKEN 이 ${MIN_TOKEN_LENGTH}자보다 짧습니다 — 연동을 켜지 않습니다.`,
      )
    }
    return null
  }
  return token
}

// 길이가 다르면 timingSafeEqual 이 던지므로 양쪽을 해시해 길이를 맞춘다.
function sameToken(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// 로그에 남는 값이라 한 줄로 읽히게 다듬는다. 제어문자·줄바꿈이 그대로 들어가면
// 로그를 훑을 때 줄이 어긋나고, 길이는 넉넉히 잘라 둔다.
// 정규식 리터럴 대신 new RegExp 로 만드는 이유: 제어문자를 소스에 글자로 남기지 않으려는 것.
const ACTOR_MAX = 100
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

function cleanActor(raw) {
  let decoded = String(raw ?? '')
  try {
    // 한글 이름이 오므로 프렌즈가 URI 인코딩해 보낸다(HTTP 헤더는 ASCII 만 안전하다).
    decoded = decodeURIComponent(decoded)
  } catch {
    // 인코딩이 깨졌으면 원문 그대로 쓴다 — 로그를 남기는 쪽이 못 남기는 것보다 낫다.
  }
  return decoded.replace(CONTROL_CHARS, ' ').trim().slice(0, ACTOR_MAX)
}

let serviceAccountId
function friendHzAccountId() {
  if (serviceAccountId === undefined) {
    serviceAccountId = db
      .prepare('SELECT id FROM accounts WHERE username = ?')
      .get(FRIEND_HZ_USERNAME)?.id ?? null
  }
  return serviceAccountId
}

export function requireInternal(req, res, next) {
  const expected = configuredToken()
  if (!expected) {
    return res.status(503).json({ error: '서버 간 연동이 설정되지 않았습니다' })
  }

  const got = req.get(HEADER)
  if (!got || !sameToken(got, expected)) {
    return res.status(401).json({ error: '연동 토큰이 올바르지 않습니다' })
  }

  // 누가 보는지를 못 적으면 열람 로그가 '프렌즈에서 누군가'로만 남는다. 건강정보를
  // 여는 통로라 그건 로그가 아니므로, 없으면 아예 받지 않는다.
  const actor = cleanActor(req.get(ACTOR_HEADER))
  if (!actor) {
    return res.status(400).json({ error: `${ACTOR_HEADER} 헤더에 열람자를 적어야 합니다` })
  }

  req.internal = { actor }
  // logAccess 가 account_id 를 여기서 집어 간다 — '어느 앱에서 왔나'가 그 값이다.
  const id = friendHzAccountId()
  if (id != null) req.account = { id, username: FRIEND_HZ_USERNAME, role: 'viewer' }
  next()
}
