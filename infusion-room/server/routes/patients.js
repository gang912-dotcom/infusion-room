import { Router } from 'express'
import db from '../db.js'
import { normalizeChartNo } from '../lib/validation.js'

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

  const activeCautions = db.prepare(
    `SELECT category, content FROM patient_notes
     WHERE patient_id = ? AND active = 1 AND deleted = 0 AND category IN ('warning', 'caution')
     ORDER BY CASE category WHEN 'warning' THEN 0 WHEN 'caution' THEN 1 ELSE 2 END`,
  ).all(patient.id)

  res.json({ found: true, chart_no: patient.chart_no, name: patient.name, active_cautions: activeCautions })
})

export default router
