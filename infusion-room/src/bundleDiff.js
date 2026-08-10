// 고른 묶음과 지금 체크된 처방을 대조한다. '고른 처방' 칸의 변경 표시가 여기서 나온다.
//
// 왜 따로 떼어 놨나: 판정이 한 줄짜리가 아니다. 용량은 칸에 타이핑하는 게 아니라
// 용량 버튼 자체가 체크라(App.jsx selectOrderDose), "180을 끄고 110을 켰다"가 내부적으로는
// 뺌+추가로 들어온다. 그걸 다시 '용량 바꿈'으로 읽어 주는 게 이 파일의 일이다.
// 틀리면 근무자가 안 바꾼 걸 바꿨다고 읽는다 → bundleDiff.test.mjs로 지킨다.

// 키는 App.jsx의 checkKey·OrderSummary의 행 key와 같은 규칙이어야 한다.
// orderChecks의 객체 키를 그대로 쓰지 않고 (code, dose)로 다시 만드는 이유:
// 자유입력 항목(증류수 mL)은 타이핑 중 커서가 튀지 않게 객체 키를 code|로 고정해 두고
// 값만 dose에 담는다. 객체 키를 믿으면 그 항목의 용량 변경을 영영 못 본다.
const keyOf = (code, dose) => `${code}|${dose ?? ''}`

// 한 주사제(code) 안에서 용량 하나가 빠지고 하나가 들어왔을 때만 '용량 바꿈'으로 읽는다.
// 2개 이상이면 짝을 안 맞춘다 — NS를 180·110 두 백 다는 처방이 실재해서
// `180·110 → 110`을 용량 변경으로 읽으면 한 백을 뺀 사실이 표시에서 사라진다.
// 애매하면 뺌·추가로 갈라 두는 쪽이 안전하다.
const PAIR_AS_DOSE_CHANGE = 1

/**
 * @param bundleItems 고른 묶음의 항목 [{code, dose, qty}] — 묶음을 안 골랐으면 null
 * @param checks      지금 체크 상태 (App.jsx의 orderChecks)
 * @returns {{marks: Object, removed: Array, changed: boolean}}
 *   marks   키(code|dose) → {kind:'added'} | {kind:'dose', from} | {kind:'qty', from}
 *   removed 묶음엔 있었는데 지금 없는 것 — 목록에 행이 없으니 따로 보여줘야 한다
 *   changed 하나라도 다르면 true (묶음 그대로인지 판단용)
 */
export default function bundleDiff(bundleItems, checks) {
  const none = { marks: {}, removed: [], changed: false }
  if (!bundleItems) return none

  const base = new Map()
  for (const it of bundleItems) {
    base.set(keyOf(it.code, it.dose), { code: it.code, dose: it.dose ?? '', qty: it.qty ?? 1 })
  }
  const cur = new Map()
  for (const row of Object.values(checks)) {
    cur.set(keyOf(row.code, row.dose), { code: row.code, dose: row.dose ?? '', qty: row.qty ?? 1 })
  }

  // 1단계 — 키 단위로 갈라 본다.
  const gone = []   // 묶음에만 있던 것
  const fresh = []  // 지금만 있는 것
  const marks = {}
  for (const [k, v] of base) if (!cur.has(k)) gone.push({ key: k, ...v })
  for (const [k, v] of cur) {
    const b = base.get(k)
    if (!b) fresh.push({ key: k, ...v })
    else if (b.qty !== v.qty) marks[k] = { kind: 'qty', from: b.qty }
  }

  // 2단계 — 같은 code 안에서 1:1로 갈린 것만 '용량 바꿈'으로 되읽는다.
  const goneBy = new Map()
  for (const g of gone) {
    if (!goneBy.has(g.code)) goneBy.set(g.code, [])
    goneBy.get(g.code).push(g)
  }
  const freshBy = new Map()
  for (const f of fresh) {
    if (!freshBy.has(f.code)) freshBy.set(f.code, [])
    freshBy.get(f.code).push(f)
  }

  const paired = new Set()
  for (const [code, outs] of goneBy) {
    const ins = freshBy.get(code) ?? []
    if (outs.length !== PAIR_AS_DOSE_CHANGE || ins.length !== PAIR_AS_DOSE_CHANGE) continue
    marks[ins[0].key] = { kind: 'dose', from: outs[0].dose }
    // 용량만 바꾼 김에 수량도 바꿨을 수 있다. 표시는 한 줄뿐이라 용량을 우선한다 —
    // 근무자가 먼저 알아야 하는 건 어떤 백을 달았느냐다.
    paired.add(outs[0].key)
  }
  for (const f of fresh) if (!marks[f.key]) marks[f.key] = { kind: 'added' }

  const removed = gone
    .filter((g) => !paired.has(g.key))
    .map(({ code, dose, qty }) => ({ code, dose, qty }))

  return { marks, removed, changed: removed.length > 0 || Object.keys(marks).length > 0 }
}
