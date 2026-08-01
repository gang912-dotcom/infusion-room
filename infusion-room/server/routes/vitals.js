import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { assertInRange } from '../lib/validation.js'

const router = Router()

// 오입력 방어용 가벼운 상한/하한. 임상 판단이 아니라 오타(367℃ 같은 것)를 걸러내는 용도.
const RANGES = {
  temperature: [30, 45],
  bp_systolic: [30, 300],
  bp_diastolic: [30, 300],
  pulse: [20, 250],
}

function getSessionOr404(id, res) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    res.status(404).json({ error: '존재하지 않는 세션입니다' })
    return null
  }
  return session
}

// 넷 다 비면 기록할 게 없고, 혈압은 한쪽만 있으면 의미가 없다.
function validateVitalFields({ temperature, bp_systolic: sys, bp_diastolic: dia, pulse }) {
  const given = [temperature, sys, dia, pulse].filter((v) => v !== undefined && v !== null && v !== '')
  if (given.length === 0) return '혈압/체온/맥박 중 하나는 입력해야 합니다'

  const hasSys = sys !== undefined && sys !== null && sys !== ''
  const hasDia = dia !== undefined && dia !== null && dia !== ''
  if (hasSys !== hasDia) return '혈압은 수축기와 이완기를 함께 입력해야 합니다'

  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const raw = { temperature, bp_systolic: sys, bp_diastolic: dia, pulse }[key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (Number.isNaN(n) || n < min || n > max) return `값이 범위를 벗어났습니다 (${key}: ${min}~${max})`
  }
  return null
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))

// ─── 기록 ───────────────────────────────────────────────────────────
router.post('/sessions/:id/vitals', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작 전에는 바이탈을 기록할 수 없습니다' })
  }

  const invalid = validateVitalFields(req.body ?? {})
  if (invalid) return res.status(400).json({ error: invalid })

  const now = Date.now()
  const occurredAt = req.body?.occurred_at !== undefined ? Number(req.body.occurred_at) : now
  try {
    assertInRange(occurredAt, session.started_at, now, '측정 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  const { temperature, bp_systolic: sys, bp_diastolic: dia, pulse } = req.body ?? {}
  const info = db.prepare(
    `INSERT INTO vitals (session_id, occurred_at, temperature, bp_systolic, bp_diastolic, pulse, created_at, account_id, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(session.id, occurredAt, num(temperature), num(sys), num(dia), num(pulse), now, req.account.id)

  bumpRevision(db)
  res.status(201).json({ id: info.lastInsertRowid, occurred_at: occurredAt })
})

// ─── 조회 (2단 타임라인·데이터 추출용 전역 로드) ─────────────────────
router.get('/vitals', (req, res) => {
  res.json(db.prepare(`
    SELECT v.id, v.session_id, v.occurred_at, v.temperature, v.bp_systolic, v.bp_diastolic,
           v.pulse, v.created_at, v.deleted
    FROM vitals v
    ORDER BY v.occurred_at DESC
  `).all())
})

// ─── 편집·삭제 (전달된 필드만 반영) ──────────────────────────────────
router.patch('/vitals/:id', (req, res) => {
  const vital = db.prepare(`
    SELECT v.id, s.started_at FROM vitals v
    JOIN sessions s ON s.id = v.session_id WHERE v.id = ?
  `).get(req.params.id)
  if (!vital) return res.status(404).json({ error: '존재하지 않는 바이탈 기록입니다' })

  const { deleted, occurred_at: occurredAt } = req.body ?? {}
  const keys = ['temperature', 'bp_systolic', 'bp_diastolic', 'pulse']
  const touched = keys.filter((k) => req.body?.[k] !== undefined)
  if (deleted === undefined && occurredAt === undefined && touched.length === 0) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  // 값 편집이면 저장 후 상태 기준으로 다시 검증한다(편집으로 빈 기록·반쪽 혈압이 되면 안 되므로).
  if (touched.length > 0) {
    const current = db.prepare('SELECT temperature, bp_systolic, bp_diastolic, pulse FROM vitals WHERE id = ?').get(vital.id)
    const merged = { ...current }
    touched.forEach((k) => { merged[k] = req.body[k] })
    const invalid = validateVitalFields(merged)
    if (invalid) return res.status(400).json({ error: invalid })
  }

  if (occurredAt !== undefined) {
    try {
      assertInRange(Number(occurredAt), vital.started_at, Date.now(), '측정 시각')
    } catch (err) {
      return res.status(err.status).json({ error: err.message })
    }
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (occurredAt !== undefined) { fields.push('occurred_at = ?'); params.push(Number(occurredAt)) }
  touched.forEach((k) => { fields.push(`${k} = ?`); params.push(num(req.body[k])) })
  params.push(vital.id)

  db.prepare(`UPDATE vitals SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
