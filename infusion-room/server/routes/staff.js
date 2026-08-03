import { Router } from 'express'
import db from '../db.js'

const router = Router()

// 배정/시작 화면의 담당자 선택용 — 관리 목적의 /api/admin/staff와 별개(누구나 조회 가능)
router.get('/staff', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM staff WHERE is_active = 1 ORDER BY sort_order').all())
})

// 서명 원본 — 4b 기록지 렌더가 담당자별로 하나씩 가져간다. 목록에는 안 실리는 값이라
// 여기서만 나간다. 편집은 관리자 전용(PUT /admin/staff/:id/signature).
router.get('/staff/:id/signature', (req, res) => {
  const row = db.prepare('SELECT signature FROM staff WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '존재하지 않는 직원입니다' })
  res.json({ signature: row.signature })
})

export default router
