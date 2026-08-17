// node server/routes/internal.test.mjs
//
// 프렌즈(사내 메신저)가 들어오는 통로를 실제 서버로 확인한다. 미들웨어만 따로 부르지 않는
// 이유가 있다 — 여기서 지켜야 하는 것의 절반은 '붙는 자리'라서다. requireAuth 앞에 붙었는지,
// 그 토큰으로 다른 라우트가 안 열리는지는 라우터를 혼자 불러서는 확인할 수 없다.
//
// 임시 DB 파일에 새로 만들어 쓴다(DB_PATH). 개발 DB 를 가리키면 열람 로그가 섞인다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-internal-')), 'test.db')
const TOKEN = 'T'.repeat(40)
const PORT = 45311
const BASE = `http://127.0.0.1:${PORT}/api`

process.env.DB_PATH = tmpDb
process.env.INTERNAL_API_TOKEN = TOKEN
process.env.PORT = String(PORT)

// db.js 를 먼저 들여 스키마를 만들고 표본을 심는다. index.js 는 같은 모듈 인스턴스를 쓴다.
const { default: db, FRIEND_HZ_USERNAME } = await import('../db.js')

const now = Date.now()
db.prepare('INSERT INTO accounts (username, display_name, password_hash, role, is_active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
  .run('tester', '테스터', 'x', 'staff', now, now)
db.prepare('INSERT INTO staff (name, is_active, sort_order, created_at) VALUES (?,1,0,?)').run('간호사', now)
db.prepare('INSERT INTO beds (code, room, number, sort_order, is_active) VALUES (?,?,?,0,1)').run('r1-1', 'room1', '1')
db.prepare('INSERT INTO patients (chart_no, name, baseline_note, gender, created_at, updated_at) VALUES (?,?,?,?,?,?)')
  .run('204118', '김서연', '고혈압', 'F', now, now)
db.prepare('INSERT INTO patients (chart_no, name, created_at, updated_at) VALUES (?,?,?,?)')
  .run('99', '이백프로', now, now)

const bedId = db.prepare("SELECT id FROM beds WHERE code = 'r1-1'").get().id
const patientId = db.prepare("SELECT id FROM patients WHERE chart_no = '204118'").get().id
const accountId = db.prepare("SELECT id FROM accounts WHERE username = 'tester'").get().id
const staffId = db.prepare('SELECT id FROM staff LIMIT 1').get().id

// 지금 이용 중인 세션 하나(= 카드의 '지금 어디 있나').
db.prepare(`
  INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id, started_at, duration_minutes)
  VALUES (?,?,?,?,?,?,?)
`).run(bedId, patientId, now - 3600e3, accountId, staffId, now - 3500e3, 120)

// 끝난 세션 하나(= 카드의 '지난번에 뭘 맞았나').
const past = db.prepare(`
  INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id, started_at, ended_at, duration_minutes)
  VALUES (?,?,?,?,?,?,?,?)
`).run(bedId, patientId, now - 86400e3, accountId, staffId, now - 86000e3, now - 82000e3, 60)
db.prepare('INSERT INTO session_orders (session_id, item_code, dose, qty) VALUES (?,?,?,?)')
  .run(past.lastInsertRowid, 'gluta', '1', 1)

await import('../index.js')

// 서버가 뜰 때까지 기다린다. 이 환경에는 timeout 명령이 없어서 폴링으로 한다.
for (let i = 0; i < 40; i++) {
  try {
    await fetch(`${BASE}/internal/patients/search?q=1`)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 100))
  }
}

const ok = { 'X-Internal-Token': TOKEN, 'X-Actor': encodeURIComponent('김철수#42') }
const get = (url, headers = ok) => fetch(`${BASE}${url}`, { headers })

// ─── 1. 토큰이 없거나 틀리면 아무것도 안 준다 ─────────────────────────
assert.equal((await get('/internal/patients/search?q=204118', { 'X-Actor': 'a' })).status, 401)
assert.equal((await get('/internal/patients/search?q=204118', { 'X-Internal-Token': 'X'.repeat(40), 'X-Actor': 'a' })).status, 401)

// ─── 2. 누가 보는지를 안 적으면 받지 않는다 ───────────────────────────
// 이걸 통과시키면 열람 로그가 '프렌즈에서 누군가'로만 남는다 — 그건 로그가 아니다.
assert.equal((await get('/internal/patients/search?q=204118', { 'X-Internal-Token': TOKEN })).status, 400)

