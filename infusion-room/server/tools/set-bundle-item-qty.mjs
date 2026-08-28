// 묶음처방에서 특정 항목의 수량을 일괄로 바꾼다.
// 관리자 화면에서 묶음을 하나씩 열어 고치는 것과 같은 결과를, 여러 묶음에 한 번에 적용한다.
//
//   node server/tools/set-bundle-item-qty.mjs --item lainec --from 4 --to 2           ← 미리보기(기본)
//   node server/tools/set-bundle-item-qty.mjs --item lainec --from 4 --to 2 --apply   ← 실제 적용
//
// 기본은 미리보기다. --apply 를 붙여야 쓴다. 적용 직전에 DB 사본을 자동으로 남긴다.
//
// 왜 --from 을 받나: 「4개짜리만 2개로」처럼 현재 수량이 맞는 행만 고치기 위해서다.
// 어떤 묶음이 의도적으로 다른 수량을 쓰고 있으면 그건 건드리지 않는다.
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

// ── 인자 ──
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const APPLY = argv.includes('--apply')
const itemCode = arg('item')
const fromQty = Number(arg('from'))
const toQty = Number(arg('to'))

if (!itemCode || !Number.isFinite(fromQty) || !Number.isFinite(toQty)) {
  console.error('사용법: --item <코드> --from <현재수량> --to <바꿀수량> [--apply]')
  process.exit(1)
}
if (toQty <= 0) {
  console.error('거부: 수량을 0 이하로 만들 수 없습니다. 항목을 빼려면 관리자 화면에서 체크를 해제하세요.')
  process.exit(1)
}

const dbPath = process.env.DB_PATH || path.join('server', 'data', 'infusion.db')
if (!fs.existsSync(dbPath)) {
  console.error(`거부: DB 가 없습니다 — ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

// ── 항목이 실재하는지 먼저 확인 — 오타로 0건이 나오면 "바꿀 게 없다"와 구별이 안 된다 ──
const item = db.prepare('SELECT code, label, is_active FROM order_items WHERE code = ?').get(itemCode)
if (!item) {
  console.error(`거부: 카탈로그에 없는 항목 코드입니다 — '${itemCode}'`)
  console.error('가능한 코드:', db.prepare('SELECT code FROM order_items ORDER BY code').all().map((r) => r.code).join(', '))
  process.exit(1)
}

// ── 대상 조회 ──
const targets = db.prepare(`
  SELECT b.id, b.name, b.emr_code, bi.dose, bi.qty
  FROM order_bundle_items bi
  JOIN order_bundles b ON b.id = bi.bundle_id
  WHERE bi.item_code = ? AND bi.qty = ?
  ORDER BY b.sort_order, b.id`).all(itemCode, fromQty)

// 참고용 — 같은 항목인데 수량이 달라 안 건드리는 것들
const others = db.prepare(`
  SELECT b.id, b.name, b.emr_code, bi.qty
  FROM order_bundle_items bi
  JOIN order_bundles b ON b.id = bi.bundle_id
  WHERE bi.item_code = ? AND bi.qty != ?
  ORDER BY b.sort_order, b.id`).all(itemCode, fromQty)

console.log(`DB       : ${dbPath}`)
console.log(`항목     : ${item.label} (${item.code})${item.is_active ? '' : '  ※ 비활성 항목'}`)
console.log(`바꿀 것  : 수량 ${fromQty} → ${toQty}`)
console.log(`대상     : 묶음 ${targets.length}개\n`)

if (targets.length === 0) {
  console.log('바꿀 것이 없습니다.')
  if (others.length) {
    console.log(`\n(${itemCode} 이(가) 든 다른 묶음 ${others.length}개는 수량이 다릅니다)`)
    for (const o of others) console.log(`  qty ${o.qty}  [${o.emr_code ?? '-'}] ${o.name}`)
  }
  process.exit(0)
}

for (const t of targets) {
  console.log(`  ${String(t.qty).padStart(4)} → ${String(toQty).padEnd(4)} [${t.emr_code ?? '-'}] ${t.name}${t.dose ? `  dose=${t.dose}` : ''}`)
}
if (others.length) {
  console.log(`\n건드리지 않는 것 (수량이 ${fromQty} 이 아님) — ${others.length}개:`)
  for (const o of others) console.log(`  qty ${o.qty}  [${o.emr_code ?? '-'}] ${o.name}`)
}

if (!APPLY) {
  console.log('\n미리보기입니다. 실제로 바꾸려면 같은 명령에 --apply 를 붙이세요.')
  process.exit(0)
}

// ── 백업 후 적용 ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = `${dbPath}.bak-${stamp}`
db.backup(backupPath)

const upd = db.prepare(`
  UPDATE order_bundle_items SET qty = ?
  WHERE item_code = ? AND qty = ?`)
const info = db.transaction(() => upd.run(toQty, itemCode, fromQty))()

console.log(`\n✓ 백업: ${backupPath}`)
console.log(`✓ ${info.changes}개 행을 ${fromQty} → ${toQty} 로 바꿨습니다.`)

// ── 검증 — 남은 게 없어야 한다 ──
const left = db.prepare('SELECT count(*) n FROM order_bundle_items WHERE item_code = ? AND qty = ?').get(itemCode, fromQty).n
const now = db.prepare('SELECT count(*) n FROM order_bundle_items WHERE item_code = ? AND qty = ?').get(itemCode, toQty).n
console.log(`✓ 확인: 수량 ${fromQty} 인 묶음 ${left}개, 수량 ${toQty} 인 묶음 ${now}개`)

console.log('\n※ 앱은 묶음 목록을 로그인할 때 한 번만 받습니다.')
console.log('  이미 열려 있는 상황판·아이패드는 새로고침해야 바뀐 수량이 보입니다.')
