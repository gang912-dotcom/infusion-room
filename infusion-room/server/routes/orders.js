import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'

const router = Router()

function getSessionOr404(id, res) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    res.status(404).json({ error: '존재하지 않는 세션입니다' })
    return null
  }
  return session
}

// dose_options는 DB에 '110,180,100' 형태로 들어 있다. 클라가 쓰기 편하게 배열로 풀어서 준다.
function toItemPayload(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    group_key: row.group_key,
    dose_options: row.dose_options ? row.dose_options.split(',') : null,
    free_text: row.free_text === 1,
    sort_order: row.sort_order,
  }
}

// ─── 항목 조회 — 처방 확인 체크리스트가 이걸로 렌더된다(하드코딩 없음) ───
// 읽기 전용이라 모든 로그인 사용자에게 열려 있다. 관리자 CRUD는 3b.
router.get('/order-items', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM order_items WHERE is_active = 1 ORDER BY group_key, sort_order',
  ).all()
  res.json(rows.map(toItemPayload))
})

// ─── 처방 조회 — 처방 확인 모달 프리필용 ────────────────────────────
// board payload에는 일부러 안 싣는다. 40여 항목을 3초 폴링마다 전 베드에 실을 이유가 없다.
router.get('/sessions/:id/prescription', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const items = db.prepare(
    'SELECT item_code AS code, dose FROM session_orders WHERE session_id = ?',
  ).all(session.id)
  res.json({ items, visit_symptom: session.visit_symptom })
})

// ─── 처방 저장 — 오더 체크 + 내원당시증상을 한 번에 ──────────────────
// 부분 갱신이 아니라 세션 단위 전체 재작성이다. 화면이 늘 전체 상태를 들고 있으므로
// 지운 항목을 따로 추려 보낼 필요가 없고, 중간에 실패해도 트랜잭션이 통째로 되돌린다.
router.put('/sessions/:id/prescription', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const { items, visit_symptom: visitSymptom } = req.body ?? {}
  if (items !== undefined && !Array.isArray(items)) {
    return res.status(400).json({ error: 'items는 배열이어야 합니다' })
  }
  const rows = items ?? []

  // 존재하지 않는 code가 섞이면 통째로 거부한다 — 일부만 저장되면 기록지가 조용히 틀어진다.
  const known = new Set(db.prepare('SELECT code FROM order_items').all().map((r) => r.code))
  for (const row of rows) {
    if (!row || typeof row.code !== 'string' || !known.has(row.code)) {
      return res.status(400).json({ error: `알 수 없는 오더 항목입니다: ${row?.code}` })
    }
  }

  const trimmedSymptom = typeof visitSymptom === 'string' ? visitSymptom.trim() : ''
  const del = db.prepare('DELETE FROM session_orders WHERE session_id = ?')
  const ins = db.prepare('INSERT INTO session_orders (session_id, item_code, dose) VALUES (?, ?, ?)')
  const updateSymptom = db.prepare('UPDATE sessions SET visit_symptom = ? WHERE id = ?')

  db.transaction(() => {
    del.run(session.id)
    for (const row of rows) {
      const dose = typeof row.dose === 'string' ? row.dose.trim() : ''
      ins.run(session.id, row.code, dose || null)
    }
    if (visitSymptom !== undefined) updateSymptom.run(trimmedSymptom || null, session.id)
  })()

  // 내원당시증상은 상세에 바로 보여야 하므로 다른 단말도 폴링으로 받게 한다.
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
