import { Router } from 'express'
import db from '../db.js'
import { normalizeChartNo } from '../lib/validation.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'
import { ROUTE_GROUP } from '../lib/record.js'

// ─── 프렌즈(사내 메신저)가 부르는 읽기 전용 통로 ──────────────────────
// 메시지에 `#차트번호` 로 환자를 언급하면 그 자리에서 수액 내역으로 넘어가는 기능의 서버 쪽.
//
// 규칙 (프렌즈 CLAUDE.md 의 "수액실 연동" 절과 짝이다):
//   - 프렌즈는 이 DB 파일에 직접 붙지 않는다. 여기를 지나야 권한 검사와 열람 로그가 재사용된다.
//   - 프렌즈 DB 에 환자를 복제하지 않는다. 그래서 이 라우터는 볼 때마다 원본을 읽어 준다.
//   - 읽기(GET)만 둔다. 쓰기가 필요해지면 그건 사람이 이 앱에서 할 일이다.
//
// 이 라우터는 requireAuth 앞에 붙고 requireInternal(토큰)만 지난다 — index.js 참고.
const router = Router()

const SEARCH_LIMIT = 20
const HISTORY_LIMIT = 10

// ─── 후보 검색 — `#` 를 치는 동안 부른다 ──────────────────────────────
// 조건은 앱의 GET /api/patients/search 와 같게 둔다(이름 부분일치·차트번호 앞자리 일치).
// 두 화면이 다르게 찾으면 "메신저에서는 안 나오는 환자"가 생긴다.
//
// 기저질환(baseline_note)은 여기서 주지 않는다. 후보 목록은 고르기 위한 것이고,
// 고르기 전 단계까지 병력이 따라다닐 이유가 없다 — 상세에서 준다.
// 로그도 남기지 않는다(목록만 보는 단계는 대상이 아니라는 기존 방침 그대로).
router.get('/patients/search', (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.json([])

  const escaped = q.replace(/[\\%_]/g, '\\$&')

  const rows = db.prepare(`
    SELECT p.chart_no, p.name, p.gender,
           b.room AS active_room, b.number AS active_bed_number
    FROM patients p
    LEFT JOIN sessions s
      ON s.patient_id = p.id AND s.ended_at IS NULL AND s.cancelled = 0
    LEFT JOIN beds b ON b.id = s.bed_id
    WHERE p.name LIKE ? ESCAPE '\\' OR p.chart_no LIKE ? ESCAPE '\\'
    GROUP BY p.id
    ORDER BY CAST(p.chart_no AS INTEGER), p.chart_no
    LIMIT ?
  `).all(`%${escaped}%`, `${escaped}%`, SEARCH_LIMIT)

  res.json(rows.map((r) => ({
    chart_no: r.chart_no,
    name: r.name,
    gender: r.gender ?? null,
    active: r.active_room ? { room: r.active_room, bed_number: r.active_bed_number } : null,
  })))
})

// ─── 환자 카드 — 태그를 눌렀을 때 뜨는 것 ─────────────────────────────
// 한 번에 다 실어 보낸다(현재 이용 + 최근 이용 + 그 처방). 카드를 열 때마다 왕복을 세 번
// 하면 수액실이 조금만 느려도 카드가 조각조각 뜬다.
//
// GET 이지만 열람 로그를 남긴다 — 환자 상세를 여는 행위 자체가 기록 대상이다.
// (앱은 화면이 이미 데이터를 들고 있어서 POST detail-view 로 따로 남기지만, 여기서는
//  이 요청이 곧 열람이라 같은 자리에서 남기는 것이 맞다.)
router.get('/patients/:chartNo', (req, res) => {
  const normalized = normalizeChartNo(req.params.chartNo)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const patient = db.prepare(
    'SELECT id, chart_no, name, baseline_note, gender FROM patients WHERE chart_no = ?',
  ).get(normalized)
  if (!patient) return res.status(404).json({ error: '존재하지 않는 환자입니다' })

  // 지금 이용 중인지. active 조건은 db.js 의 idx_sessions_one_active_patient 와 같아야 한다.
  const active = db.prepare(`
    SELECT s.id, s.assigned_at, s.started_at, s.duration_minutes,
           s.exam_room, s.visit_symptom, s.day_memo,
           b.room, b.number AS bed_number
    FROM sessions s JOIN beds b ON b.id = s.bed_id
    WHERE s.patient_id = ? AND s.ended_at IS NULL AND s.cancelled = 0
    LIMIT 1
  `).get(patient.id)

  // 최근 이용. 취소·삭제된 것은 빼고 종료분만 — '지난번에 뭘 맞았나'가 알고 싶은 것이다.
  const history = db.prepare(`
    SELECT s.id, s.started_at, s.ended_at, s.duration_minutes,
           s.exam_room, s.visit_symptom,
           b.room, b.number AS bed_number
    FROM sessions s JOIN beds b ON b.id = s.bed_id
    WHERE s.patient_id = ? AND s.ended_at IS NOT NULL
      AND s.cancelled = 0 AND s.deleted = 0
    ORDER BY s.ended_at DESC
    LIMIT ?
  `).all(patient.id, HISTORY_LIMIT)

  // 처방을 세션마다 조회하면 N+1 이라 한 번에 받아 묶는다(/history 와 같은 방식).
  const ids = [...history.map((h) => h.id), ...(active ? [active.id] : [])]
  const ordersBySession = new Map()
  if (ids.length) {
    const rows = db.prepare(`
      SELECT so.session_id, so.item_code, so.dose, so.qty,
             oi.label, oi.route, oi.group_key
      FROM session_orders so
      LEFT JOIN order_items oi ON oi.code = so.item_code
      WHERE so.session_id IN (${ids.map(() => '?').join(',')})
      ORDER BY oi.group_key, oi.sort_order, so.dose
    `).all(...ids)
    for (const o of rows) {
      if (!ordersBySession.has(o.session_id)) ordersBySession.set(o.session_id, [])
      ordersBySession.get(o.session_id).push({
        label: o.label ?? o.item_code,
        dose: o.dose,
        // 투여경로 그룹은 수량 개념이 없어 null 로 보낸다(record.js 와 같은 규칙).
        qty: o.group_key === ROUTE_GROUP ? null : o.qty,
        route: o.route ?? null,
      })
    }
  }

  const withOrders = (s) => ({ ...s, orders: ordersBySession.get(s.id) ?? [] })

  logAccess(req, ACTIONS.PATIENT_VIEW, { targetType: 'patient', targetId: patient.id })

  res.json({
    chart_no: patient.chart_no,
    name: patient.name,
    gender: patient.gender ?? null,
    baseline_note: patient.baseline_note ?? null,
    active: active ? withOrders(active) : null,
    history: history.map(withOrders),
  })
})

// 여기서 끊는다 — 안 그러면 /api/internal 의 오타가 아래 requireAuth 까지 흘러가
// "로그인이 필요합니다"로 답한다. 연동을 붙이는 쪽이 토큰 문제로 오해하기 딱 좋다.
router.use((req, res) => res.status(404).json({ error: '없는 연동 엔드포인트입니다' }))

export default router
