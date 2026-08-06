import { Router } from 'express'
import db from '../db.js'

// 관리자 전용 — index.js에서 '/api/admin' + requireAdmin으로 마운트된다.
// 읽기용 GET /order-items, GET /order-bundles는 orders.js(모든 로그인 사용자)에 있다.
const router = Router()

// code는 저장의 기준이라 절대 바뀌면 안 된다(session_orders·order_bundle_items가 code로 참조).
// 그래서 신규 생성 때만 서버가 만든다. 한글 라벨은 ASCII 슬러그가 비므로 'item'으로 떨어지고,
// 충돌하면 뒤에 숫자를 붙인다.
function generateCode(label) {
  const base = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
  const exists = db.prepare('SELECT 1 FROM order_items WHERE code = ?')
  if (!exists.get(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!exists.get(candidate)) return candidate
  }
}

// dose_options는 DB에 쉼표 문자열로 둔다(3a와 같은 형식). 빈 배열은 NULL.
function normalizeDoseOptions(value) {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value)
    ? value
    : String(value).split(',')
  const cleaned = list.map((d) => String(d).trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(',') : null
}

function itemPayload(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    group_key: row.group_key,
    dose_options: row.dose_options ? row.dose_options.split(',') : null,
    free_text: row.free_text === 1,
    sort_order: row.sort_order,
    is_active: row.is_active === 1,
    route: row.route ?? null,
  }
}

// ─── Order 항목 ──────────────────────────────────────────────────────

// 관리자 화면은 비활성 항목도 봐야 한다(다시 켜려면 보여야 하므로) — is_active 필터 없음.
router.get('/order-items', (req, res) => {
  const rows = db.prepare('SELECT * FROM order_items ORDER BY group_key, sort_order').all()
  res.json(rows.map(itemPayload))
})

// 투여경로. NULL은 '용법에 따라 가변'(ORD) — 자동 체크에 기여하지 않는다.
const ROUTES = ['IV', 'IM', 'SC']
function normalizeRoute(value, res) {
  if (value === undefined || value === null || value === '') return null
  if (!ROUTES.includes(value)) {
    res.status(400).json({ error: `경로는 ${ROUTES.join('/')} 중 하나이거나 비워야 합니다` })
    return undefined
  }
  return value
}

router.post('/order-items', (req, res) => {
  const { label, group_key: groupKey, dose_options: doseOptions, free_text: freeText, sort_order: sortOrder, route } = req.body ?? {}
  if (!String(label ?? '').trim()) return res.status(400).json({ error: '라벨이 필요합니다' })
  if (!String(groupKey ?? '').trim()) return res.status(400).json({ error: '그룹이 필요합니다' })
  // route를 안 받으면 관리자가 새로 만든 항목은 영원히 자동 체크에 안 걸린다.
  const normalizedRoute = normalizeRoute(route, res)
  if (normalizedRoute === undefined) return

  const info = db.prepare(
    'INSERT INTO order_items (code, label, group_key, dose_options, free_text, sort_order, route) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    generateCode(label),
    String(label).trim(),
    String(groupKey).trim(),
    normalizeDoseOptions(doseOptions),
    freeText ? 1 : 0,
    Number.isInteger(sortOrder) ? sortOrder : 0,
    normalizedRoute,
  )
  res.status(201).json(itemPayload(db.prepare('SELECT * FROM order_items WHERE id = ?').get(info.lastInsertRowid)))
})

