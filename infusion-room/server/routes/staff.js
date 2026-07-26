import { Router } from 'express'
import db from '../db.js'

const router = Router()

// 배정/시작 화면의 담당자 선택용 — 관리 목적의 /api/admin/staff와 별개(누구나 조회 가능)
router.get('/staff', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM staff WHERE is_active = 1 ORDER BY sort_order').all())
})

export default router
