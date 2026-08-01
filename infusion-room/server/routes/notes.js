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

// 전체 조회(데이터관리 화면용) — 환자별 조회는 아래 /patients/:patientId/session-notes
router.get('/session-notes', (req, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.session_id, n.occurred_at, n.memo, n.created_at, n.deleted,
           p.chart_no, s.started_at
    FROM session_notes n
    JOIN sessions s ON s.id = n.session_id
    JOIN patients p ON p.id = s.patient_id
    ORDER BY n.created_at DESC
  `).all()

  const symptomsStmt = db.prepare('SELECT code FROM session_note_symptoms WHERE note_id = ?')
  const actionsStmt = db.prepare('SELECT code FROM session_note_actions WHERE note_id = ?')
  res.json(rows.map((row) => ({
    ...row,
    // occurred_at은 시작 후 조정 가능하므로 음수 방지만(clamp), 저장하지 않고 매번 계산
    elapsed_min: row.started_at ? Math.max(0, Math.round((row.occurred_at - row.started_at) / 60000)) : 0,
    symptoms: symptomsStmt.all(row.id).map((r) => r.code),
    actions: actionsStmt.all(row.id).map((r) => r.code),
  })))
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

// deleted 토글 + 내용 편집(발생시각·메모·증상·조치)을 함께 받는다. 전달된 필드만 반영.
router.patch('/session-notes/:id', (req, res) => {
  const note = db.prepare(`
    SELECT n.id, s.started_at FROM session_notes n
    JOIN sessions s ON s.id = n.session_id WHERE n.id = ?
  `).get(req.params.id)
  if (!note) return res.status(404).json({ error: '존재하지 않는 특이사항입니다' })

  const { deleted, occurred_at: occurredAt, memo, symptoms, actions } = req.body ?? {}
  if (deleted === undefined && occurredAt === undefined && memo === undefined
      && symptoms === undefined && actions === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  // 발생 시각은 생성 때와 같은 범위 규칙(세션 시작 ~ 지금)을 적용한다.
  if (occurredAt !== undefined) {
    try {
      assertInRange(Number(occurredAt), note.started_at, Date.now(), '발생 시각')
    } catch (err) {
      return res.status(err.status).json({ error: err.message })
    }
  }
  for (const code of symptoms ?? []) {
    if (!db.prepare('SELECT 1 FROM symptom_codes WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `유효하지 않은 증상 코드: ${code}` })
    }
  }
  for (const code of actions ?? []) {
    if (!db.prepare('SELECT 1 FROM action_codes WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `유효하지 않은 조치 코드: ${code}` })
    }
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (occurredAt !== undefined) { fields.push('occurred_at = ?'); params.push(Number(occurredAt)) }
  if (memo !== undefined) { fields.push('memo = ?'); params.push(memo) }

  // 증상·조치는 조인 테이블이라 해당 note 것만 지우고 다시 넣는다(생성 핸들러와 같은 방식).
  // 본문 UPDATE와 함께 트랜잭션으로 묶어 중간에 깨져 반쯤 반영되는 일이 없게 한다.
  const apply = db.transaction(() => {
    if (fields.length) {
      db.prepare(`UPDATE session_notes SET ${fields.join(', ')} WHERE id = ?`).run(...params, note.id)
    }
    if (symptoms !== undefined) {
      db.prepare('DELETE FROM session_note_symptoms WHERE note_id = ?').run(note.id)
      const ins = db.prepare('INSERT INTO session_note_symptoms (note_id, code) VALUES (?, ?)')
      symptoms.forEach((code) => ins.run(note.id, code))
    }
    if (actions !== undefined) {
      db.prepare('DELETE FROM session_note_actions WHERE note_id = ?').run(note.id)
      const ins = db.prepare('INSERT INTO session_note_actions (note_id, code) VALUES (?, ?)')
      actions.forEach((code) => ins.run(note.id, code))
    }
  })
  apply()

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

// 전체 조회(데이터관리 화면용) — 환자별 조회는 아래 /patients/:patientId/patient-notes
router.get('/patient-notes', (req, res) => {
  const rows = db.prepare(`
    SELECT pn.id, pn.category, pn.source, pn.content, pn.active, pn.created_at, pn.updated_at, pn.deleted,
           p.chart_no, p.name AS patient_name
    FROM patient_notes pn
    JOIN patients p ON p.id = pn.patient_id
    ORDER BY pn.created_at DESC
  `).all()
  res.json(rows)
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

  const { deleted, active, content, category, source } = req.body ?? {}
  if (deleted === undefined && active === undefined
      && content === undefined && category === undefined && source === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  // 분류·근거는 생성 때와 같은 코드 유효성 검사를 거친다.
  if (category !== undefined && !db.prepare('SELECT 1 FROM note_categories WHERE code = ?').get(category)) {
    return res.status(400).json({ error: '유효하지 않은 category입니다' })
  }
  if (source !== undefined && source !== null
      && !db.prepare('SELECT 1 FROM note_sources WHERE code = ?').get(source)) {
    return res.status(400).json({ error: '유효하지 않은 source입니다' })
  }
  if (content !== undefined && !String(content).trim()) {
    return res.status(400).json({ error: '내용을 입력하세요' })
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (typeof active === 'boolean') { fields.push('active = ?'); params.push(active ? 1 : 0) }
  if (content !== undefined) { fields.push('content = ?'); params.push(content) }
  if (category !== undefined) { fields.push('category = ?'); params.push(category) }
  if (source !== undefined) { fields.push('source = ?'); params.push(source) }
  fields.push('updated_at = ?')
  params.push(Date.now())
  params.push(note.id)

  db.prepare(`UPDATE patient_notes SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
