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
  }
}

// ─── Order 항목 ──────────────────────────────────────────────────────

// 관리자 화면은 비활성 항목도 봐야 한다(다시 켜려면 보여야 하므로) — is_active 필터 없음.
router.get('/order-items', (req, res) => {
  const rows = db.prepare('SELECT * FROM order_items ORDER BY group_key, sort_order').all()
  res.json(rows.map(itemPayload))
})

router.post('/order-items', (req, res) => {
  const { label, group_key: groupKey, dose_options: doseOptions, free_text: freeText, sort_order: sortOrder } = req.body ?? {}
  if (!String(label ?? '').trim()) return res.status(400).json({ error: '라벨이 필요합니다' })
  if (!String(groupKey ?? '').trim()) return res.status(400).json({ error: '그룹이 필요합니다' })

  const info = db.prepare(
    'INSERT INTO order_items (code, label, group_key, dose_options, free_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    generateCode(label),
    String(label).trim(),
    String(groupKey).trim(),
    normalizeDoseOptions(doseOptions),
    freeText ? 1 : 0,
    Number.isInteger(sortOrder) ? sortOrder : 0,
  )
  res.status(201).json(itemPayload(db.prepare('SELECT * FROM order_items WHERE id = ?').get(info.lastInsertRowid)))
})

// code는 일부러 안 받는다 — 바꾸면 과거 session_orders와 묶음 참조가 끊긴다.
router.patch('/order-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id)
  if (!item) return res.status(404).json({ error: '존재하지 않는 항목입니다' })

  const { label, group_key: groupKey, dose_options: doseOptions, free_text: freeText, sort_order: sortOrder, is_active: isActive } = req.body ?? {}
  const fields = []
  const params = []
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
  const bundles = db.prepare('SELECT * FROM order_bundles ORDER BY sort_order, id').all()
  const itemsStmt = db.prepare('SELECT item_code AS code, dose FROM order_bundle_items WHERE bundle_id = ?')
  res.json(bundles.map((b) => ({
    id: b.id, name: b.name, sort_order: b.sort_order, is_active: b.is_active === 1, items: itemsStmt.all(b.id),
  })))
})

// items의 code가 하나라도 모르는 값이면 통째로 거부한다(3a의 처방 저장과 같은 규칙).
function validateBundleItems(items, res) {
  if (items !== undefined && !Array.isArray(items)) {
    res.status(400).json({ error: 'items는 배열이어야 합니다' })
    return null
  }
  const rows = items ?? []
  const known = new Set(db.prepare('SELECT code FROM order_items').all().map((r) => r.code))
  for (const row of rows) {
    if (!row || typeof row.code !== 'string' || !known.has(row.code)) {
      res.status(400).json({ error: `알 수 없는 오더 항목입니다: ${row?.code}` })
      return null
    }
  }
  return rows
}

const insertBundleItem = db.prepare('INSERT INTO order_bundle_items (bundle_id, item_code, dose) VALUES (?, ?, ?)')

function writeBundleItems(bundleId, rows) {
  for (const row of rows) {
    const dose = typeof row.dose === 'string' ? row.dose.trim() : ''
    insertBundleItem.run(bundleId, row.code, dose || null)
  }
}

router.post('/order-bundles', (req, res) => {
  const { name, items, sort_order: sortOrder } = req.body ?? {}
  if (!String(name ?? '').trim()) return res.status(400).json({ error: '묶음 이름이 필요합니다' })
  const rows = validateBundleItems(items, res)
  if (rows === null) return

  const create = db.transaction(() => {
    const info = db.prepare('INSERT INTO order_bundles (name, sort_order) VALUES (?, ?)')
      .run(String(name).trim(), Number.isInteger(sortOrder) ? sortOrder : 0)
    writeBundleItems(info.lastInsertRowid, rows)
    return info.lastInsertRowid
  })
  res.status(201).json({ id: create() })
})

router.patch('/order-bundles/:id', (req, res) => {
  const bundle = db.prepare('SELECT * FROM order_bundles WHERE id = ?').get(req.params.id)
  if (!bundle) return res.status(404).json({ error: '존재하지 않는 묶음입니다' })

  const { name, items, sort_order: sortOrder, is_active: isActive } = req.body ?? {}
  if (name === undefined && items === undefined && sortOrder === undefined && isActive === undefined) {
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
