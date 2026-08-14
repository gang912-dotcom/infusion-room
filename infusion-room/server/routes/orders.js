import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { DOSE_MAX_LENGTH, QTY_MAX, roundQty } from '../lib/validation.js'

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
    // 체크·수량 옆에 붙는 용량 칸(페라미플루 mL). free_text와 달리 체크를 대체하지 않는다.
    free_dose: row.free_dose === 1,
    sort_order: row.sort_order,
    // route 없이 보내면 IV/IM/SC 자동 체크가 화면에서 아무 일도 안 한다.
    route: row.route ?? null,
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

// ─── 묶음처방 조회 — 처방 확인 모달의 묶음 버튼 + 관리자 화면이 같이 쓴다 ───
// 읽기 전용이라 모든 로그인 사용자에게 열려 있다. 편집은 /api/admin 쪽.
router.get('/order-bundles', (req, res) => {
  // 버튼 순서 = 묶음코드 오름차순(0·1·2·3·110-10·200·200-10). 원장님이 부르는 순서와
  // 같아야 근무자가 찾는다. CAST는 앞자리 숫자만 읽어 '110-10'을 110으로 본다.
  // 코드가 같은 숫자로 시작하면 문자열로 가르고('200' → '200-10'), 코드가 없으면 뒤로.
  // 숫자로 시작하지 않는 코드(corti1·iv20)도 CAST가 0으로 읽어 '0' 바로 뒤에 끼어든다 —
  // 두 번째 항이 그걸 맨 뒤로 보낸다. 관리자 목록(adminOrders.js)과 같은 식이어야 한다.
  const bundles = db.prepare(`
    SELECT id, name, emr_code, sort_order FROM order_bundles WHERE is_active = 1
    ORDER BY (emr_code IS NULL), (CAST(emr_code AS INTEGER) = 0 AND emr_code <> '0'),
             CAST(emr_code AS INTEGER), emr_code, sort_order, id
  `).all()
  const itemsStmt = db.prepare('SELECT item_code AS code, dose, qty FROM order_bundle_items WHERE bundle_id = ?')
  res.json(bundles.map((b) => ({
    id: b.id, name: b.name, emr_code: b.emr_code ?? null, items: itemsStmt.all(b.id),
  })))
})

// ─── 처방 조회 — 처방 확인 모달 프리필용 ────────────────────────────
// board payload에는 일부러 안 싣는다. 40여 항목을 3초 폴링마다 전 베드에 실을 이유가 없다.
router.get('/sessions/:id/prescription', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const items = db.prepare(
    'SELECT item_code AS code, dose, qty FROM session_orders WHERE session_id = ?',
  ).all(session.id)
  // bundle_id는 처방 내용이 아니라 '어느 묶음에서 시작했나'라는 대조 기준이다.
  // 화면이 이걸로 묶음을 되찾아 "묶음에서 뭘 바꿨나"를 다시 계산한다.
  res.json({ items, visit_symptom: session.visit_symptom, bundle_id: session.order_bundle_id ?? null })
})

// ─── 처방 저장 — 오더 체크 + 내원당시증상을 한 번에 ──────────────────
// 부분 갱신이 아니라 세션 단위 전체 재작성이다. 화면이 늘 전체 상태를 들고 있으므로
// 지운 항목을 따로 추려 보낼 필요가 없고, 중간에 실패해도 트랜잭션이 통째로 되돌린다.
router.put('/sessions/:id/prescription', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const { items, visit_symptom: visitSymptom, bundle_id: bundleId } = req.body ?? {}
  if (items !== undefined && !Array.isArray(items)) {
    return res.status(400).json({ error: 'items는 배열이어야 합니다' })
  }
  const rows = items ?? []

  // 묶음 기준. null은 '묶음 없이 직접 골랐다'는 뜻이라 정상값이다.
  // 없는 id면 FK 위반으로 500이 나므로 여기서 400으로 잡는다. 비활성 묶음도 받는다 —
  // 이미 그 묶음으로 작성 중인 처방을 관리자가 내렸다고 저장이 막히면 안 된다.
  if (bundleId !== undefined && bundleId !== null) {
    if (!Number.isInteger(bundleId)
        || !db.prepare('SELECT 1 FROM order_bundles WHERE id = ?').get(bundleId)) {
      return res.status(400).json({ error: `알 수 없는 묶음입니다: ${bundleId}` })
    }
  }

  // 존재하지 않는 code가 섞이면 통째로 거부한다 — 일부만 저장되면 기록지가 조용히 틀어진다.
  // 같은 항목을 dose만 달리해 두 번 보내는 건 정상이다(NS 180 + NS 110). 같은 (code, dose)가
  // 두 번 오면 PK가 막아 500이 나므로 여기서 400으로 잡는다.
  // qty 규칙(0.01 단위·상한)은 lib/validation.js 한 곳에 있다 — 관리자 묶음 저장과
  // 같은 규칙이어야 한다. SQLite는 INTEGER 선언 컬럼에도 0.5를 real로 보존한다.
  const known = new Set(db.prepare('SELECT code FROM order_items').all().map((r) => r.code))
  const seen = new Set()
  const parsed = []
  for (const row of rows) {
    if (!row || typeof row.code !== 'string' || !known.has(row.code)) {
      return res.status(400).json({ error: `알 수 없는 오더 항목입니다: ${row?.code}` })
    }
    const dose = typeof row.dose === 'string' ? row.dose.trim() : ''
    if (dose.length > DOSE_MAX_LENGTH) {
      return res.status(400).json({ error: `용량은 ${DOSE_MAX_LENGTH}자를 넘을 수 없습니다: ${row.code}` })
    }
    const key = `${row.code} ${dose}`
    if (seen.has(key)) {
      return res.status(400).json({ error: `같은 항목이 같은 용량으로 두 번 있습니다: ${row.code}` })
    }
    seen.add(key)

    const rawQty = row.qty === undefined ? 1 : row.qty
    if (typeof rawQty !== 'number' || !Number.isFinite(rawQty) || rawQty <= 0 || rawQty > QTY_MAX) {
      return res.status(400).json({ error: `수량은 0보다 크고 ${QTY_MAX} 이하인 숫자여야 합니다: ${row.code}` })
    }
    parsed.push({ code: row.code, dose, qty: roundQty(rawQty) })
  }

  const trimmedSymptom = typeof visitSymptom === 'string' ? visitSymptom.trim() : ''
  const del = db.prepare('DELETE FROM session_orders WHERE session_id = ?')
  const ins = db.prepare('INSERT INTO session_orders (session_id, item_code, dose, qty) VALUES (?, ?, ?, ?)')
  const updateSymptom = db.prepare('UPDATE sessions SET visit_symptom = ? WHERE id = ?')
  const updateBundle = db.prepare('UPDATE sessions SET order_bundle_id = ? WHERE id = ?')

  db.transaction(() => {
    del.run(session.id)
    for (const row of parsed) ins.run(session.id, row.code, row.dose, row.qty)
    if (visitSymptom !== undefined) updateSymptom.run(trimmedSymptom || null, session.id)
    // 항목과 같은 트랜잭션에 둔다 — 처방만 바뀌고 기준이 옛 묶음으로 남으면
    // 다시 열었을 때 엉뚱한 변경 브리핑이 뜬다.
    if (bundleId !== undefined) updateBundle.run(bundleId, session.id)
  })()

  // 내원당시증상은 상세에 바로 보여야 하므로 다른 단말도 폴링으로 받게 한다.
  bumpRevision(db)
  res.json({ ok: true })
})

export default router
