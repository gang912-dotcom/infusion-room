// 계정 비밀번호 재설정 (서버 PC에서 실행)
//
// 왜 필요한가: 비밀번호는 bcrypt 해시로만 저장된다. DB를 열어도 원래 값을 알 수 없고,
// 알아낼 방법도 없다 — 잊었을 때 할 수 있는 건 '새로 정하기'뿐이다.
// npm run db:seed는 INSERT OR IGNORE라 이미 있는 계정을 덮어쓰지 않는다(그래서 못 쓴다).
//
// 마스터 계정이 하나라도 살아 있으면 이 스크립트 없이 화면에서 바꾸는 게 낫다:
//   데이터관리 탭 → 계정 → 비밀번호 변경.
// 이 스크립트는 그 마스터마저 못 들어갈 때 쓰는 마지막 문이다.
//
// 쓰는 법 (server 폴더에서):
//   node tools/reset-password.mjs                  계정 목록만 본다(아무것도 안 바꾼다)
//   node tools/reset-password.mjs admin            admin의 비밀번호를 새로 정한다
//   node tools/reset-password.mjs admin --logout   바꾸면서 그 계정의 로그인 세션도 모두 끊는다
//
// 새 비밀번호는 실행한 뒤에 물어본다. 명령줄에 적지 않는 이유는, 명령줄에 적으면
// 그대로 cmd 기록에 남아서다. 입력하는 동안 화면에는 아무것도 찍히지 않는다.
//
// 이 스크립트는 accounts 한 행의 password_hash만 바꾼다(--logout을 주면 auth_tokens도
// 지운다). 환자 기록은 건드리지 않는다.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'infusion.db')

const args = process.argv.slice(2)
const username = args.find((a) => !a.startsWith('--'))
const alsoLogout = args.includes('--logout')

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const CTRL_C = '\u0003'      // 눌러서 빠져나가기
const BACKSPACE = '\u007f'   // 로우 모드에서는 지우기도 직접 처리한다

const ROLE_LABEL = { admin: '마스터', manager: '관리자', staff: '직원', viewer: '열람' }

// ─── 목록 ────────────────────────────────────────────────────────────
if (!username) {
  const rows = db.prepare(
    'SELECT username, display_name, role, is_active FROM accounts ORDER BY id'
  ).all()
  console.log(`\nDB: ${dbPath}`)
  console.log(`계정 ${rows.length}개\n`)
  for (const r of rows) {
    const state = r.is_active ? '' : '  (사용 중지됨)'
    console.log(`  ${r.username.padEnd(14)} ${r.display_name.padEnd(12)} ${ROLE_LABEL[r.role] ?? r.role}${state}`)
  }
  console.log('\n바꾸려면: node tools/reset-password.mjs <아이디>\n')
  db.close()
  process.exit(0)
}

const account = db.prepare(
  'SELECT id, username, display_name, role, is_active FROM accounts WHERE username = ?'
).get(username)

if (!account) {
  console.error(`\n'${username}' 계정이 없습니다. 목록을 보려면 아이디 없이 실행하세요.\n`)
  db.close()
  process.exit(1)
}

// ─── 새 비밀번호 묻기 (화면에 찍지 않는다) ─────────────────────────────
// readline을 쓰지 않고 stdin을 직접 읽는다. readline은 질문마다 창구를 열고 닫으면
// 첫 close가 stdin을 끝내 버려 두 번째 질문이 영영 답을 못 받는다 — 잠긴 사람이 쓰는
// 마지막 문이라 그런 함정을 두지 않는다. 여기서는 창구 하나로 두 번 묻는다.
const stdin = process.stdin
const isTTY = stdin.isTTY === true
let pending = ''     // 아직 소비하지 않은 입력(한 덩어리에 두 줄이 같이 올 수 있다)
let waiting = null   // 지금 한 줄을 기다리는 쪽
let ended = false

stdin.setEncoding('utf8')
if (isTTY) stdin.setRawMode(true)  // 로우 모드에서는 입력이 화면에 되비치지 않는다
stdin.on('data', (chunk) => {
  if (isTTY && chunk.includes(CTRL_C)) {  // Ctrl-C
    stdin.setRawMode(false)
    console.error('\n\n취소했습니다. 아무것도 바꾸지 않았습니다.\n')
    process.exit(130)
  }
  // 로우 모드에서는 지우기(백스페이스)도, 제어 문자 걸러내기도 직접 해야 한다.
  // 걸러내지 않으면 화살표 키([A)나 터미널이 흘려보낸 EOT()가 그대로
  // 비밀번호에 섞여 들어간다 — 실제로 그래서 '두 번 입력한 값이 다릅니다'가 났다.
  for (const ch of chunk) {
    if (ch === BACKSPACE || ch === '\b') { pending = pending.replace(/.$/, ''); continue }
    if (ch !== '\r' && ch !== '\n' && ch.codePointAt(0) < 0x20) continue
    pending += ch
  }
  drain()
})
stdin.on('end', () => { ended = true; drain() })

function drain() {
  if (!waiting) return
  const i = pending.search(/[\r\n]/)
  if (i === -1) {
    if (!ended) return
    const rest = pending; pending = ''
    const done = waiting; waiting = null
    return done(rest)
  }
  const line = pending.slice(0, i)
  pending = pending.slice(i + 1).replace(/^\n/, '')  // \r\n을 한 줄로 센다
  const done = waiting; waiting = null
  done(line)
}

function askHidden(question) {
  process.stdout.write(question)
  return new Promise((resolve) => {
    waiting = (line) => { process.stdout.write('\n'); resolve(line) }
    drain()  // 이미 들어와 있는 줄이 있으면 바로 쓴다
  })
}

const label = ROLE_LABEL[account.role] ?? account.role
console.log(`\n${account.username} (${account.display_name} · ${label})의 비밀번호를 새로 정합니다.`)

const bail = (msg) => {
  if (isTTY) stdin.setRawMode(false)
  db.close()
  console.error(`\n${msg} 아무것도 바꾸지 않았습니다.\n`)
  process.exit(1)
}

const pw1 = await askHidden('새 비밀번호: ')
if (pw1.length < 4) bail('너무 짧습니다(4자 이상).')
const pw2 = await askHidden('한 번 더: ')
if (pw1 !== pw2) bail('두 번 입력한 값이 다릅니다.')
if (isTTY) stdin.setRawMode(false)
stdin.pause()

const now = Date.now()
db.prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
  .run(bcrypt.hashSync(pw1, 10), now, account.id)

let killed = 0
if (alsoLogout) {
  killed = db.prepare('DELETE FROM auth_tokens WHERE account_id = ?').run(account.id).changes
}

console.log(`\n바꿨습니다. 이제 ${account.username}으로 새 비밀번호를 써서 로그인하세요.`)
if (alsoLogout) {
  console.log(`로그인 세션 ${killed}개를 끊었습니다 — 상황판 모니터와 아이패드도 다시 로그인해야 합니다.`)
} else {
  console.log('이미 로그인돼 있는 화면(상황판 모니터·아이패드)은 그대로 유지됩니다.')
  console.log('그 화면들까지 끊으려면 --logout을 붙여 다시 실행하세요.')
}
if (!account.is_active) {
  console.log('\n주의: 이 계정은 사용 중지 상태입니다. 데이터관리 탭에서 다시 켜야 로그인됩니다.')
}
console.log()

db.close()
