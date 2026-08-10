// 고른 처방만 모아 보여주는 칸 — EMR 차팅과 한 줄씩 대조하려고 만든 것이다.
//
// 왜 필요한가: 체크리스트는 6그룹 3열이라 본문이 575px 창에 1,638px이다(실측).
// 묶음을 누르면 체크가 여기저기 흩어져 켜지는데, "이 처방에 뭐가 들었나"를 확인하려면
// 그 1,638px을 다 훑어야 했다.
//
// 표기는 기록지·CSV와 같은 규칙을 쓴다: `라벨(용량) ×수량 용법`.
// 용법은 IM·SC만 찍는다 — 수액은 IV가 기본이라 줄마다 반복되면 정작 예외인 IM·SC가 묻힌다.

import bundleDiff, { VITD_CODE } from './bundleDiff'

const ROUTE_SHOWN = ['IM', 'SC']

// 바뀐 줄에 붙는 한 마디. 지금 값은 이미 줄에 있으므로(용량은 이름 옆 괄호, 수량은 꼬리의 ×N)
// 여기엔 '무엇이 어디서 왔는지'만 적는다 — 같은 숫자를 두 번 찍으면 읽는 눈이 느려진다.
function MarkTag({ mark }) {
  if (!mark) return null
  if (mark.kind === 'added') return <span className="bp-summary__mark bp-summary__mark--add">추가</span>
  if (mark.kind === 'dose') return <span className="bp-summary__mark">용량 {mark.from}에서</span>
  // ×N을 늘리고 줄인 것도 근무자에겐 용량 변경이다 — 앰플을 두 개 달면 그만큼 더 들어간다.
  return <span className="bp-summary__mark">용량 변경 {mark.from}에서</span>
}

export default function OrderSummary({ items, checks, bundle = null }) {
  const byCode = new Map(items.map((i) => [i.code, i]))

  // 고른 묶음과의 대조. 판정 규칙과 그 근거는 bundleDiff.js에 있다.
  const diff = bundleDiff(bundle?.items ?? null, checks)

  // 체크리스트와 같은 순서로 세운다 — 두 칸을 눈으로 오갈 때 순서가 다르면 대조가 안 된다.
  const rows = []
  for (const item of items) {
    for (const row of Object.values(checks)) {
      if (row.code !== item.code) continue
      rows.push({ ...row, item })
    }
  }

  // 그룹 머리말은 항목이 있을 때만 — 빈 그룹 제목이 칸을 먹으면 대조가 느려진다.
  const groups = []
  for (const r of rows) {
    const key = r.item.group_key
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else groups.push({ key, rows: [r] })
  }

  // 묶음에서 바뀐 것을 종류별로 한 줄씩. 줄에 붙는 표시만으로는 "뭐가 추가되고 빠지고
  // 용량이 바뀌었나"를 알려면 목록을 일일이 훑어야 한다 — 그걸 대신 세워 준다.
  // 순서는 목록과 같다(rows가 이미 체크리스트 순서다).
  const named = (code, dose) => {
    const label = byCode.get(code)?.label ?? code
    return dose ? `${label}(${dose})` : label
  }
  const bucket = { added: [], dose: [], qty: [] }
  for (const r of rows) {
    const mark = diff.marks[`${r.code}|${r.dose ?? ''}`]
    if (!mark) continue
    // 수량은 ×N으로 붙인다 — 이름만 있으면 몇 개 넣었는지 목록을 다시 봐야 한다.
    // 표기는 목록 줄·기록지와 같은 규칙이다(×1도 찍는다).
    if (mark.kind === 'added') bucket.added.push(`${named(r.code, r.dose)}×${r.qty ?? 1}`)
    else if (mark.kind === 'dose') bucket.dose.push(`${named(r.code, '')} ${mark.from}→${r.dose}`)
    else bucket.qty.push(`${named(r.code, r.dose)}×${mark.from}→${r.qty ?? 1}`)
  }
  const brief = [
    { kind: 'added', label: '추가', list: bucket.added },
    { kind: 'dropped', label: '뺌', list: diff.removed.map((d) => named(d.code, d.dose)) },
    // 'n/s 용량'으로 부를 뻔했는데 되돌렸다 — 용량 선택지가 있는 항목이 n/s만이 아니다
    // (메리트씨 5g·10g, 증류수 mL). 그것들이 바뀌면 같은 줄에 걸려 라벨과 어긋난다.
    { kind: 'dose', label: '용량', list: bucket.dose },
    { kind: 'qty', label: '용량 변경', list: bucket.qty },
  ].filter((b) => b.list.length > 0)

  return (
    <aside className="bp-summary" aria-label="고른 처방">
      <div className="bp-summary__head">
        <h4 className="bp-summary__title">고른 처방</h4>
        <span className="bp-summary__count">{rows.length}</span>
      </div>

      {/* 어느 묶음에서 시작했는지. 용량을 손봐도 안 풀린다 — 아래 목록이 그 뒤 손댄 결과라
          둘을 같이 봐야 "이 묶음에서 뭘 바꿨나"가 한눈에 잡힌다. */}
      {bundle ? (
        <p className="bp-summary__from">
          <span className="bp-summary__fromcode">{bundle.emr_code || '묶음'}</span>
          <span className="bp-summary__fromname">{bundle.name}</span>
          {/* 손댄 게 없다는 것도 알아야 하는 정보다 — 표시가 없는 것과 '없음을 확인한 것'은 다르다.
              바뀌면 이 자리에 아래 브리핑 줄들이 대신 선다. */}
          {diff.changed ? null : <span className="bp-summary__same">묶음 그대로</span>}
        </p>
      ) : null}

      {brief.length > 0 ? (
        <ul className="bp-summary__brief">
          {brief.map((b) => (
            <li key={b.kind} className={`bp-summary__briefrow bp-summary__briefrow--${b.kind}`}>
              <span className="bp-summary__brieflabel">{b.label}</span>
              <span className="bp-summary__brieftext">{b.list.join(' · ')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length === 0 ? (
        <p className="bp-summary__empty">아직 고른 항목이 없습니다.</p>
      ) : (
        <ul className="bp-summary__list">
          {groups.map((g) => (
            <li key={g.key} className="bp-summary__group">
              <span className="bp-summary__gkey">{g.key}</span>
              <ul className="bp-summary__items">
                {g.rows.map((r) => {
                  const it = byCode.get(r.code) ?? r.item
                  const route = ROUTE_SHOWN.includes(it.route) ? it.route : ''
                  return (
                    /* 비타D는 몇 달에 한 번 맞는 약이라 묶음에 딸려 들어온 걸 못 보고
                       그대로 나가는 일이 잦다. 목록에서 혼자 빨갛게 서 있게 둔다. */
                    <li
                      key={`${r.code}|${r.dose}`}
                      className={`bp-summary__row${r.code === VITD_CODE ? ' bp-summary__row--alert' : ''}`}
                    >
                      <span className="bp-summary__name">
                        {it.label}
                        {r.dose ? <span className="bp-summary__dose">({r.dose})</span> : null}
                      </span>
                      <MarkTag mark={diff.marks[`${r.code}|${r.dose ?? ''}`]} />
                      <span className="bp-summary__tail">
                        {/* ×1도 찍는다 — 수량이 없는 줄과 1인 줄을 눈으로 구분해야
                            EMR 차팅과 한 줄씩 맞출 수 있다. */}
                        <span className="bp-summary__qty">×{r.qty ?? 1}</span>
                        {route ? <span className="bp-summary__route">{route}</span> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
