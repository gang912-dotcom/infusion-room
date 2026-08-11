import db from '../db.js'

// ─── 환자 수동 삭제 (관리자) ─────────────────────────────────────────
// 검색해서 고른 환자 하나를 그 딸린 기록까지 통째로 지운다.
// 자동 판정(옛 '더미 환자 정리')을 걷어내고, 사람이 눈으로 보고 지우는 방식으로 바꿨다.
//
// foreign_keys = ON이라 자식 행이 남아 있으면 patients 삭제가 막힌다 → 의존 순서대로 지운다.
// ON DELETE CASCADE를 스키마에 안 건 이유: 환자 삭제는 관리자만, 이 경로 하나로만 일어나야 해서
// 실수로 다른 곳에서 연쇄 삭제가 터지는 걸 막으려는 것이다.

// 한 환자에게 붙는 세션-단위 기록. session_id로 걸린다.
const SESSION_CHILDREN = ['rounds', 'vitals', 'session_orders']

/**
 * 지우기 전에 보여줄 '흔적'. 실제 진료 기록이 있으면 화면이 세게 경고하도록 숫자를 준다.
 * @returns {object|null} 없으면 null
 */
export function getPatientFootprint(chartNo) {
  const patient = db.prepare(
    'SELECT id, chart_no, name, created_at FROM patients WHERE chart_no = ?',
  ).get(chartNo)
  if (!patient) return null

  const pid = patient.id
  const sessionIds = db.prepare('SELECT id FROM sessions WHERE patient_id = ?').all(pid).map((r) => r.id)

  const sessionAgg = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN ended_at IS NULL AND cancelled = 0 THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS started,
           SUM(CASE WHEN cancelled = 1 THEN 1 ELSE 0 END) AS cancelled
    FROM sessions WHERE patient_id = ?
  `).get(pid)

  const countIn = (table) => sessionIds.length
    ? db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`)
        .get(...sessionIds).c
    : 0

  return {
    chart_no: patient.chart_no,
    name: patient.name,
    created_at: patient.created_at,
    sessions: {
      total: sessionAgg.total,
      active: sessionAgg.active,
      started: sessionAgg.started,
      cancelled: sessionAgg.cancelled,
    },
    records: {
      rounds: countIn('rounds'),
      vitals: countIn('vitals'),
      orders: countIn('session_orders'),
      notes: db.prepare('SELECT COUNT(*) c FROM session_notes WHERE session_id IN (SELECT id FROM sessions WHERE patient_id = ?)').get(pid).c,
      patientNotes: db.prepare('SELECT COUNT(*) c FROM patient_notes WHERE patient_id = ?').get(pid).c,
    },
  }
}

/**
 * 환자 하나와 딸린 모든 기록을 지운다. 되돌릴 수 없다.
 * 지금 이용 중(활성 세션)이면 거부한다 — 수액 맞고 있는 사람을 지우는 사고를 막는다.
 * @throws {Error & {status:number}}
 * @returns {{chart_no:string, name:string, sessions:number}}
 */
export function deletePatientByChartNo(chartNo) {
  const patient = db.prepare('SELECT id, chart_no, name FROM patients WHERE chart_no = ?').get(chartNo)
  if (!patient) {
    const err = new Error('존재하지 않는 환자입니다')
    err.status = 404
    throw err
  }

  const active = db.prepare(
    'SELECT 1 FROM sessions WHERE patient_id = ? AND ended_at IS NULL AND cancelled = 0 LIMIT 1',
  ).get(patient.id)
  if (active) {
    const err = new Error('지금 이용 중인 환자는 지울 수 없습니다. 이용을 끝낸 뒤 다시 시도하세요.')
    err.status = 409
    throw err
  }

  return db.transaction(() => {
    const sessionIds = db.prepare('SELECT id FROM sessions WHERE patient_id = ?').all(patient.id).map((r) => r.id)
    if (sessionIds.length) {
      const ph = sessionIds.map(() => '?').join(',')
      // session_notes의 자식(증상·처치)을 먼저 → session_notes → 나머지 세션 자식
      const noteIds = db.prepare(`SELECT id FROM session_notes WHERE session_id IN (${ph})`).all(...sessionIds).map((r) => r.id)
      if (noteIds.length) {
        const nph = noteIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM session_note_symptoms WHERE note_id IN (${nph})`).run(...noteIds)
        db.prepare(`DELETE FROM session_note_actions WHERE note_id IN (${nph})`).run(...noteIds)
      }
      db.prepare(`DELETE FROM session_notes WHERE session_id IN (${ph})`).run(...sessionIds)
      for (const table of SESSION_CHILDREN) {
        db.prepare(`DELETE FROM ${table} WHERE session_id IN (${ph})`).run(...sessionIds)
      }
    }
    const s = db.prepare('DELETE FROM sessions WHERE patient_id = ?').run(patient.id).changes
    db.prepare('DELETE FROM patient_notes WHERE patient_id = ?').run(patient.id)
    // patient_memos는 FK가 아니라 chart_no로 붙는 옛 테이블 — 따로 지운다.
    db.prepare('DELETE FROM patient_memos WHERE chart_no = ?').run(String(patient.chart_no))
    db.prepare('DELETE FROM patients WHERE id = ?').run(patient.id)
    return { chart_no: String(patient.chart_no), name: patient.name, sessions: s }
  })()
}
