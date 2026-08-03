import { Router } from 'express'
import db from '../db.js'
import { normalizeChartNo } from '../lib/validation.js'
import { bumpRevision } from '../lib/revision.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const router = Router()

router.get('/patients/lookup', (req, res) => {
  const normalized = normalizeChartNo(req.query.chart_no)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const patient = db.prepare('SELECT id, chart_no, name FROM patients WHERE chart_no = ?').get(normalized)
  if (!patient) {
    return res.json({ found: false, chart_no: normalized })
  }

  // 등록 모달의 특이사항 칸을 채워줄 값 — 이 환자의 직전 방문에 적힌 특이사항.
  // 매 방문 새로 받되(세션 단위 1회성) 지난 내용이 떠서 다시 타이핑할 필요가 없게 하는 편의.
  const last = db.prepare(
    `SELECT special_note FROM sessions
     WHERE patient_id = ? AND special_note IS NOT NULL AND deleted = 0
     ORDER BY assigned_at DESC LIMIT 1`,
  ).get(patient.id)

  res.json({
    found: true,
    chart_no: patient.chart_no,
    name: patient.name,
    last_special_note: last?.special_note ?? null,
  })
})

// 환자 조회 화면에서 특정 환자의 상세(이용이력·라운딩·특이사항·주의사항)를 열 때 프론트가 부른다.
// 상세 내용 자체는 이미 클라이언트가 들고 있는 데이터로 그리므로, 이 요청은 "누가 누구 기록을 열어봤나"를
// 남기는 용도다. 계정은 쿠키에서 서버가 직접 확인하므로(requireAuth) 클라이언트가 위조할 수 없다.
router.post('/patients/:chartNo/detail-view', (req, res) => {
  const normalized = normalizeChartNo(req.params.chartNo)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const patient = db.prepare('SELECT id FROM patients WHERE chart_no = ?').get(normalized)
  if (!patient) return res.status(404).json({ error: '존재하지 않는 환자입니다' })

  logAccess(req, ACTIONS.PATIENT_VIEW, { targetType: 'patient', targetId: patient.id })
  res.json({ ok: true })
})

// ─── 환자 메모 ───────────────────────────────────────────────────────
// 차트번호 기준이라 방문을 넘어 유지된다 — 같은 환자가 다시 오면 그대로 뜬다.
// (세션 단위인 sessions.special_note '특이사항'과는 다른 것.)
//
// 테이블 이름 주의: patient_notes가 아니라 patient_memos다. patient_notes는 은퇴한
// 구 '주의사항' 기능이 쓰던 이름이고 스키마가 전혀 다르다(자세한 경위는 schema.sql 주석).
router.get('/patient-memos/:chartNo', (req, res) => {
  const normalized = normalizeChartNo(req.params.chartNo)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }
  const row = db.prepare('SELECT note FROM patient_memos WHERE chart_no = ?').get(normalized)
  res.json({ note: row?.note ?? '' })
})

router.put('/patient-memos/:chartNo', (req, res) => {
  const normalized = normalizeChartNo(req.params.chartNo)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
  db.prepare(`
    INSERT INTO patient_memos (chart_no, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(chart_no) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(normalized, note, Date.now())
  // 카드에 뜨는 값이라 다른 단말도 폴링으로 받아야 한다.
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
