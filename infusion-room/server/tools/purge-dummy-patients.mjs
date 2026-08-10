// 시험 삼아 등록했다 취소해서 남은 더미 환자를 정리한다.
//
//   node server/tools/purge-dummy-patients.mjs          목록만 보여준다(아무것도 안 지움)
//   node server/tools/purge-dummy-patients.mjs --yes    실제로 지운다
//
// 평소에는 이 도구를 쓸 일이 없다 — 관리자 화면(데이터관리 → 관리자 설정 → 더미 환자 정리)에
// 같은 기능이 있고 그쪽은 서버 PC에 안 가도 된다. 이건 화면이 안 뜰 때를 위한 뒷문이다.
//
// 판정 규칙은 server/lib/dummyPatients.js 한 곳에 있다(화면과 같은 것을 본다).
// 지우기 전 backup.bat을 먼저 돌릴 것. 되돌릴 수 없다.
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDummyPatients, purgeDummyPatients } from '../lib/dummyPatients.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'infusion.db')
const apply = process.argv.includes('--yes')

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const { targets, skipped } = findDummyPatients(db)
const f = (t) => new Date(t).toLocaleString('ko-KR')

console.log(`DB: ${dbPath}`)
console.log(`환자 총계: ${db.prepare('SELECT COUNT(*) n FROM patients').get().n}명`)
console.log(`더미 후보: ${targets.length}명`)
console.log()
for (const t of targets) {
  console.log(`  ${String(t.chart_no).padEnd(12)} ${String(t.name).padEnd(10)} 등록 ${f(t.created_at)}  세션 ${t.session_count}건(전부 취소)`)
}

// 무엇이 왜 빠졌는지 반드시 이름으로 알린다. 숫자만 알리면 '다 정리됐다'로 읽힌다.
if (skipped.length) {
  console.log()
  console.log(`※ 조건은 맞지만 기록이 붙어 있어 건드리지 않은 ${skipped.length}명:`)
  for (const s of skipped) {
    console.log(`  ${String(s.chart_no).padEnd(12)} ${String(s.name).padEnd(10)} — ${s.reason}이(가) 남아 있다`)
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

const r = purgeDummyPatients(db, targets.map((t) => t.id))
console.log(`지웠다: 환자 ${r.patients}명 · 취소 세션 ${r.sessions}건`)
console.log(`남은 환자: ${db.prepare('SELECT COUNT(*) n FROM patients').get().n}명`)
db.close()