// ─── 3. 검색은 이름 부분일치 · 차트번호 앞자리 일치 ───────────────────
// 앱의 GET /api/patients/search 와 같은 규칙이다. 다르면 "메신저에서만 안 나오는 환자"가 생긴다.
const byName = await (await get(`/internal/patients/search?q=${encodeURIComponent('서연')}`)).json()
assert.deepEqual(byName.map((p) => p.chart_no), ['204118'])
assert.equal(byName[0].active.room, 'room1', '지금 이용 중이면 어디 있는지가 후보에 보인다')

// 앞자리 일치라 '99' 로 '204118' 이 걸리면 안 된다(부분일치로 두면 번호 가운데가 걸린다).
const byChart = await (await get('/internal/patients/search?q=99')).json()
assert.deepEqual(byChart.map((p) => p.chart_no), ['99'])

// 후보 목록에는 기저질환을 싣지 않는다 — 고르기 전 단계까지 병력이 따라다닐 이유가 없다.
assert.ok(!('baseline_note' in byName[0]), '검색 결과에 baseline_note 가 있으면 안 된다')

// LIKE 와일드카드는 글자 그대로 찾는다(안 막으면 '%' 하나로 전 환자가 쏟아진다).
assert.deepEqual(await (await get('/internal/patients/search?q=%25')).json(), [])

// ─── 4. 카드는 한 번에 다 실어 온다 ───────────────────────────────────
const card = await (await get('/internal/patients/204118')).json()
assert.equal(card.name, '김서연')
assert.equal(card.baseline_note, '고혈압')
assert.equal(card.active.room, 'room1')
assert.equal(card.history.length, 1)
assert.deepEqual(card.history[0].orders.map((o) => o.label), ['gluta'])

assert.equal((await get('/internal/patients/999999')).status, 404)
assert.equal((await get('/internal/patients/abc')).status, 400, '차트번호는 숫자만')

// ─── 5. 열람 로그에 '어느 앱'과 '누가'가 함께 남는다 ──────────────────
const log = db.prepare('SELECT * FROM access_logs ORDER BY id DESC LIMIT 1').get()
assert.equal(log.action, 'patient_view')
assert.equal(log.target_id, patientId)
assert.equal(log.actor, '김철수#42', 'actor 에 사람이 남아야 한다(URI 인코딩을 푼 값)')
const serviceId = db.prepare('SELECT id FROM accounts WHERE username = ?').get(FRIEND_HZ_USERNAME).id
assert.equal(log.account_id, serviceId, 'account_id 는 프렌즈 서비스 계정이어야 한다')

// 검색은 로그를 남기지 않는다(목록만 보는 단계는 대상이 아니다 — 기존 방침).
const before = db.prepare('SELECT COUNT(*) c FROM access_logs').get().c
await get('/internal/patients/search?q=204118')
assert.equal(db.prepare('SELECT COUNT(*) c FROM access_logs').get().c, before)

// ─── 6. 그 토큰으로 열리는 문은 이 둘뿐이다 ───────────────────────────
// requireAuth 를 토큰으로 뚫었다면 여기가 200 이 된다 — 그게 이 테스트의 핵심이다.
assert.equal((await get('/board')).status, 401, '토큰으로 앱 라우트가 열리면 안 된다')
assert.equal(
  (await fetch(`${BASE}/sessions`, { method: 'POST', headers: { ...ok, 'Content-Type': 'application/json' }, body: '{}' })).status,
  401,
  '토큰으로 쓰기가 되면 안 된다',
)

// 연동 경로의 오타는 여기서 끊는다 — 아래로 흘러가면 "로그인이 필요합니다"가 되어
// 붙이는 쪽이 토큰 문제로 오해한다.
assert.equal((await get('/internal/nope')).status, 404)

// ─── 7. 서비스 계정으로는 로그인할 수 없다 ────────────────────────────
const svc = db.prepare('SELECT * FROM accounts WHERE username = ?').get(FRIEND_HZ_USERNAME)
assert.equal(svc.is_active, 0, '서비스 계정이 살아 있으면 로그인 통로가 하나 늘어난다')
assert.equal(svc.role, 'viewer')

console.log('OK — 연동 통로(/api/internal) 검증 통과')
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true })
process.exit(0)
