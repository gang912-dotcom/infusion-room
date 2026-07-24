import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { assertInRange } from '../lib/validation.js'

const router = Router()

function getSessionOr404(id, res) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    res.status(404).json({ error: '존재하지 않는 세션입니다' })
    return null
  }
  return session
}

// ─── session_notes — 금일 특이사항 ──────────────────────────────────
router.post('/sessions/:id/session-notes', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작 전에는 특이사항을 기록할 수 없습니다' })
  }

  const { memo = '', symptoms = [], actions = [] } = req.body ?? {}
  const now = Date.now()
  const occurredAt = req.body?.occurred_at !== undefined ? Number(req.body.occurred_at) : now
  try {
    assertInRange(occurredAt, session.started_at, now, '발생 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  for (const code of symptoms) {
    if (!db.prepare('SELECT 1 FROM symptom_codes WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `유효하지 않은 증상 코드: ${code}` })
    }
  }
  for (const code of actions) {
    if (!db.prepare('SELECT 1 FROM action_codes WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `유효하지 않은 조치 코드: ${code}` })
    }
  }

  const info = db.prepare(
    'INSERT INTO session_notes (session_id, occurred_at, memo, created_at, account_id, deleted) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(session.id, occurredAt, memo, now, req.account.id)

  const insertSymptom = db.prepare('INSERT INTO session_note_symptoms (note_id, code) VALUES (?, ?)')
  symptoms.forEach((code) => insertSymptom.run(info.lastInsertRowid, code))
  const insertAction = db.prepare('INSERT INTO session_note_actions (note_id, code) VALUES (?, ?)')
  actions.forEach((code) => insertAction.run(info.lastInsertRowid, code))

  bumpRevision(db)
  res.status(201).json({ id: info.lastInsertRowid, occurred_at: occurredAt })
})

router.get('/patients/:patientId/session-notes', (req, res) => {
  const includeDeleted = req.query.include_deleted === 'true'
  const rows = db.prepare(`
    SELECT n.id, n.session_id, n.occurred_at, n.memo, n.created_at, n.deleted
    FROM session_notes n
    JOIN sessions s ON s.id = n.session_id
    WHERE s.patient_id = ? ${includeDeleted ? '' : 'AND n.deleted = 0'}
    ORDER BY n.created_at DESC
  `).all(req.params.patientId)

  const symptomsStmt = db.prepare('SELECT code FROM session_note_symptoms WHERE note_id = ?')
  const actionsStmt = db.prepare('SELECT code FROM session_note_actions WHERE note_id = ?')
  res.json(rows.map((row) => ({
    ...row,
    symptoms: symptomsStmt.all(row.id).map((r) => r.code),
    actions: actionsStmt.all(row.id).map((r) => r.code),
  })))
})

router.patch('/session-notes/:id', (req, res) => {
  const note = db.prepare('SELECT id FROM session_notes WHERE id = ?').get(req.params.id)
  if (!note) return res.status(404).json({ error: '존재하지 않는 특이사항입니다' })

  const { deleted } = req.body ?? {}
  if (typeof deleted !== 'boolean') {
    return res.status(400).json({ error: 'deleted(boolean)가 필요합니다' })
  }

  db.prepare('UPDATE session_notes SET deleted = ? WHERE id = ?').run(deleted ? 1 : 0, note.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── patient_notes — 환자 주의사항 ──────────────────────────────────
router.post('/patients/:patientId/patient-notes', (req, res) => {
  const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(req.params.patientId)
  if (!patient) return res.status(404).json({ error: '존재하지 않는 환자입니다' })

  const { category, source = null, content } = req.body ?? {}
  if (!category || !content) {
    return res.status(400).json({ error: 'category, content가 필요합니다' })
  }
  if (!db.prepare('SELECT 1 FROM note_categories WHERE code = ?').get(category)) {
    return res.status(400).json({ error: '유효하지 않은 category입니다' })
  }
  if (source !== null && !db.prepare('SELECT 1 FROM note_sources WHERE code = ?').get(source)) {
    return res.status(400).json({ error: '유효하지 않은 source입니다' })
  }

  const now = Date.now()
  const info = db.prepare(
    `INSERT INTO patient_notes (patient_id, category, source, content, active, created_at, updated_at, account_id, deleted)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)`,
  ).run(patient.id, category, source, content, now, now, req.account.id)

  bumpRevision(db)
  res.status(201).json({ id: info.lastInsertRowid })
})

router.get('/patients/:patientId/patient-notes', (req, res) => {
  const includeDeleted = req.query.include_deleted === 'true'
  const rows = db.prepare(`
    SELECT id, category, source, content, active, created_at, updated_at, deleted
    FROM patient_notes
    WHERE patient_id = ? ${includeDeleted ? '' : 'AND deleted = 0'}
    ORDER BY created_at DESC
  `).all(req.params.patientId)
  res.json(rows)
})

router.patch('/patient-notes/:id', (req, res) => {
  const note = db.prepare('SELECT id FROM patient_notes WHERE id = ?').get(req.params.id)
  if (!note) return res.status(404).json({ error: '존재하지 않는 주의사항입니다' })

  const { deleted, active } = req.body ?? {}
  if (deleted === undefined && active === undefined) {
    return res.status(400).json({ error: 'deleted 또는 active 중 하나는 필요합니다' })
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (typeof active === 'boolean') { fields.push('active = ?'); params.push(active ? 1 : 0) }
  fields.push('updated_at = ?')
  params.push(Date.now())
  params.push(note.id)

  db.prepare(`UPDATE patient_notes SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
