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

  const patient = db.prepare(
    'SELECT id, chart_no, name, baseline_note FROM patients WHERE chart_no = ?',
  ).get(normalized)
  if (!patient) {
    return res.json({ found: false, chart_no: normalized })
  }

  // 특이사항(기저질환)은 영구다 → 정본 컬럼을 그대로 준다.
  // 세션에서 '최신 non-null'을 찾던 옛 방식은 비워도 옛 값이 되살아나 삭제가 불가능했다.
  // 등록 모달이 이 값을 칸에 채우고, 값이 있으면 라인담당 지정 후 안내 모달이 뜬다.
  res.json({
    found: true,
    chart_no: patient.chart_no,
    name: patient.name,
    baseline_note: patient.baseline_note ?? null,
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

// ─── 은퇴: 환자 메모(patient_memos) ──────────────────────────────────
// 차트별 영구 메모였는데 2026-08-04 개편에서 성격이 갈렸다.
//   영구로 남길 것 → patients.baseline_note('특이사항(기저질환)' 정본)
//   그 방문만    → sessions.day_memo('당일 메모')
// 기존 데이터는 db.js가 baseline_note로 1회 이관했고(settings.baseline_note_migrated),
// patient_memos 테이블은 이관이 잘못됐을 때 돌아갈 원본으로 남겨둔다. 라우트만 없앤다.
//
// 테이블 이름 주의: patient_notes(은퇴한 구 '주의사항')와는 또 다른 테이블이다.

export default router