// code는 일부러 안 받는다 — 바꾸면 과거 session_orders와 묶음 참조가 끊긴다.
router.patch('/order-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id)
  if (!item) return res.status(404).json({ error: '존재하지 않는 항목입니다' })

  const { label, group_key: groupKey, dose_options: doseOptions, free_text: freeText, sort_order: sortOrder, is_active: isActive, route } = req.body ?? {}
  const fields = []
  const params = []
  if (route !== undefined) {
    const normalizedRoute = normalizeRoute(route, res)
    if (normalizedRoute === undefined) return
    fields.push('route = ?'); params.push(normalizedRoute)
  }
  if (label !== undefined) {
    if (!String(label).trim()) return res.status(400).json({ error: '라벨이 필요합니다' })
    fields.push('label = ?'); params.push(String(label).trim())
  }
  if (groupKey !== undefined) {
    if (!String(groupKey).trim()) return res.status(400).json({ error: '그룹이 필요합니다' })
    fields.push('group_key = ?'); params.push(String(groupKey).trim())
  }
  if (doseOptions !== undefined) { fields.push('dose_options = ?'); params.push(normalizeDoseOptions(doseOptions)) }
  if (freeText !== undefined) { fields.push('free_text = ?'); params.push(freeText ? 1 : 0) }
  if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(Number(sortOrder) || 0) }
  if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0) }
  if (fields.length === 0) return res.status(400).json({ error: '변경할 값이 없습니다' })

  params.push(item.id)
  db.prepare(`UPDATE order_items SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  res.json(itemPayload(db.prepare('SELECT * FROM order_items WHERE id = ?').get(item.id)))
})

// 한 번이라도 쓰인 항목은 지우지 않는다 — 지우면 과거 기록의 라벨이 안 풀린다.
// 대신 비활성(is_active=0)을 쓰라고 409로 안내한다.
router.delete('/order-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id)
  if (!item) return res.status(404).json({ error: '존재하지 않는 항목입니다' })

  const usedInSessions = db.prepare('SELECT 1 FROM session_orders WHERE item_code = ? LIMIT 1').get(item.code)
  const usedInBundles = db.prepare('SELECT 1 FROM order_bundle_items WHERE item_code = ? LIMIT 1').get(item.code)
  if (usedInSessions || usedInBundles) {
    return res.status(409).json({
      error: '사용 중인 항목이라 완전삭제할 수 없습니다. 비활성으로 숨길 수 있습니다.',
      used_in: { sessions: !!usedInSessions, bundles: !!usedInBundles },
    })
  }

  db.prepare('DELETE FROM order_items WHERE id = ?').run(item.id)
  res.json({ ok: true })
})

// ─── 묶음처방 ────────────────────────────────────────────────────────

// 관리자 화면은 비활성 묶음도 본다.
router.get('/order-bundles', (req, res) => {
  // 처방 확인 화면의 버튼 순서와 같게 — 관리자가 표에서 대조할 때 순서가 어긋나면 헷갈린다.
  // 정렬식은 orders.js와 한 글자도 다르면 안 된다(두 번째 항은 corti1·iv20처럼 숫자로
  // 시작하지 않는 코드를 맨 뒤로 보낸다 — CAST가 0으로 읽어 '0' 뒤에 끼어든다).
  const bundles = db.prepare(`
    SELECT * FROM order_bundles
    ORDER BY (emr_code IS NULL), (CAST(emr_code AS INTEGER) = 0 AND emr_code <> '0'),
             CAST(emr_code AS INTEGER), emr_code, sort_order, id
  `).all()
  const itemsStmt = db.prepare('SELECT item_code AS code, dose, qty FROM order_bundle_items WHERE bundle_id = ?')
  res.json(bundles.map((b) => ({
    id: b.id, name: b.name, emr_code: b.emr_code ?? null,
    sort_order: b.sort_order, is_active: b.is_active === 1, items: itemsStmt.all(b.id),
  })))
})

// 오타로 들어간 큰 수가 기록지에 그대로 인쇄되므로 상한을 둔다(처방 저장과 같은 값).
const BUNDLE_QTY_MAX = 99

// items의 code가 하나라도 모르는 값이면 통째로 거부한다(3a의 처방 저장과 같은 규칙).
function validateBundleItems(items, res) {
  if (items !== undefined && !Array.isArray(items)) {
    res.status(400).json({ error: 'items는 배열이어야 합니다' })
    return null
  }
  const rows = items ?? []
  const known = new Set(db.prepare('SELECT code FROM order_items').all().map((r) => r.code))
  // 같은 항목을 dose만 달리해 두 번 담는 건 정상(NS 180 + NS 110). 같은 (code, dose) 중복은
  // PK가 막아 500이 되므로 여기서 400으로 잡는다. qty는 처방 저장과 같은 규칙.
  const seen = new Set()
  const parsed = []
  for (const row of rows) {
    if (!row || typeof row.code !== 'string' || !known.has(row.code)) {
      res.status(400).json({ error: `알 수 없는 오더 항목입니다: ${row?.code}` })
      return null
    }
    const dose = typeof row.dose === 'string' ? row.dose.trim() : ''
    const key = `${row.code} ${dose}`
    if (seen.has(key)) {
      res.status(400).json({ error: `같은 항목이 같은 용량으로 두 번 있습니다: ${row.code}` })
      return null
    }
    seen.add(key)

    const rawQty = row.qty === undefined ? 1 : row.qty
    if (typeof rawQty !== 'number' || !Number.isFinite(rawQty) || rawQty <= 0 || rawQty > BUNDLE_QTY_MAX) {
      res.status(400).json({ error: `수량은 0보다 크고 ${BUNDLE_QTY_MAX} 이하인 숫자여야 합니다: ${row.code}` })
      return null
    }
    const qty = Math.round(rawQty * 10) / 10
    parsed.push({ code: row.code, dose, qty })
  }
  return parsed
}

const insertBundleItem = db.prepare(
  'INSERT INTO order_bundle_items (bundle_id, item_code, dose, qty) VALUES (?, ?, ?, ?)',
)

// validateBundleItems가 이미 dose·qty를 정리해서 준다 — 여기서 다시 손대지 않는다.
// (qty를 안 싣던 버전에서는 관리자가 묶음을 저장할 때마다 수량이 1로 날아갔다.)
function writeBundleItems(bundleId, rows) {
  for (const row of rows) insertBundleItem.run(bundleId, row.code, row.dose, row.qty)
}

// EMR 묶음코드. 처방 확인 모달의 버튼에 이 값이 찍힌다(원장님·근무자가 이 코드로 부른다).
// 빈 값은 NULL — 버튼은 코드가 없으면 이름으로 떨어진다.
function normalizeEmrCode(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

router.post('/order-bundles', (req, res) => {
  const { name, items, sort_order: sortOrder, emr_code: emrCode } = req.body ?? {}
  if (!String(name ?? '').trim()) return res.status(400).json({ error: '묶음 이름이 필요합니다' })
  const rows = validateBundleItems(items, res)
  if (rows === null) return

  const create = db.transaction(() => {
    const info = db.prepare('INSERT INTO order_bundles (name, emr_code, sort_order) VALUES (?, ?, ?)')
      .run(String(name).trim(), normalizeEmrCode(emrCode), Number.isInteger(sortOrder) ? sortOrder : 0)
    writeBundleItems(info.lastInsertRowid, rows)
    return info.lastInsertRowid
  })
  res.status(201).json({ id: create() })
})

router.patch('/order-bundles/:id', (req, res) => {
  const bundle = db.prepare('SELECT * FROM order_bundles WHERE id = ?').get(req.params.id)
  if (!bundle) return res.status(404).json({ error: '존재하지 않는 묶음입니다' })

  const { name, items, sort_order: sortOrder, is_active: isActive, emr_code: emrCode } = req.body ?? {}
  // emr_code를 이 가드에 넣지 않으면 코드만 바꾸는 요청이 전부 400으로 튕긴다.
  if (name === undefined && items === undefined && sortOrder === undefined
      && isActive === undefined && emrCode === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: '묶음 이름이 필요합니다' })
  }
  const rows = items === undefined ? null : validateBundleItems(items, res)
  if (items !== undefined && rows === null) return

  const fields = []
  const params = []
  if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()) }
  if (emrCode !== undefined) { fields.push('emr_code = ?'); params.push(normalizeEmrCode(emrCode)) }
  if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(Number(sortOrder) || 0) }
  if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0) }

  db.transaction(() => {
    if (fields.length) {
      params.push(bundle.id)
      db.prepare(`UPDATE order_bundles SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    }
    // items는 전량 재작성 — 무엇이 빠졌는지 따로 추릴 필요가 없다.
    if (rows !== null) {
      db.prepare('DELETE FROM order_bundle_items WHERE bundle_id = ?').run(bundle.id)
      writeBundleItems(bundle.id, rows)
    }
  })()
  res.json({ ok: true })
})

// 묶음은 '적용 순간 체크를 채우는 도구'일 뿐이고 세션은 개별 code로 저장한다.
// 그래서 지워도 과거 기록이 안 깨진다 — 완전삭제를 허용한다.
router.delete('/order-bundles/:id', (req, res) => {
  const bundle = db.prepare('SELECT * FROM order_bundles WHERE id = ?').get(req.params.id)
  if (!bundle) return res.status(404).json({ error: '존재하지 않는 묶음입니다' })

  db.transaction(() => {
    db.prepare('DELETE FROM order_bundle_items WHERE bundle_id = ?').run(bundle.id)
    db.prepare('DELETE FROM order_bundles WHERE id = ?').run(bundle.id)
  })()
  res.json({ ok: true })
})

export default router
