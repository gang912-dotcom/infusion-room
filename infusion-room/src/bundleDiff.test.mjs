// node src/bundleDiff.test.mjs
// 프레임워크 없이 assert만 쓴다. 여기가 틀리면 근무자가 안 바꾼 걸 바꿨다고 읽는다.
import assert from 'node:assert/strict'
import bundleDiff from './bundleDiff.js'

// orderChecks의 객체 키는 App.jsx의 checkKey와 같다(자유입력만 예외 — 아래 8번).
const checks = (...rows) => Object.fromEntries(
  rows.map((r) => [`${r.code}|${r.dose ?? ''}`, { qty: 1, dose: '', ...r }]),
)

const NS180 = { code: 'NS', dose: '180' }
const NS110 = { code: 'NS', dose: '110' }
const CEF = { code: 'CEF', dose: '' }

// 1. 묶음을 안 골랐으면 대조할 기준이 없다 → 표시 없음
{
  const d = bundleDiff(null, checks(NS180))
  assert.equal(d.changed, false)
  assert.deepEqual(d.marks, {})
  assert.deepEqual(d.removed, [])
}

// 2. 묶음 그대로 → '묶음 그대로'로 읽혀야 한다
{
  const d = bundleDiff([{ code: 'NS', dose: '180', qty: 1 }], checks(NS180))
  assert.equal(d.changed, false)
}

// 3. 추가 — 묶음에 없던 주사제를 켰다
{
  const d = bundleDiff([{ code: 'NS', dose: '180', qty: 1 }], checks(NS180, CEF))
  assert.deepEqual(d.marks, { 'CEF|': { kind: 'added' } })
  assert.deepEqual(d.removed, [])
  assert.equal(d.changed, true)
}

// 4. 뺌 — 묶음에 있던 걸 껐다. 목록에 행이 없으니 removed로 나와야 한다
{
  const d = bundleDiff(
    [{ code: 'NS', dose: '180', qty: 1 }, { code: 'CEF', dose: '', qty: 1 }],
    checks(NS180),
  )
  assert.deepEqual(d.marks, {})
  assert.deepEqual(d.removed, [{ code: 'CEF', dose: '', qty: 1 }])
}

// 5. 용량 변경 — 내부적으론 뺌+추가로 들어오지만 '180 → 110'으로 읽어야 한다
{
  const d = bundleDiff([{ code: 'NS', dose: '180', qty: 1 }], checks(NS110))
  assert.deepEqual(d.marks, { 'NS|110': { kind: 'dose', from: '180' } })
  assert.deepEqual(d.removed, [], '용량 변경은 뺌으로 중복해 세면 안 된다')
}

// 6. 수량 변경 — 같은 코드·같은 용량인데 개수만 다름
{
  const d = bundleDiff([{ code: 'CEF', dose: '', qty: 1 }], checks({ ...CEF, qty: 2 }))
  assert.deepEqual(d.marks, { 'CEF|': { kind: 'qty', from: 1 } })
}

// 7. 2개 → 1개는 용량 변경이 아니다. NS를 180·110 두 백 다는 처방이 실재하므로
//    '180·110 → 110'을 용량 변경으로 읽으면 한 백을 뺀 사실이 사라진다.
{
  const d = bundleDiff(
    [{ code: 'NS', dose: '180', qty: 1 }, { code: 'NS', dose: '110', qty: 1 }],
    checks(NS110),
  )
  assert.deepEqual(d.marks, {}, '남은 110은 묶음 그대로다')
  assert.deepEqual(d.removed, [{ code: 'NS', dose: '180', qty: 1 }], '뺀 180이 보여야 한다')
}

// 7-b. 거꾸로 1개 → 2개도 짝을 맞추지 않는다(늘린 것이지 바꾼 게 아니다)
{
  const d = bundleDiff([{ code: 'NS', dose: '180', qty: 1 }], checks(NS180, NS110))
  assert.deepEqual(d.marks, { 'NS|110': { kind: 'added' } })
  assert.deepEqual(d.removed, [])
}

// 8. 자유입력(증류수 mL)은 객체 키가 code|로 고정이고 값만 dose에 담긴다.
//    객체 키를 그대로 믿으면 이 변경을 영영 못 본다 — (code, dose)로 다시 만들어야 잡힌다.
{
  const d = bundleDiff(
    [{ code: 'DW', dose: '20', qty: 1 }],
    { 'DW|': { code: 'DW', dose: '30', qty: 1 } },
  )
  assert.deepEqual(d.marks, { 'DW|30': { kind: 'dose', from: '20' } })
  assert.deepEqual(d.removed, [])
}

// 9. 묶음 항목의 dose가 NULL로 오는 경우(DB는 빈 용량을 NULL로 둔다) — ''과 같게 봐야 한다
{
  const d = bundleDiff([{ code: 'CEF', dose: null, qty: null }], checks(CEF))
  assert.equal(d.changed, false, 'dose NULL·qty NULL은 dose "" · qty 1과 같다')
}

console.log('PASS — bundleDiff 10/10')
