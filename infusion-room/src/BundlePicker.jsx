import { useLayoutEffect, useRef } from 'react'
import './bundlePicker.css'

// 처방 작성 모달의 묶음 고르는 줄.
//
// 예전엔 버튼 22개가 코드만 달고 평평하게 3줄(144px)로 늘어서 있었다. 눈이 짚을 데가 없고,
// 스크롤 영역 맨 위라 체크리스트를 보러 내리면 화면 밖으로 사라져서 다른 묶음으로 바꾸려면
// 도로 올라와야 했다(.modal__body는 보이는 575px에 내용 1,638px — 실측).
// 그래서 코드로 덩어리를 지어 태그로 나누고, 스크롤 영역 위에 고정한다.

// ─── 덩어리 나누기 ───────────────────────────────────────────────────
// emr_code의 '-' 앞을 자른다. 22개 → 6덩어리(번호4 · 110:6 · 180:1 · 200:5 · corti2 · iv20:4).
// 근무자는 묶음을 '코드(숫자)'로 부르고 그걸로 찾는다. 용량 같은 세부는 어차피 EMR 처방과
// 대조하므로, 한글 병명으로 묶으면 오히려 찾는 단서가 흐려진다 — 그래서 코드로만 묶는다.
function groupKeyOf(code) {
  if (!code) return '기타'
  if (/^\d$/.test(code)) return '번호'   // 0·1·2·3은 한 덩어리
  const base = code.split('-')[0]
  // 대시가 없는 corti1·corti2는 base가 각자 남아 쪼개진다 — 앞 글자 뭉치로 묶는다.
  const alpha = base.match(/^[A-Za-z]+/)
  return alpha ? alpha[0] : base
}

// 라벨은 그 덩어리 코드들의 '공통 앞부분'이다 — corti1·corti2 → corti,
// iv20·iv20-1 → iv20, 110-10·110-31 → 110. 묶는 키(iv)를 그대로 쓰면 iv20이 iv로 보인다.
function commonPrefix(list) {
  if (!list.length) return ''
  let p = list[0]
  for (const s of list.slice(1)) {
    let i = 0
    while (i < p.length && i < s.length && p[i] === s[i]) i++
    p = p.slice(0, i)
  }
  return p.replace(/-+$/, '')
}

function groupBundles(bundles) {
  const map = new Map()
  for (const b of bundles) {
    const k = groupKeyOf(b.emr_code)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(b)
  }
  // 서버가 이미 코드 오름차순으로 보내므로 처음 나온 순서를 그대로 쓴다.
  return [...map.entries()].map(([key, items]) => ({
    key,
    items,
    label: key === '번호' ? '번호' : (commonPrefix(items.map((b) => b.emr_code || '')) || key),
  }))
}

export default function BundlePicker({ bundles, onPick, pickedId = null }) {
  // 고정 막대의 실제 높이를 재서 --bp-stick-h로 넘긴다. 오른쪽 '고른 처방' 칸이 그 값만큼
  // 내려붙어야 스크롤할 때 윗부분이 막대 밑으로 안 들어간다. 폭에 따라 막대가 2~3줄로
  // 바뀌므로 고정값으로는 어긋난다(실측).
  const stickRef = useRef(null)
  useLayoutEffect(() => {
    const el = stickRef.current
    const body = el?.closest('.modal__body')
    if (!body) return undefined
    const measure = () => {
      body.style.setProperty('--bp-stick-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  // 묶음이 0개여도 줄은 그대로 둔다 — 관리자가 등록하는 순간 아래 체크리스트가 밀려
  // 내려가면 근무자가 누르던 자리가 바뀐다(자리를 미리 비워둔다).
  if (!bundles.length) {
    return (
      <div className="order-bundles">
        <span className="order-bundles__label">묶음</span>
        <span className="order-bundles__empty">등록된 묶음이 없습니다</span>
      </div>
    )
  }

  const groups = groupBundles(bundles)

  return (
    <div className="bp-stick" ref={stickRef}>
      <div className="bp-flow">
        {groups.map((g, i) => (
          <span key={g.key} className="bp-flow__group">
            {i > 0 && <span className="bp-flow__sep" aria-hidden="true" />}
            <span className="bp-flow__tag">{g.label}</span>
            {g.items.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`order-bundle-btn bp-big${b.id === pickedId ? ' bp-on' : ''}`}
                onClick={() => onPick(b)}
                /* 버튼에는 EMR 묶음코드를 찍는다 — 원장님·근무자가 이 코드로 부른다.
                   전체 이름은 눌러보기 전에 확인할 수 있게 title로 남긴다. */
                title={b.name}
              >
                {b.emr_code || b.name}
              </button>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}
