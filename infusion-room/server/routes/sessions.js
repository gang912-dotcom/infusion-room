import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { assertInRange, isUniqueConstraintError, normalizeChartNo } from '../lib/validation.js'
import { buildSessionRecord, attachSignatures } from '../lib/record.js'

const router = Router()

// 진료실 번호 — 연속이 아니다(4·5진료실은 없음). 클라(App.jsx EXAM_ROOMS)와 같은 목록.
const EXAM_ROOMS = ['1', '2', '3', '6', '7']

// 미선택('')은 NULL로, 목록에 없는 값은 거부한다(호출부에서 400).
function normalizeExamRoom(value) {
  if (value === undefined || value === null || value === '') return null
  const room = String(value)
  return EXAM_ROOMS.includes(room) ? room : undefined
}

function getSetting(key) {
  return Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(key).value)
}

function getSessionOr404(id, res) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    res.status(404).json({ error: '존재하지 않는 세션입니다' })
    return null
  }
  return session
}

// ─── assign — 라인실에서 베드 배정 ─────────────────────────────────
router.post('/sessions/assign', (req, res) => {
  const {
    bed_code, chart_no, patient_name, line_staff_id,
    special_note: specialNote, exam_room: examRoom,
  } = req.body ?? {}
  if (!bed_code || !chart_no || !patient_name || !line_staff_id) {
    return res.status(400).json({ error: 'bed_code, chart_no, patient_name, line_staff_id가 모두 필요합니다' })
  }

  // 진료실은 선택 항목이라 미선택은 통과시키되, 목록 밖의 값은 거부한다.
  const normalizedExamRoom = normalizeExamRoom(examRoom)
  if (normalizedExamRoom === undefined) {
    return res.status(400).json({ error: '유효하지 않은 진료실입니다' })
  }

  const normalizedChartNo = normalizeChartNo(chart_no)
  if (normalizedChartNo === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const bed = db.prepare('SELECT id FROM beds WHERE code = ? AND is_active = 1').get(bed_code)
  if (!bed) return res.status(404).json({ error: '존재하지 않는 베드입니다' })

  const lineStaff = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').get(line_staff_id)
  if (!lineStaff) return res.status(400).json({ error: '유효하지 않은 라인 담당자입니다' })

  const now = Date.now()
  let patient = db.prepare('SELECT id, name FROM patients WHERE chart_no = ?').get(normalizedChartNo)
  if (patient) {
    if (patient.name !== patient_name) {
      db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ?').run(patient_name, now, patient.id)
    }
  } else {
    const info = db.prepare(
      'INSERT INTO patients (chart_no, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(normalizedChartNo, patient_name, now, now)
    patient = { id: info.lastInsertRowid }
  }

  let sessionId
  try {
    // 특이사항은 이 방문 단위 자유기재. 빈 문자열은 NULL로 저장해 "없음"과 구분되지 않게 한다.
    const trimmedNote = typeof specialNote === 'string' ? specialNote.trim() : ''
    const info = db.prepare(
      `INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id, special_note, exam_room)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(bed.id, patient.id, now, req.account.id, lineStaff.id, trimmedNote || null, normalizedExamRoom)
    sessionId = info.lastInsertRowid
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: '이미 배정된 자리입니다' })
    }
    throw err
  }

  bumpRevision(db)
  const warning = Number(normalizedChartNo) > getSetting('chart_no_max')
    ? '차트번호가 상한을 초과했습니다'
    : undefined
  res.status(201).json({ id: sessionId, bed_code, chart_no: normalizedChartNo, assigned_at: now, warning })
})

// ─── patient — 배정 후 환자명/차트번호 정정 ─────────────────────────
router.patch('/sessions/:id/patient', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }

  const { patient_name, chart_no } = req.body ?? {}
  if (!patient_name || !chart_no) {
    return res.status(400).json({ error: 'patient_name, chart_no가 필요합니다' })
  }
  const normalizedChartNo = normalizeChartNo(chart_no)
  if (normalizedChartNo === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const existing = db.prepare('SELECT id FROM patients WHERE chart_no = ?').get(normalizedChartNo)
  if (existing && existing.id !== session.patient_id) {
    return res.status(409).json({ error: '이미 다른 환자에게 등록된 차트번호입니다' })
  }

  db.prepare('UPDATE patients SET name = ?, chart_no = ?, updated_at = ? WHERE id = ?')
    .run(patient_name, normalizedChartNo, Date.now(), session.patient_id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── start — 수액실에서 투여 시작 ───────────────────────────────────
router.post('/sessions/:id/start', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.cancelled) return res.status(400).json({ error: '취소된 배정입니다' })
  if (session.started_at !== null) return res.status(400).json({ error: '이미 시작된 세션입니다' })

  // 내원당시증상은 3a단계에서 '처방 확인'(PUT /sessions/:id/prescription)으로 옮겼다.
  // 투여 시작은 급할 때 먼저 눌러야 하므로 기록 입력과 엮지 않는다.
  const { mix_staff_id, duration_minutes } = req.body ?? {}
  const mixStaff = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').get(mix_staff_id)
  if (!mixStaff) return res.status(400).json({ error: '유효하지 않은 믹스 담당자입니다' })

  const minDuration = getSetting('min_duration_min')
  if (typeof duration_minutes !== 'number' || duration_minutes < minDuration) {
    return res.status(400).json({ error: `소요시간은 최소 ${minDuration}분 이상이어야 합니다` })
  }

  const now = Date.now()
  const startedAt = req.body?.started_at !== undefined ? Number(req.body.started_at) : now
  try {
    assertInRange(startedAt, session.assigned_at, now, '시작 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  db.prepare(
    'UPDATE sessions SET started_at = ?, started_by = ?, mix_staff_id = ?, duration_minutes = ? WHERE id = ?',
  ).run(startedAt, req.account.id, mixStaff.id, duration_minutes, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── bed — 베드 변경 ────────────────────────────────────────────────
router.patch('/sessions/:id/bed', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }

  const bed = db.prepare('SELECT id FROM beds WHERE code = ? AND is_active = 1').get(req.body?.bed_code)
  if (!bed) return res.status(404).json({ error: '존재하지 않는 베드입니다' })

  try {
    db.prepare('UPDATE sessions SET bed_id = ? WHERE id = ?').run(bed.id, session.id)
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(409).json({ error: '이미 배정된 자리입니다' })
    throw err
  }
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── duration — 소요시간 조정 ───────────────────────────────────────
router.patch('/sessions/:id/duration', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작 전에는 소요시간을 조정할 수 없습니다' })
  }

  const { duration_minutes } = req.body ?? {}
  const minDuration = getSetting('min_duration_min')
  if (typeof duration_minutes !== 'number' || duration_minutes < minDuration) {
    return res.status(400).json({ error: `소요시간은 최소 ${minDuration}분 이상이어야 합니다` })
  }

  db.prepare('UPDATE sessions SET duration_minutes = ? WHERE id = ?').run(duration_minutes, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── started_at — 시작 시각 수정 (늦게 눌렀거나 잘못 입력한 경우 보정) ──
router.patch('/sessions/:id/started-at', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '아직 시작 전인 세션입니다' })
  }

  const startedAt = req.body?.started_at !== undefined ? Number(req.body.started_at) : NaN
  try {
    // 시작 시각은 배정 시각 이후 ~ 지금 사이여야 한다(시작 라우트와 동일 규칙).
    assertInRange(startedAt, session.assigned_at, Date.now(), '시작 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  db.prepare('UPDATE sessions SET started_at = ? WHERE id = ?').run(startedAt, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── cancel — 배정 취소 (라인 실패, 환자 복귀 등) ──────────────────
router.post('/sessions/:id/cancel', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '이미 종료되었거나 취소된 세션입니다' })
  }

  db.prepare('UPDATE sessions SET cancelled = 1, cancel_reason = ? WHERE id = ?')
    .run(req.body?.reason ?? null, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── end — 종료 → 이용기록으로 ─────────────────────────────────────
router.post('/sessions/:id/end', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '이미 종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작되지 않은 세션은 종료할 수 없습니다. 배정 취소를 사용하세요' })
  }

  const now = Date.now()
  const endedAt = req.body?.ended_at !== undefined ? Number(req.body.ended_at) : now
  try {
    assertInRange(endedAt, session.started_at, now, '종료 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  // 종료 처리와 스냅샷 저장을 한 트랜잭션에 묶는다 — 종료됐는데 공식본이 없는 상태가
  // 생기면 안 된다. 조립은 즉석 조회와 같은 함수를 쓴다(미리보기와 종료본이 어긋나지 않게).
  db.transaction(() => {
    db.prepare('UPDATE sessions SET ended_at = ?, ended_by = ? WHERE id = ?').run(endedAt, req.account.id, session.id)
    const record = buildSessionRecord(session.id)
    db.prepare('UPDATE sessions SET record_snapshot = ? WHERE id = ?').run(JSON.stringify(record), session.id)
  })()
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── history — 종료된 세션 목록(이용기록) ───────────────────────────
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.started_at, s.ended_at, s.deleted, s.special_note,
           b.room, b.number AS bed_number,
           p.chart_no, p.name AS patient_name
    FROM sessions s
    JOIN beds b ON b.id = s.bed_id
    JOIN patients p ON p.id = s.patient_id
    WHERE s.ended_at IS NOT NULL
    ORDER BY s.ended_at DESC
  `).all()
  res.json(rows)
})

// ─── 기록지 조회 ────────────────────────────────────────────────────
// 종료됐으면 얼린 스냅샷을, 아니면 지금 DB로 즉석 조립한 것을 준다.
// 이 기능 이전에 종료된 세션은 스냅샷이 없으므로 즉석 조립으로 폴백한다(백필 불필요).
// 서명은 스냅샷에 없고 조회 시점의 직원 값을 붙인다 — 단건 조회라 base64가 실려도 된다.
router.get('/sessions/:id/record', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const record = session.record_snapshot
    ? JSON.parse(session.record_snapshot)
    : buildSessionRecord(session.id)
  if (!record) return res.status(404).json({ error: '기록지를 만들 수 없습니다' })

  res.json({ ...attachSignatures(record), from_snapshot: !!session.record_snapshot })
})

// ─── deleted 토글 — 이용기록 선택 삭제/복구(물리 삭제 아님) ─────────
router.patch('/sessions/:id', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const {
    deleted, special_note: specialNote, exam_room: examRoom, visit_symptom: visitSymptom,
  } = req.body ?? {}
  if (deleted === undefined && specialNote === undefined
      && examRoom === undefined && visitSymptom === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  const normalizedExamRoom = normalizeExamRoom(examRoom)
  if (normalizedExamRoom === undefined) {
    return res.status(400).json({ error: '유효하지 않은 진료실입니다' })
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (specialNote !== undefined) {
    const trimmed = typeof specialNote === 'string' ? specialNote.trim() : ''
    fields.push('special_note = ?')
    params.push(trimmed || null)
  }
  if (examRoom !== undefined) { fields.push('exam_room = ?'); params.push(normalizedExamRoom) }
  if (visitSymptom !== undefined) {
    const trimmed = typeof visitSymptom === 'string' ? visitSymptom.trim() : ''
    fields.push('visit_symptom = ?')
    params.push(trimmed || null)
  }
  params.push(session.id)

  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  // 특이사항·진료실·내원당시증상은 상세에 바로 보여야 하므로 다른 단말도 폴링으로 받게 revision을 올린다.
  if (specialNote !== undefined || examRoom !== undefined || visitSymptom !== undefined) bumpRevision(db)
  res.json({ ok: true })
})

export default router
