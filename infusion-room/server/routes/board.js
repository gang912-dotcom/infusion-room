import { Router } from 'express'
import db from '../db.js'
import { getRevision } from '../lib/revision.js'

const router = Router()

const bedsStmt = db.prepare('SELECT id, code, room, number FROM beds WHERE is_active = 1 ORDER BY sort_order')

const activeSessionStmt = db.prepare(`
  SELECT s.id, s.patient_id, s.assigned_at, s.started_at, s.duration_minutes,
         p.chart_no, p.name AS patient_name,
         ls.name AS line_staff_name, ms.name AS mix_staff_name
  FROM sessions s
  JOIN patients p ON p.id = s.patient_id
  JOIN staff ls ON ls.id = s.line_staff_id
  LEFT JOIN staff ms ON ms.id = s.mix_staff_id
  WHERE s.bed_id = ? AND s.ended_at IS NULL AND s.cancelled = 0
`)

const lastRoundStmt = db.prepare(`
  SELECT occurred_at, temperature FROM rounds
  WHERE session_id = ? AND deleted = 0
  ORDER BY occurred_at DESC LIMIT 1
`)

const noteCountStmt = db.prepare('SELECT COUNT(*) c FROM session_notes WHERE session_id = ? AND deleted = 0')

// warning/caution만 카드 경고 대상 (info는 제외 — 프론트 getCardNoteLines와 동일 기준)
const cautionCountStmt = db.prepare(`
  SELECT COUNT(*) c FROM patient_notes
  WHERE patient_id = ? AND active = 1 AND deleted = 0 AND category IN ('warning', 'caution')
`)

const settingsStmt = db.prepare('SELECT key, value FROM settings')

router.get('/board', (req, res) => {
  const serverNow = Date.now()
  const revision = getRevision(db)
  const since = req.query.since !== undefined ? Number(req.query.since) : null

  if (since !== null && !Number.isNaN(since) && since === revision) {
    return res.json({ server_now: serverNow, revision, unchanged: true })
  }

  const settings = Object.fromEntries(
    settingsStmt.all().map((row) => [row.key, Number(row.value)]),
  )

  const beds = bedsStmt.all().map((bed) => {
    const session = activeSessionStmt.get(bed.id)
    if (!session) {
      return { code: bed.code, room: bed.room, number: bed.number, session: null }
    }
    const lastRound = lastRoundStmt.get(session.id)
    return {
      code: bed.code,
      room: bed.room,
      number: bed.number,
      session: {
        id: session.id,
        patient_id: session.patient_id,
        patient: { chart_no: session.chart_no, name: session.patient_name },
        assigned_at: session.assigned_at,
        line_staff: session.line_staff_name,
        started_at: session.started_at,
        mix_staff: session.mix_staff_name,
        duration_minutes: session.duration_minutes,
        last_round_at: lastRound?.occurred_at ?? null,
        last_round_temp: lastRound?.temperature ?? null,
        note_count: noteCountStmt.get(session.id).c,
        active_caution_count: cautionCountStmt.get(session.patient_id).c,
      },
    }
  })

  res.json({ server_now: serverNow, revision, settings, beds })
})

export default router
