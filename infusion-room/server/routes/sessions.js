import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { assertInRange, isUniqueConstraintError, normalizeChartNo } from '../lib/validation.js'

const router = Router()

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
  const { bed_code, chart_no, patient_name, line_staff_id } = req.body ?? {}
  if (!bed_code || !chart_no || !patient_name || !line_staff_id) {
    return res.status(400).json({ error: 'bed_code, chart_no, patient_name, line_staff_id가 모두 필요합니다' })
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
    const info = db.prepare(
      `INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(bed.id, patient.id, now, req.account.id, lineStaff.id)
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

// ─── start — 수액실에서 투여 시작 ───────────────────────────────────
router.post('/sessions/:id/start', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.cancelled) return res.status(400).json({ error: '취소된 배정입니다' })
  if (session.started_at !== null) return res.status(400).json({ error: '이미 시작된 세션입니다' })

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

  db.prepare('UPDATE sessions SET ended_at = ?, ended_by = ? WHERE id = ?').run(endedAt, req.account.id, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
