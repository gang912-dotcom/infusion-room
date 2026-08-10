// 시험 삼아 등록했다 취소해서 남은 더미 환자를 가려낸다.
//
// 판정 규칙은 여기 한 벌만 둔다 — 관리자 화면(routes/admin.js)과 명령줄 도구
// (tools/purge-dummy-patients.mjs)가 같은 것을 본다. 두 벌로 두면 한쪽만 고쳐졌을 때
// 화면에서 안 지운다던 환자를 도구가 지운다.
//
// '그 등록이 만들어낸 환자'는 정확히 가려낼 수 있다 — 환자 행과 세션 행이 같은 요청에서
// 만들어져 created_at과 assigned_at이 같다. EMR에서 일괄 임포트한 환자는 환자가 먼저
// 있었으므로 두 값이 다르다. 이 조건이 '실제 환자인데 라인 실패로 취소된 경우'를 지킨다 —
// '전부 취소됨'만으로 지우면 그 사람들까지 날아간다.
const SAME_REQUEST_MS = 5000   // 같은 요청 안의 시각 오차 여유

// 세션에 붙을 수 있는 기록들. 하나라도 있으면 안 지운다.
const SESSION_RECORDS = {
  rounds: '라운딩',
  session_notes: '증상기록',
  vitals: '바이탈',
  session_orders: '처방',
}

/**
 * @returns {{targets: Array, skipped: Array}}
 *   targets 지워도 되는 환자, skipped 조건은 맞지만 기록이 붙어 있어 손대면 안 되는 환자.
 *   skipped를 따로 돌려주는 이유: 숫자만 알리면 '다 정리됐다'로 읽힌다. 무엇이 왜 빠졌는지
 *   이름으로 보여줘야 사용자가 남은 것을 직접 처리할지 정할 수 있다.
 */
export function findDummyPatients(db) {
  const candidates = db.prepare(`
    SELECT p.id, p.chart_no, p.name, p.created_at, s.n AS session_count
    FROM patients p
    JOIN (SELECT patient_id, MIN(assigned_at) AS first_at, COUNT(*) AS n,
                 SUM(CASE WHEN cancelled = 0 THEN 1 ELSE 0 END) AS valid,
                 SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
          FROM sessions GROUP BY patient_id) s ON s.patient_id = p.id
    WHERE s.valid = 0 AND s.started = 0 AND ABS(s.first_at - p.created_at) < ?
    ORDER BY p.created_at DESC
  `).all(SAME_REQUEST_MS)

  const hasAny = (sql, ...a) => !!db.prepare(sql).get(...a)
  const targets = []
  const skipped = []
  for (const c of candidates) {
    const sids = db.prepare('SELECT id FROM sessions WHERE patient_id = ?').all(c.id).map((r) => r.id)
    let why = null
    for (const sid of sids) {
      for (const [table, label] of Object.entries(SESSION_RECORDS)) {
        if (!why && hasAny(`SELECT 1 FROM ${table} WHERE session_id = ? LIMIT 1`, sid)) why = label
      }
    }
    if (!why && hasAny('SELECT 1 FROM patient_notes WHERE patient_id = ? LIMIT 1', c.id)) why = '환자노트'
    if (why) skipped.push({ ...c, reason: why })
    else targets.push(c)
  }
  return { targets, skipped }
}

/**
 * 넘긴 id 중 '지금 다시 봐도 지워도 되는' 것만 지운다.
 * 목록을 본 시점과 지우는 시점 사이에 누가 그 환자로 뭔가 했을 수 있어서, 화면이 보낸 id를
 * 그대로 믿지 않고 여기서 다시 가려낸다.
 * @returns {{patients: number, sessions: number, chartNos: string[]}}
 */
export function purgeDummyPatients(db, ids) {
  const allowed = new Map(findDummyPatients(db).targets.map((t) => [t.id, t]))
  const list = [...new Set(ids)].map((id) => allowed.get(id)).filter(Boolean)
  if (!list.length) return { patients: 0, sessions: 0, chartNos: [] }

  return db.transaction(() => {
    let sessions = 0
    for (const t of list) {
      sessions += db.prepare('DELETE FROM sessions WHERE patient_id = ?').run(t.id).changes
      // patient_memos는 FK가 아니라 chart_no로 붙어 있어 따로 지운다(구 환자메모, 지금은 안 쓴다).
      db.prepare('DELETE FROM patient_memos WHERE chart_no = ?').run(String(t.chart_no))
      db.prepare('DELETE FROM patients WHERE id = ?').run(t.id)
    }
    return { patients: list.length, sessions, chartNos: list.map((t) => String(t.chart_no)) }
  })()
}
