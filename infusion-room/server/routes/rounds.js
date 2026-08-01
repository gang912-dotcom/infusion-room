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

// 전체 조회(데이터관리·환자조회 화면용) — 환자별 조회는 아래 /patients/:patientId/rounds
router.get('/rounds', (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.session_id, r.occurred_at, r.temperature, r.state, r.memo, r.created_at, r.deleted,
           p.chart_no
    FROM rounds r
    JOIN sessions s ON s.id = r.session_id
    JOIN patients p ON p.id = s.patient_id
    ORDER BY r.occurred_at DESC
  `).all()
  res.json(rows)
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

// deleted 토글 + 내용 편집(발생시각·체온·상태·메모)을 함께 받는다. 전달된 필드만 반영.
router.patch('/rounds/:id', (req, res) => {
  const round = db.prepare(`
    SELECT r.id, s.started_at FROM rounds r
    JOIN sessions s ON s.id = r.session_id WHERE r.id = ?
  `).get(req.params.id)
  if (!round) return res.status(404).json({ error: '존재하지 않는 라운딩입니다' })

  const { deleted, occurred_at: occurredAt, temperature, state, memo } = req.body ?? {}
  if (deleted === undefined && occurredAt === undefined && temperature === undefined
      && state === undefined && memo === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  // 발생 시각은 생성 때와 같은 범위 규칙(세션 시작 ~ 지금)을 적용한다.
  if (occurredAt !== undefined) {
    try {
      assertInRange(Number(occurredAt), round.started_at, Date.now(), '발생 시각')
    } catch (err) {
      return res.status(err.status).json({ error: err.message })
    }
  }
  if (state !== undefined && state !== null
      && !db.prepare('SELECT 1 FROM round_states WHERE code = ?').get(state)) {
    return res.status(400).json({ error: '유효하지 않은 라운딩 상태 코드입니다' })
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (occurredAt !== undefined) { fields.push('occurred_at = ?'); params.push(Number(occurredAt)) }
  if (temperature !== undefined) { fields.push('temperature = ?'); params.push(temperature) }
  if (state !== undefined) { fields.push('state = ?'); params.push(state) }
  if (memo !== undefined) { fields.push('memo = ?'); params.push(memo) }
  params.push(round.id)

  db.prepare(`UPDATE rounds SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
