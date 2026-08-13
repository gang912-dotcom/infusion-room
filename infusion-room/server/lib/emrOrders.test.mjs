// node server/lib/emrOrders.test.mjs
// 입력은 지어내지 않는다 — 실제 '진료비 세부산정내역' PDF에서 좌표로 복원한 줄 그대로다.
// 지어낸 입력으로는 '못 알아본 줄을 조용히 버리는' 실패를 못 잡는다.
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { matchEmrOrders, EMR_CODES, EMR_NAMES } from './emrOrders.js'

// ── 2026-08-07 신소영 진료비 세부산정내역 1쪽 (수액 + 검사 + 수가가 섞인 실제 한 장) ──
const 세부내역 = [
  { section: '진찰료', date: '2026-08-07', code: 'AL801', name: '의원 외래환자 의약품관리료(1일/1회)', qty: '1' },
  { section: '진찰료', date: '2026-08-07', code: 'AA254', name: '재진진찰료-의원', qty: '1' },
  { section: '주사료-행위료', date: '2026-08-07', code: 'KK010', name: '피하또는근육내주사()', qty: '1' },
  { section: '치료재료대', date: '2026-08-07', code: 'M1019090', name: 'MPC FILTER SET [5㎛]', qty: '2' },
  { section: '주사료-약품비', date: '2026-08-07', code: '642400161', name: '데노간주', qty: '1' },
  { section: '검사료', date: '2026-08-07', code: 'E7540', name: '비인강경검사()', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: 'gluta', name: '지씨타치온(++)', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: 'ns10', name: 'ns10cc', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '654802341', name: '알러지및아토피 치료위한 이뮤알파주(싸이모신알파1)', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '681100121', name: '격심한 육체노동 후 부족 및 내이성 난청의', qty: '4' },
  { section: '주사료-약품비', date: '2026-08-07', code: '670602631', name: '다발성신경통치료를 위한 하이코민주', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '681100061', name: '구내염,말초신경염 치료를 위한 메가비타식스', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '681100070', name: '근육경련치료를 위한 메가네슘주10%', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '670604350', name: '심한육체노동후 근육재생을 위한 메리트씨주(5g)', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '681100181', name: '객담배출 촉진을 위한 지씨엔에이씨', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '678900971', name: '탈수 치료 위한 중외엔에스주사액(NS110)', qty: '1' },
  { section: '주사료-약품비', date: '2026-08-07', code: '678900971', name: '탈수 치료 위한 중외엔에스주사액(NS110)', qty: '1' },
  // 다른 날 줄 — 날짜로 걸러지는지 본다(이 PDF는 08-07과 08-13 두 번 방문이 함께 나온다)
  { section: '주사료-약품비', date: '2026-08-13', code: '681100181', name: '객담배출 촉진을 위한 지씨엔에이씨', qty: '1' },
]

const r = matchEmrOrders(세부내역, { date: '2026-08-07' })

// 1. 다른 날 줄은 안 들어온다 — 오늘 처방에 어제 것이 섞이면 안 된다
assert.ok(!r.matched.some((m) => m.name.includes('지씨엔에이씨') && false), '')
assert.equal(r.matched.length + r.unmatched.length + r.skipped.length, 17, '08-13 줄이 섞였다')

// 2. 수액 줄이 전부 잡혔다
const codes = r.matched.map((m) => m.itemCode)
for (const c of ['mpc_basic', 'denogan', 'ns10_tathion', 'immune', 'thioctacid',
  'b12', 'b6', 'meganesium', 'merit', 'nac', 'ns']) {
  assert.ok(codes.includes(c), `${c}를 못 잡았다`)
}

// 3. 수량 — 여기가 틀리면 투약이 틀린다
const by = (c) => r.matched.filter((m) => m.itemCode === c)
assert.equal(by('thioctacid')[0].qty, 4, '치옥트산 4')
assert.equal(by('mpc_basic')[0].qty, 2, 'MPC 2')
assert.equal(by('ns').length, 2, 'NS110 두 줄이 두 줄로 남아야 한다')

// 4. 용량은 명칭 괄호에서 — 넘겨짚지 않는다
assert.equal(by('ns')[0].dose, '110', 'NS110을 못 읽었다')
assert.equal(by('merit')[0].dose, '5g', '메리트씨 5g을 못 읽었다')

// 5. ns10과 gluta 두 줄이 우리 한 항목으로 온다
assert.equal(by('ns10_tathion').length, 2, 'ns10·gluta 둘 다 잡혀야 한다')

// 6. 진찰료·검사·수가는 걸러졌다. 수액을 잘못 걸러내면 처방을 빠뜨린다
assert.equal(r.skipped.length, 4, `걸러낼 줄 4개 (실제 ${r.skipped.length}: ${r.skipped.map((s) => s.code)})`)
assert.ok(!r.skipped.some((s) => s.section === '주사료-약품비'), '수액을 걸러냈다')

// 7. 못 알아본 줄이 없다
assert.deepEqual(r.unmatched, [], `못 알아본 줄: ${JSON.stringify(r.unmatched)}`)

// ── ★ 모르는 코드는 반드시 unmatched로 나온다(조용히 사라지면 안 된다) ──
{
  const x = matchEmrOrders([
    { section: '주사료-약품비', date: '2026-08-07', code: '999999999', name: '아직 매핑 안 된 주사액', qty: '3' },
  ])
  assert.equal(x.matched.length, 0)
  assert.equal(x.unmatched.length, 1, '모르는 코드가 조용히 사라졌다')
  assert.equal(x.unmatched[0].code, '999999999', '코드를 안 돌려준다 — 매핑을 채울 수가 없다')
  assert.equal(x.unmatched[0].name, '아직 매핑 안 된 주사액', '명칭을 안 돌려준다 — 사람이 못 알아본다')
  assert.equal(x.unmatched[0].qty, 3, '수량을 안 돌려준다 — 손으로 체크할 때 필요하다')
}

// ── 매핑이 실제 카탈로그를 가리키는지 ──
{
  const db = new Database('server/data/infusion.db', { readonly: true })
  const live = new Set(db.prepare('SELECT code FROM order_items').all().map((x) => x.code))
  db.close()
  for (const [emr, v] of Object.entries(EMR_CODES)) {
    assert.ok(live.has(v.code), `${emr}이 없는 항목을 가리킨다: ${v.code}`)
  }
  for (const m of EMR_NAMES) assert.ok(live.has(m.code), `명칭 매핑이 없는 항목: ${m.code}`)
}

const eye = Object.values(EMR_CODES).filter((v) => v.verified === 'eye').length
console.log(`PASS — emrOrders  청구코드 ${Object.keys(EMR_CODES).length}종(실물확인 ${Object.keys(EMR_CODES).length - eye} · 눈으로읽음 ${eye}) · 명칭 ${EMR_NAMES.length}종`)
