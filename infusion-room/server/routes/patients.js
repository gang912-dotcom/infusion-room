import { Router } from 'express'
import db from '../db.js'
import { normalizeChartNo } from '../lib/validation.js'
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

export default router
