// 시험 삼아 등록했다 취소해서 남은 더미 환자를 정리한다.
//
//   node server/tools/purge-dummy-patients.mjs          목록만 보여준다(아무것도 안 지움)
//   node server/tools/purge-dummy-patients.mjs --yes    실제로 지운다
//
// 반드시 backup.bat을 먼저 돌릴 것. 지우는 건 되돌릴 수 없다.
//
// 무엇을 더미로 보는가 — 셋을 모두 만족해야 한다. 하나라도 어긋나면 건드리지 않는다.
//   1) 그 등록이 만들어낸 환자다: patients.created_at 이 첫 sessions.assigned_at 과 같다.
//      환자 행과 세션 행이 같은 요청에서 만들어지기 때문이다. EMR에서 일괄 임포트한 환자는
//      환자가 먼저 있었으므로 두 값이 다르다 → 임포트된 실제 환자는 절대 안 걸린다.
//   2) 유효한 방문이 하나도 없다: 모든 세션이 취소됐고, 시작한 적이 없다.
//   3) 아무 기록도 안 남겼다: 라운딩·증상·바이탈·처방·환자노트가 전부 없다.
//
// 2)만으로 지우면 '실제 환자인데 라인 실패로 취소된 경우'까지 날아간다. 1)이 그걸 막는다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'infusion.db')
const apply = process.argv.includes('--yes')

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const SAME_REQUEST_MS = 5000   // 같은 요청 안의 시각 오차 여유

const candidates = db.prepare(`
  SELECT p.id, p.chart_no, p.name, p.created_at, s.first_at, s.n
  FROM patients p
  JOIN (SELECT patient_id, MIN(assigned_at) AS first_at, COUNT(*) AS n,
               SUM(CASE WHEN cancelled = 0 THEN 1 ELSE 0 END) AS valid,
               SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
        FROM sessions GROUP BY patient_id) s ON s.patient_id = p.id
  WHERE s.valid = 0 AND s.started = 0 AND ABS(s.first_at - p.created_at) < ${SAME_REQUEST_MS}
  ORDER BY p.created_at DESC
`).all()

// 기록이 하나라도 붙어 있으면 뺀다. 위 조건에서 이미 걸러지지만 지우기 전 마지막 확인이다.
const hasAny = (sql, ...a) => !!db.prepare(sql).get(...a)
const LABEL = { rounds: '라운딩', session_notes: '증상기록', vitals: '바이탈', session_orders: '처방' }
const targets = []
const skipped = []
for (const c of candidates) {
  const sids = db.prepare('SELECT id FROM sessions WHERE patient_id = ?').all(c.id).map((r) => r.id)
  let why = null
  for (const sid of sids) {
    for (const t of Object.keys(LABEL)) {
      if (!why && hasAny(`SELECT 1 FROM ${t} WHERE session_id = ? LIMIT 1`, sid)) why = LABEL[t]
    }
  }
  if (!why && hasAny('SELECT 1 FROM patient_notes WHERE patient_id = ? LIMIT 1', c.id)) why = '환자노트'
  if (why) skipped.push({ ...c, why })
  else targets.push(c)
}

const f = (t) => new Date(t).toLocaleString('ko-KR')
console.log(`DB: ${dbPath}`)
console.log(`환자 총계: ${db.prepare('SELECT COUNT(*) n FROM patients').get().n}명`)
console.log(`더미 후보: ${targets.length}명`)
console.log()
for (const t of targets) {
  console.log(`  ${String(t.chart_no).padEnd(12)} ${String(t.name).padEnd(10)} 등록 ${f(t.created_at)}  세션 ${t.n}건(전부 취소)`)
}

// 무엇이 왜 빠졌는지 반드시 이름으로 알린다. 숫자만 알리면 '다 정리됐다'로 읽힌다.
if (skipped.length) {
  console.log()
  console.log(`※ 조건은 맞지만 기록이 붙어 있어 건드리지 않은 ${skipped.length}명:`)
  for (const s of skipped) {
    console.log(`  ${String(s.chart_no).padEnd(12)} ${String(s.name).padEnd(10)} — ${s.why}이(가) 남아 있다`)
  }
  console.log('  이것들도 지우려면 앱에서 그 기록을 먼저 지우고 다시 실행할 것.')
}
console.log()

if (!targets.length) { console.log('지울 것이 없다.'); db.close(); process.exit(0) }

if (!apply) {
  console.log('※ 목록만 보여줬다. 아무것도 안 지웠다.')
  console.log('※ 실제로 지우려면 backup.bat을 먼저 돌린 뒤 --yes 를 붙여 다시 실행할 것.')
  db.close()
  process.exit(0)
}

const del = db.transaction(() => {
  let sessions = 0
  for (const t of targets) {
    sessions += db.prepare('DELETE FROM sessions WHERE patient_id = ?').run(t.id).changes
    db.prepare('DELETE FROM patient_memos WHERE chart_no = ?').run(String(t.chart_no))
    db.prepare('DELETE FROM patients WHERE id = ?').run(t.id)
  }
  return sessions
})
const sessions = del()
console.log(`지웠다: 환자 ${targets.length}명 · 취소 세션 ${sessions}건`)
console.log(`남은 환자: ${db.prepare('SELECT COUNT(*) n FROM patients').get().n}명`)
db.close()
