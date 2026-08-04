import db from '../db.js'

// ─── 기록지 조립 ─────────────────────────────────────────────────────
// 종료 시 스냅샷 저장과 진행 중 즉석 조회가 **같은 함수**를 쓴다.
// 따로 만들면 살아있는 미리보기와 종료본이 조용히 어긋난다.
//
// 반환값은 그대로 JSON으로 굳혀 sessions.record_snapshot에 넣는다.
// 이미지는 넣지 않는다 — 서명은 staff_id만 두고 조회 때 현재 값을 삽입한다.

const sessionStmt = db.prepare(`
  SELECT s.*,
         p.chart_no, p.name AS patient_name,
         b.room, b.number AS bed_number,
         ls.name AS line_staff_name, ms.name AS mix_staff_name,
         es.name AS end_staff_name,
         pm.note AS patient_memo
  FROM sessions s
  JOIN patients p ON p.id = s.patient_id
  JOIN beds b ON b.id = s.bed_id
  JOIN staff ls ON ls.id = s.line_staff_id
  LEFT JOIN staff ms ON ms.id = s.mix_staff_id
  -- 라인 제거 담당자는 이 기능 이전에 종료된 세션엔 없다(LEFT JOIN → NULL).
  LEFT JOIN staff es ON es.id = s.end_staff_id
  -- 환자 메모는 차트번호 기준. 종료 시점의 값이 스냅샷에 그대로 굳는다.
  LEFT JOIN patient_memos pm ON pm.chart_no = p.chart_no
  WHERE s.id = ?
`)

// 라벨 조인에 is_active 필터를 걸지 않는다 — 비활성 항목도 라벨이 풀려야 한다.
// (관리자가 항목을 숨겨도 과거 기록지의 이름이 사라지면 안 되므로.)
const ordersStmt = db.prepare(`
  SELECT so.item_code, so.dose, so.qty, oi.label, oi.group_key, oi.sort_order, oi.route
  FROM session_orders so
  LEFT JOIN order_items oi ON oi.code = so.item_code
  WHERE so.session_id = ?
  ORDER BY oi.group_key, oi.sort_order, so.dose
`)

const vitalsStmt = db.prepare(`
  SELECT occurred_at, temperature, bp_systolic, bp_diastolic, pulse
  FROM vitals WHERE session_id = ? AND deleted = 0 ORDER BY occurred_at
`)

const roundsStmt = db.prepare(`
  SELECT occurred_at, memo FROM rounds
  WHERE session_id = ? AND deleted = 0 ORDER BY occurred_at
`)

const notesStmt = db.prepare(`
  SELECT id, occurred_at, memo FROM session_notes
  WHERE session_id = ? AND deleted = 0 ORDER BY occurred_at
`)

// 증상·조치는 코드로 저장돼 있어 라벨로 풀어 굳힌다(기록지는 사람이 읽는 문서).
const noteSymptomsStmt = db.prepare(`
  SELECT COALESCE(c.label, ns.code) AS label
  FROM session_note_symptoms ns
  LEFT JOIN symptom_codes c ON c.code = ns.code
  WHERE ns.note_id = ?
`)

const noteActionsStmt = db.prepare(`
  SELECT COALESCE(c.label, na.code) AS label
  FROM session_note_actions na
  LEFT JOIN action_codes c ON c.code = na.code
  WHERE na.note_id = ?
`)

export function buildSessionRecord(sessionId) {
  const s = sessionStmt.get(sessionId)
  if (!s) return null

  const usedMinutes = s.started_at && s.ended_at
    ? Math.round((s.ended_at - s.started_at) / 60000)
    : null

  return {
    session_id: s.id,
    assigned_at: s.assigned_at,
    started_at: s.started_at,
    ended_at: s.ended_at,
    used_minutes: usedMinutes,

    patient_name: s.patient_name,
    chart_no: s.chart_no,
    // 방 라벨('2수액실' 등)은 클라 TABS에만 있다. 서버에 사본을 또 두지 않으려고
    // 코드를 그대로 싣고 화면에서 라벨로 푼다(EXAM_ROOMS가 이미 두 벌인 상황이라).
    room: s.room,
    bed_number: s.bed_number,
    exam_room: s.exam_room,

    line_staff_id: s.line_staff_id,
    line_staff_name: s.line_staff_name,
    mix_staff_id: s.mix_staff_id,
    mix_staff_name: s.mix_staff_name,
    end_staff_id: s.end_staff_id,
    end_staff_name: s.end_staff_name,

    visit_symptom: s.visit_symptom,
    special_note: s.special_note,
    patient_memo: s.patient_memo,

    // 체크된 항목만. 라벨은 이 시점 값으로 문자열로 굳는다 — 나중에 관리자가
    // 라벨을 바꿔도 과거 기록지는 그대로다.
    // qty는 1도 그대로 싣는다 — 기록지에서 1을 감출지는 표시하는 쪽이 정한다.
    // 배포 전 스냅샷에는 qty가 없다(undefined) → 읽는 쪽이 1로 보면 된다.
    orders: ordersStmt.all(s.id).map((o) => ({
      label: o.label ?? o.item_code,
      dose: o.dose,
      qty: o.qty ?? 1,
      // 용법 IV|IM|SC. ORD처럼 가변인 항목과 투여경로 체크박스 자체는 NULL이다
      // (경로 항목에 route가 박히면 'IV IV'처럼 자기 이름 뒤에 또 찍힌다).
      route: o.route ?? null,
    })),

    vitals: vitalsStmt.all(s.id).map((v) => ({
      occurred_at: v.occurred_at,
      temperature: v.temperature,
      bp_systolic: v.bp_systolic,
      bp_diastolic: v.bp_diastolic,
      pulse: v.pulse,
    })),

    rounds: roundsStmt.all(s.id).map((r) => ({ occurred_at: r.occurred_at, memo: r.memo })),

    notes: notesStmt.all(s.id).map((n) => ({
      occurred_at: n.occurred_at,
      symptoms: noteSymptomsStmt.all(n.id).map((r) => r.label),
      actions: noteActionsStmt.all(n.id).map((r) => r.label),
      memo: n.memo,
    })),
  }
}

// 서명은 스냅샷에 넣지 않고 조회 시점의 직원 값을 붙인다(세션당 크기를 작게 유지).
const signatureStmt = db.prepare('SELECT signature FROM staff WHERE id = ?')

export function attachSignatures(record) {
  return {
    ...record,
    line_signature: record.line_staff_id ? signatureStmt.get(record.line_staff_id)?.signature ?? null : null,
    mix_signature: record.mix_staff_id ? signatureStmt.get(record.mix_staff_id)?.signature ?? null : null,
    end_signature: record.end_staff_id ? signatureStmt.get(record.end_staff_id)?.signature ?? null : null,
  }
}
