// node server/routes/patientIdentity.test.mjs
//
// 환자 신원(이름·차트번호)이 바뀌는 모든 경로를 실제 서버로 확인한다.
//
// 이 파일이 있는 이유: 2026-09-10, 등록할 때 차트번호를 한 자리 잘못 친 것이
// 그 번호 주인의 이름을 조용히 덮어써서 네 명의 이름이 뒤바뀐 채 며칠을 갔다.
// 환자 이름은 세션이 아니라 patients 행에 있으므로, 한 번 덮이면 그 환자의 과거 방문까지
// 전부 남의 이름으로 보인다. 여기서 지켜야 하는 건 하나다 —
// **묻지 않고 남의 이름을 바꾸는 길이 없어야 한다.**
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-identity-')), 'test.db')
const PORT = 45317
const BASE = `http://127.0.0.1:${PORT}/api`

process.env.DB_PATH = tmpDb
process.env.PORT = String(PORT)

const { default: db } = await import('../db.js')

const now = Date.now()
const bcrypt = (await import('bcryptjs')).default
db.prepare('INSERT INTO accounts (username, display_name, password_hash, role, is_active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
  .run('tester', '테스터', bcrypt.hashSync('pw', 4), 'staff', now, now)
db.prepare('INSERT INTO staff (name, is_active, sort_order, created_at) VALUES (?,1,0,?)').run('간호사', now)
for (const [code, num] of [['r1-1', '1'], ['r1-2', '2'], ['r1-3', '3']]) {
  db.prepare('INSERT INTO beds (code, room, number, sort_order, is_active) VALUES (?,?,?,0,1)').run(code, 'room1', num)
}
// 사건의 두 사람을 그대로 옮겨 놓는다.
db.prepare('INSERT INTO patients (chart_no, name, created_at, updated_at) VALUES (?,?,?,?)')
  .run('71334', '차연정', now, now)
db.prepare('INSERT INTO patients (chart_no, name, created_at, updated_at) VALUES (?,?,?,?)')
  .run('71324', '황인근', now, now)

// settings 는 seed.js 가 넣는다. 여기선 배정이 읽는 것만 심는다 —
// getSetting 은 없는 키에 대해 그대로 터진다(빈 DB 로 띄우면 배정이 500 이다).
for (const [k, v] of [['min_duration_min', '10'], ['chart_no_max', '999999']]) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?,?,?)').run(k, v, now)
}

const staffId = db.prepare('SELECT id FROM staff LIMIT 1').get().id
const accountId = db.prepare("SELECT id FROM accounts WHERE username = 'tester'").get().id
const bedId = db.prepare("SELECT id FROM beds WHERE code = 'r1-3'").get().id
const chaId = db.prepare("SELECT id FROM patients WHERE chart_no = '71334'").get().id

// 차연정의 지난 방문 2건 — '과거 기록이 따라오나'를 볼 대상이다.
for (const daysAgo of [3, 5]) {
  db.prepare(`
    INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id, started_at, ended_at, duration_minutes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(bedId, chaId, now - daysAgo * 86400e3, accountId, staffId,
         now - daysAgo * 86400e3 + 100, now - daysAgo * 86400e3 + 3600e3, 60)
}

await import('../index.js')
for (let i = 0; i < 40; i++) {
  try { await fetch(`${BASE}/login`, { method: 'POST' }); break }
  catch { await new Promise((r) => setTimeout(r, 100)) }
}

// 로그인해서 쿠키를 챙긴다.
const loginRes = await fetch(`${BASE}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'tester', password: 'pw' }),
})
assert.equal(loginRes.status, 200)
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const post = (url, body) => fetch(`${BASE}${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
})
const patch = (url, body) => fetch(`${BASE}${url}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
})
const nameOf = (chartNo) => db.prepare('SELECT name FROM patients WHERE chart_no = ?').get(chartNo)?.name
const lastLog = () => db.prepare('SELECT action, detail FROM access_logs ORDER BY id DESC LIMIT 1').get()

// ─── 1. 사건 재현 — 번호를 한 자리 잘못 친 등록은 거절된다 ──────────────
// 예전엔 이 요청이 200 을 받고 차연정을 황인근으로 바꿔 놨다.
{
  const res = await post('/sessions/assign', {
    bed_code: 'r1-1', chart_no: '71334', patient_name: '황인근',
    line_staff_id: staffId, exam_room: '1',
  })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.conflict, 'name_mismatch')
  assert.equal(body.registered_name, '차연정')
  assert.equal(body.typed_name, '황인근')
  assert.equal(body.visit_count, 2)          // 판단 재료 — 이 사람 기록이 2건 걸려 있다
  assert.equal(nameOf('71334'), '차연정')     // 안 바뀌었다
}

// ─── 2. 이름이 같으면 그냥 지나간다(평소 등록) ─────────────────────────
{
  const res = await post('/sessions/assign', {
    bed_code: 'r1-1', chart_no: '71334', patient_name: '차연정',
    line_staff_id: staffId, exam_room: '1',
  })
  assert.equal(res.status, 201)
  assert.equal(nameOf('71334'), '차연정')
}

