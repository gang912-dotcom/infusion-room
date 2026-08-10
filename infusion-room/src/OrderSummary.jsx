// 고른 처방만 모아 보여주는 칸 — EMR 차팅과 한 줄씩 대조하려고 만든 것이다.
//
// 왜 필요한가: 체크리스트는 6그룹 3열이라 본문이 575px 창에 1,638px이다(실측).
// 묶음을 누르면 체크가 여기저기 흩어져 켜지는데, "이 처방에 뭐가 들었나"를 확인하려면
// 그 1,638px을 다 훑어야 했다.
//
// 표기는 기록지·CSV와 같은 규칙을 쓴다: `라벨(용량) ×수량 용법`.
// 용법은 IM·SC만 찍는다 — 수액은 IV가 기본이라 줄마다 반복되면 정작 예외인 IM·SC가 묻힌다.

const ROUTE_SHOWN = ['IM', 'SC']

export default function OrderSummary({ items, checks, bundle = null }) {
  const byCode = new Map(items.map((i) => [i.code, i]))

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
        </p>
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
                    <li key={`${r.code}|${r.dose}`} className="bp-summary__row">
                      <span className="bp-summary__name">
                        {it.label}
                        {r.dose ? <span className="bp-summary__dose">({r.dose})</span> : null}
                      </span>
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
