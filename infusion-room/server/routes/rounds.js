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

router.post('/sessions/:id/rounds', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작 전에는 라운딩을 기록할 수 없습니다' })
  }

  const { temperature = null, state = null, memo = '' } = req.body ?? {}
  const now = Date.now()
  const occurredAt = req.body?.occurred_at !== undefined ? Number(req.body.occurred_at) : now
  try {
    assertInRange(occurredAt, session.started_at, now, '발생 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  if (state !== null && !db.prepare('SELECT 1 FROM round_states WHERE code = ?').get(state)) {
    return res.status(400).json({ error: '유효하지 않은 라운딩 상태 코드입니다' })
  }

  const info = db.prepare(
    `INSERT INTO rounds (session_id, occurred_at, temperature, state, memo, created_at, account_id, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(session.id, occurredAt, temperature, state, memo, now, req.account.id)

  bumpRevision(db)
  res.status(201).json({ id: info.lastInsertRowid, occurred_at: occurredAt })
})

router.get('/patients/:patientId/rounds', (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.session_id, r.occurred_at, r.temperature, r.state, r.memo, r.created_at
    FROM rounds r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.patient_id = ? AND r.deleted = 0
    ORDER BY r.occurred_at DESC
  `).all(req.params.patientId)
  res.json(rows)
})

router.patch('/rounds/:id', (req, res) => {
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(req.params.id)
  if (!round) return res.status(404).json({ error: '존재하지 않는 라운딩입니다' })

  const { deleted } = req.body ?? {}
  if (typeof deleted !== 'boolean') {
    return res.status(400).json({ error: 'deleted(boolean)가 필요합니다' })
  }

  db.prepare('UPDATE rounds SET deleted = ? WHERE id = ?').run(deleted ? 1 : 0, round.id)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