// ─── 3. 근무자가 화면에서 '이름을 바꾼다'를 고르면 바뀌고, 로그가 남는다 ──
{
  const res = await post('/sessions/assign', {
    bed_code: 'r1-2', chart_no: '71324', patient_name: '황인근(개명)',
    line_staff_id: staffId, exam_room: '1', confirm_rename: true,
  })
  assert.equal(res.status, 201)
  assert.equal(nameOf('71324'), '황인근(개명)')
  const log = lastLog()
  assert.equal(log.action, 'patient_rename')
  assert.match(log.detail, /71324 황인근 → 황인근\(개명\)/)
  // 원상복구 — 아래 테스트가 이 이름을 다시 쓴다
  db.prepare("UPDATE patients SET name = '황인근' WHERE chart_no = '71324'").run()
}

const sessionId = db.prepare(
  "SELECT s.id FROM sessions s JOIN beds b ON b.id = s.bed_id WHERE b.code = 'r1-1' AND s.ended_at IS NULL",
).get().id

// ─── 4. 환자정보 수정에서 번호를 바꾸면, 서버는 어느 쪽인지 고르지 않는다 ──
// 여기가 이번 개편의 핵심이다. '새로 꼬인 것'과 '원래 꼬여 있던 것'은
// patients 행만 봐서는 구분이 안 된다 — 판단 재료를 주고 화면에 되묻는다.
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '차연정', chart_no: '71399',
  })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.conflict, 'chart_changed')
  assert.equal(body.current.name, '차연정')
  assert.equal(body.current.visit_count, 3)   // 지난 2건 + 지금 1건
  assert.equal(body.target, null)             // 71399 는 아직 없는 번호
  assert.equal(nameOf('71334'), '차연정')      // 아무것도 안 바뀌었다
}

// ─── 4-b. 한 환자가 두 베드를 차지할 수는 없다 ─────────────────────────
// 3번에서 황인근을 r1-2 에 배정해 뒀다. 그 상태로 이 세션을 황인근에게 붙이면
// 같은 사람이 두 자리에 앉는다 — DB 의 부분 유니크 인덱스가 막고, 라우트는 그걸
// 배정 화면과 같은 말로 옮긴다(여기서 SQLITE_CONSTRAINT 가 그대로 새면 안 된다).
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근', chart_no: '71324', mode: 'relink',
  })
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /이미 다른 베드에 배정/)
  // 세션은 아직 차연정 것이다 — 실패한 relink 가 중간까지 가지 않았다
  assert.equal(db.prepare('SELECT patient_id FROM sessions WHERE id = ?').get(sessionId).patient_id, chaId)
}

// 이제 그 배정을 취소해 자리를 비운다(아래 relink 가 성립하도록).
db.prepare("UPDATE sessions SET cancelled = 1, cancel_reason = '테스트' WHERE bed_id = (SELECT id FROM beds WHERE code = 'r1-2')").run()

// ─── 5. relink — 이 베드만 딴 사람이었다. 원래 환자는 안 건드린다 ────────
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근', chart_no: '71324', mode: 'relink',
  })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).mode, 'relink')
  // 세션만 옮겨갔다
  const s = db.prepare('SELECT patient_id FROM sessions WHERE id = ?').get(sessionId)
  assert.equal(s.patient_id, db.prepare("SELECT id FROM patients WHERE chart_no = '71324'").get().id)
  // 차연정은 이름도 번호도 그대로, 지난 방문 2건도 그대로 그 사람 것이다
  assert.equal(nameOf('71334'), '차연정')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE patient_id = ?').get(chaId).c, 2)
  assert.equal(lastLog().action, 'patient_relink')
}

// ─── 6. relink 로 남의 이름을 덮을 수는 없다 ───────────────────────────
// 이 길이 열려 있으면 1번에서 막은 구멍이 여기로 그대로 옮겨온다.
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '엉뚱한이름', chart_no: '71334', mode: 'relink',
  })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).conflict, 'name_mismatch')
  assert.equal(nameOf('71334'), '차연정')
}

// ─── 7. renumber — 이 환자의 번호가 원래 틀렸다. 과거 방문이 함께 간다 ───
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근', chart_no: '71325', mode: 'renumber',
  })
  assert.equal(res.status, 200)
  assert.equal(nameOf('71325'), '황인근')
  assert.equal(nameOf('71324'), undefined)   // 그 번호는 이제 없다 — 행이 통째로 옮겨갔다
  const log = lastLog()
  assert.equal(log.action, 'patient_renumber')
  assert.match(log.detail, /71324 황인근 → 71325 황인근/)
}

// ─── 8. 남이 쓰는 번호로는 renumber 할 수 없다 ─────────────────────────
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근', chart_no: '71334', mode: 'renumber',
  })
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /이미 차연정 환자의 번호/)
  assert.equal(nameOf('71334'), '차연정')
}

// ─── 9. 번호 그대로 이름만 고치는 것도 되묻는다(개명) ───────────────────
{
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근2', chart_no: '71325',
  })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).conflict, 'rename')
  assert.equal(nameOf('71325'), '황인근')

  const ok = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근2', chart_no: '71325', confirm_rename: true,
  })
  assert.equal(ok.status, 200)
  assert.equal(nameOf('71325'), '황인근2')
  assert.equal(lastLog().action, 'patient_rename')
}

// ─── 10. 아무것도 안 바꾸는 저장은 조용히 지나간다(로그를 더럽히지 않는다) ─
{
  const before = db.prepare('SELECT COUNT(*) c FROM access_logs').get().c
  const res = await patch(`/sessions/${sessionId}/patient`, {
    patient_name: '황인근2', chart_no: '71325',
  })
  assert.equal(res.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM access_logs').get().c, before)
}

console.log('환자 신원 테스트 통과')
process.exit(0)
