// 잘못 누른 '등록 취소' 되살리기 (서버 PC에서 실행)
//
// 왜 되살릴 수 있나: 취소는 삭제가 아니라 sessions.cancelled = 1 표시다.
// 행을 정말 지우는 경로(routes/sessions.js의 removeIfThrowawayPatient)는
// '투여를 시작한 적 없는 세션'만 대상이라, 수액을 달던 환자는 절대 걸리지 않는다.
// 처방·라운딩·바이탈·메모는 session_id로 붙어 있어 그대로 남아 있다.
//
// 쓰는 법 (server 폴더에서):
//   node tools/restore-cancelled.mjs                 목록만 본다(아무것도 안 바꾼다)
//   node tools/restore-cancelled.mjs --days 3        최근 3일치까지 본다(기본 1일)
//   node tools/restore-cancelled.mjs --restore 123   123번 세션을 되살린다
//
// 되살린 뒤:
//   베드가 비어 있었으면 → 카드가 '진행중'으로 돌아온다. 화면에서 평소처럼 '수액 종료'를
//     누른다. 그래야 라인 제거 담당자와 기록지 공식본이 정상으로 굳는다. (권장)
//   베드에 다른 환자가 있으면 → 되돌릴 자리가 없다. 그때는 --end 로 바로 종료 처리한다:
//   node tools/restore-cancelled.mjs --restore 123 --end "2026-08-14 15:40"
//     이 경우 기록지는 스냅샷 없이 즉석 조립본으로 나오고 라인 제거 담당자는 비어 있다.
//
// 이 스크립트는 sessions 한 행의 cancelled/ended_at만 건드린다. 지우는 동작은 없다.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'infusion.db')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? '')
}

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const fmt = (ms) => (ms == null ? '—' : new Date(ms).toLocaleString('ko-KR'))

const restoreId = flag('--restore')
const days = Number(flag('--days') ?? 1) || 1

// ─── 목록 ────────────────────────────────────────────────────────────
if (!restoreId) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const rows = db.prepare(`
    SELECT s.id, s.assigned_at, s.started_at, s.cancel_reason,
           b.room, b.number AS bed_number, p.name, p.chart_no,
           (SELECT COUNT(*) FROM session_orders o WHERE o.session_id = s.id) AS orders,
           (SELECT COUNT(*) FROM rounds r WHERE r.session_id = s.id) AS rounds,
           (SELECT COUNT(*) FROM vitals v WHERE v.session_id = s.id) AS vitals,
           (SELECT COUNT(*) FROM sessions x
             WHERE x.bed_id = s.bed_id AND x.ended_at IS NULL AND x.cancelled = 0) AS bed_busy
    FROM sessions s
    JOIN beds b ON b.id = s.bed_id
    JOIN patients p ON p.id = s.patient_id
    WHERE s.cancelled = 1 AND s.assigned_at >= ?
    ORDER BY s.assigned_at DESC
  `).all(since)

  if (rows.length === 0) {
    console.log(`최근 ${days}일 안에 취소된 배정이 없습니다.`)
    console.log('더 거슬러 보려면: node tools/restore-cancelled.mjs --days 7')
  } else {
    console.log(`최근 ${days}일 취소된 배정 ${rows.length}건\n`)
    for (const r of rows) {
      console.log(`[세션 ${r.id}] ${r.name} (차트 ${r.chart_no}) · ${r.room} ${r.bed_number}번`)
      console.log(`  배정 ${fmt(r.assigned_at)} · 투여시작 ${fmt(r.started_at)}`)
      console.log(`  남아있는 기록 — 처방 ${r.orders} · 라운딩 ${r.rounds} · 바이탈 ${r.vitals}`)
      console.log(`  취소사유: ${r.cancel_reason ?? '(없음)'}`)
      console.log(`  베드 상태: ${r.bed_busy ? '다른 환자 사용중 → --end 로 바로 종료 처리해야 함' : '비어 있음 → 되살리면 카드로 복귀'}`)
      console.log(`  되살리기: node tools/restore-cancelled.mjs --restore ${r.id}\n`)
    }
  }
  db.close()
  process.exit(0)
}

// ─── 되살리기 ────────────────────────────────────────────────────────
const id = Number(restoreId)
const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
if (!session) {
  console.error(`세션 ${id}을(를) 찾을 수 없습니다.`)
  process.exit(1)
}
if (!session.cancelled) {
  console.error(`세션 ${id}은(는) 취소된 상태가 아닙니다. 그대로 두세요.`)
  process.exit(1)
}

const patient = db.prepare('SELECT name, chart_no FROM patients WHERE id = ?').get(session.patient_id)
const bed = db.prepare('SELECT room, number FROM beds WHERE id = ?').get(session.bed_id)

// 같은 베드에 살아있는 세션이 있으면 되살릴 자리가 없다(idx_sessions_one_active가 막는다).
// 먼저 걸러 알아볼 수 있는 메시지를 준다 — UNIQUE 오류만 던지면 무슨 일인지 알 수 없다.
const busy = db.prepare(
  'SELECT id FROM sessions WHERE bed_id = ? AND ended_at IS NULL AND cancelled = 0 LIMIT 1',
).get(session.bed_id)

const endArg = flag('--end')
let endedAt = null
if (endArg !== null) {
  // 'YYYY-MM-DD HH:MM' — 서버 PC의 현지시각으로 읽는다.
  const parsed = new Date(endArg.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) {
    console.error(`--end 시각을 읽을 수 없습니다: "${endArg}" (예: "2026-08-14 15:40")`)
    process.exit(1)
  }
  endedAt = parsed.getTime()
  if (session.started_at && endedAt < session.started_at) {
    console.error(`종료 시각이 투여 시작(${fmt(session.started_at)})보다 빠릅니다.`)
    process.exit(1)
  }
}

if (busy && endedAt === null) {
  console.error(`베드 ${bed.room} ${bed.number}번에 다른 환자(세션 ${busy.id})가 있습니다.`)
  console.error('자리가 없어 카드로 되돌릴 수 없습니다. 종료 시각을 주고 바로 이용기록으로 보내세요:')
  console.error(`  node tools/restore-cancelled.mjs --restore ${id} --end "2026-08-14 15:40"`)
  process.exit(1)
}

db.prepare(`
  UPDATE sessions
  SET cancelled = 0, cancel_reason = NULL, ended_at = COALESCE(?, ended_at)
  WHERE id = ?
`).run(endedAt, id)

// 다른 단말이 폴링으로 바로 받도록 revision을 올린다(앱을 껐다 켤 필요가 없다).
db.prepare('UPDATE app_revision SET value = value + 1 WHERE id = 1').run()

console.log(`세션 ${id} 되살렸습니다 — ${patient.name} (차트 ${patient.chart_no}) · ${bed.room} ${bed.number}번`)
if (endedAt === null) {
  console.log('베드 카드로 돌아왔습니다. 화면에서 평소처럼 [수액 종료]를 눌러 마무리하세요.')
  console.log('(그래야 라인 제거 담당자와 기록지 공식본이 정상으로 굳습니다.)')
} else {
  console.log(`종료 처리했습니다 — 종료 ${fmt(endedAt)}. 이용기록에서 확인하세요.`)
  console.log('기록지는 스냅샷 없이 즉석 조립본으로 나오고, 라인 제거 담당자는 비어 있습니다.')
}
db.close()
