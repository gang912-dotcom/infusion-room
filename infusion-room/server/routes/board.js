import { Router } from 'express'
import db from '../db.js'
import { getRevision } from '../lib/revision.js'
import { ROUTE_GROUP } from '../lib/record.js'

const router = Router()

const bedsStmt = db.prepare('SELECT id, code, room, number FROM beds WHERE is_active = 1 ORDER BY sort_order')

const activeSessionStmt = db.prepare(`
  SELECT s.id, s.patient_id, s.assigned_at, s.started_at, s.duration_minutes, s.special_note, s.exam_room, s.visit_symptom,
         s.day_memo,
         p.chart_no, p.name AS patient_name,
         ls.name AS line_staff_name, ms.name AS mix_staff_name
  FROM sessions s
  JOIN patients p ON p.id = s.patient_id
  JOIN staff ls ON ls.id = s.line_staff_id
  LEFT JOIN staff ms ON ms.id = s.mix_staff_id
  -- 당일 메모는 이 방문에만 유효하다 → 세션 컬럼이다(구 환자 메모는 차트로 조인했다).
  WHERE s.bed_id = ? AND s.ended_at IS NULL AND s.cancelled = 0
`)

const lastRoundStmt = db.prepare(`
  SELECT occurred_at FROM rounds
  WHERE session_id = ? AND deleted = 0
  ORDER BY occurred_at DESC LIMIT 1
`)

// 카드 우상단 바이탈 — "필드별 최신"이다. 체온만 자주 재고 혈압은 한 번인 상황이 흔해서,
// 최근 레코드 하나만 보면 이전 혈압이 사라진다.
const lastTempStmt = db.prepare(`
  SELECT temperature, occurred_at FROM vitals
  WHERE session_id = ? AND deleted = 0 AND temperature IS NOT NULL
  ORDER BY occurred_at DESC LIMIT 1
`)
// 혈압·맥박은 보통 같이 재므로 한 레코드 단위로 묶어 가져온다.
const lastBpStmt = db.prepare(`
  SELECT bp_systolic, bp_diastolic, pulse, occurred_at FROM vitals
  WHERE session_id = ? AND deleted = 0 AND bp_systolic IS NOT NULL
  ORDER BY occurred_at DESC LIMIT 1
`)
// 혈압 없이 맥박만 잰 경우를 위한 보조.
const lastPulseStmt = db.prepare(`
  SELECT pulse, occurred_at FROM vitals
  WHERE session_id = ? AND deleted = 0 AND pulse IS NOT NULL
  ORDER BY occurred_at DESC LIMIT 1
`)

const noteCountStmt = db.prepare('SELECT COUNT(*) c FROM session_notes WHERE session_id = ? AND deleted = 0')

// 처방 작성 여부만 카드에 필요하다 — 항목 40여 개를 3초 폴링마다 실을 이유는 없으니
// note_count와 같이 정수 하나만 센다.
// 투여경로(IV/IM/SC)는 제외한다. 그건 항목에서 자동으로 켜지는 체크박스라, 그것만 남은
// 상태를 '처방 작성됨'으로 볼 수 없다. order_items에서 사라진 code는 세어 준다
// (라벨을 못 풀어도 처방은 있었던 것이므로).
const orderCountStmt = db.prepare(`
  SELECT COUNT(*) c FROM session_orders so
  LEFT JOIN order_items oi ON oi.code = so.item_code
  WHERE so.session_id = ? AND (oi.group_key IS NULL OR oi.group_key <> ?)
`)

const settingsStmt = db.prepare('SELECT key, value FROM settings')

// 채팅 최신 id — 창이 닫혀 있어도 배지를 띄우려면 필요하다. 보드는 어차피 3초마다
// 폴링하므로 여기 숫자 하나를 얹으면 채팅용 요청이 따로 늘지 않는다.
const chatLatestStmt = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM chat_messages')

// 활성 등록 잠금(5분 안에 갱신된 것)만. 만료된 건 "없는 잠금"으로 친다.
const LOCK_TTL_MS = 5 * 60 * 1000
const activeLockStmt = db.prepare(
  `SELECT l.account_id, a.display_name FROM bed_locks l JOIN accounts a ON a.id = l.account_id
   WHERE l.bed_code = ? AND l.updated_at >= ?`,
)

router.get('/board', (req, res) => {
  const serverNow = Date.now()
  const revision = getRevision(db)
  const since = req.query.since !== undefined ? Number(req.query.since) : null

  if (since !== null && !Number.isNaN(since) && since === revision) {
    // chat_latest_id는 여기에도 실어야 한다. 채팅은 일부러 revision을 안 올리므로
    // (한 줄에 전 단말이 보드를 다시 그릴 이유가 없다) 이걸 빼면 보드가 조용한 동안
    // 채팅 배지가 영영 갱신되지 않는다.
    return res.json({
      server_now: serverNow, revision, unchanged: true, chat_latest_id: chatLatestStmt.get().m,
    })
  }

  const settings = Object.fromEntries(
    settingsStmt.all().map((row) => [row.key, Number(row.value)]),
  )
  const lockThreshold = serverNow - LOCK_TTL_MS

  const beds = bedsStmt.all().map((bed) => {
    const session = activeSessionStmt.get(bed.id)
    if (!session) {
      // 빈 베드에만 등록 잠금이 붙는다. 누가 등록 중이면 lock에 그 사람 이름.
      const lock = activeLockStmt.get(bed.code, lockThreshold)
      return {
        code: bed.code, room: bed.room, number: bed.number, session: null,
        lock: lock ? { account_id: lock.account_id, name: lock.display_name } : null,
      }
    }
    const lastRound = lastRoundStmt.get(session.id)
    const lastTemp = lastTempStmt.get(session.id)
    const lastBp = lastBpStmt.get(session.id)
    const lastPulse = lastPulseStmt.get(session.id)
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
        latest_temp: lastTemp ? { value: lastTemp.temperature, occurred_at: lastTemp.occurred_at } : null,
        latest_bp: lastBp
          ? {
            systolic: lastBp.bp_systolic,
            diastolic: lastBp.bp_diastolic,
            pulse: lastBp.pulse,
            occurred_at: lastBp.occurred_at,
          }
          : null,
        latest_pulse: lastPulse ? { value: lastPulse.pulse, occurred_at: lastPulse.occurred_at } : null,
        note_count: noteCountStmt.get(session.id).c,
        has_prescription: orderCountStmt.get(session.id, ROUTE_GROUP).c > 0,
        special_note: session.special_note,
        day_memo: session.day_memo,
        exam_room: session.exam_room,
        visit_symptom: session.visit_symptom,
      },
    }
  })

  res.json({ server_now: serverNow, revision, settings, beds, chat_latest_id: chatLatestStmt.get().m })
})

export default router
