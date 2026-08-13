// 의사랑 '진료비 세부산정내역' PDF → 우리 처방 항목.
//
// 그 PDF는 글자가 그대로 들어 있고(스캔 아님) 좌표로 표를 복원할 수 있다. 열은 이렇다:
//   항목 | 일자 | 코드 | 명칭 | 금액 | 회수 | 일수 | 총액 | …
// 코드 칸이 청구코드다 — 약마다 유일하고, 제품명이 바뀌어도 안 바뀐다. 그래서 이 표는
// 청구코드를 열쇠로 쓴다. 한글 명칭 맞히기는 코드가 없는 줄(비급여)의 보조 수단이다.
//
// ★ 가장 중요한 규칙: 모르는 줄을 조용히 버리지 않는다.
//   매핑에 없는 코드는 unmatched로 코드·명칭·수량을 그대로 돌려준다. 화면이 그걸
//   "못 알아본 줄"로 보여주면 근무자가 손으로 체크할 수 있다. 처방을 말없이 빠뜨리는 것이
//   이 기능에서 가장 위험한 실패다 — 매핑이 덜 채워진 것보다 훨씬 나쁘다.

// 청구코드 → 항목코드.
// verified: 'pdf'  글자 PDF에서 문자로 확인했다(확실)
//           'eye'  EMR 화면 캡처를 눈으로 읽었다 — 실물로 한 번 더 확인할 것
export const EMR_CODES = {
  '678900971': { code: 'ns', verified: 'pdf' },          // 중외엔에스주사액. 용량은 명칭의 (NS110)
  '681100181': { code: 'nac', verified: 'pdf' },         // 지씨엔에이씨
  '670604350': { code: 'merit', dose: '5g', verified: 'pdf' },
  '681100070': { code: 'meganesium', verified: 'pdf' },  // 메가네슘주10%
  '681100061': { code: 'b6', verified: 'pdf' },          // 메가비타식스
  '670602631': { code: 'b12', verified: 'pdf' },         // 하이코민주
  '681100121': { code: 'thioctacid', verified: 'pdf' },  // 지씨치옥트산
  '654802341': { code: 'immune', verified: 'pdf' },      // 이뮤알파주(싸이모신알파1)
  '642400161': { code: 'denogan', verified: 'pdf' },     // 데노간주
  'M1019090': { code: 'mpc_basic', verified: 'pdf' },    // MPC FILTER SET
  'ns10': { code: 'ns10_tathion', verified: 'pdf' },     // 비급여라 청구코드가 없다 — 원내코드가 열쇠
  'gluta': { code: 'ns10_tathion', verified: 'pdf' },    // ns10과 gluta 두 줄이 우리 한 항목이다

  // 아래는 묶음코드 화면 캡처를 눈으로 읽은 값이다. 세부내역 PDF로 한 번씩 확인할 것.
  '643603410': { code: 'licorice', verified: 'eye' },    // 히시파겐씨주20ml
  '670600790': { code: 'merit', dose: '10g', verified: 'eye' },
  '645104631': { code: 'panbicomp', verified: 'eye' },
  '681100131': { code: 'b5', verified: 'eye' },          // 지씨비타오
  '681100251': { code: 'gcbbon', verified: 'eye' },
  '644913030': { code: 'furiamin', verified: 'eye' },    // 중외후리아민주
  '645102820': { code: 'pediamin', verified: 'eye' },
  '681100026': { code: 'lainec', verified: 'eye' },
  '650900120': { code: 'dipeptiven', verified: 'eye' },
  '681100281': { code: 'multi5', verified: 'eye' },      // 지씨멀티5주
  '653403901': { code: 'vitd', verified: 'eye' },
  '642101421': { code: 'ord_basic', verified: 'eye' },   // 유한디나트륨인산덱사메타손
  '643604610': { code: 'peramiflu', verified: 'eye' },
}

// 코드가 없거나 모르는 줄의 보조 수단. 진료기록부 PDF에는 코드 칸이 아예 없어서 이쪽만 쓴다.
// 명칭은 '심한육체노동후 근육재생을 위한 메리트씨주'처럼 설명이 길고 잘리기도 해서
// 전체 일치가 아니라 제품명 조각으로 맞춘다.
export const EMR_NAMES = [
  { keys: ['생리식염수', '엔에스주'], code: 'ns' },
  { keys: ['지씨엔에이씨'], code: 'nac' },
  { keys: ['히시파겐'], code: 'licorice' },
  { keys: ['메리트씨'], code: 'merit' },
  { keys: ['메가네슘'], code: 'meganesium' },
  { keys: ['판비콤프'], code: 'panbicomp' },
  { keys: ['지씨비타오'], code: 'b5' },
  { keys: ['메가비타식스'], code: 'b6' },
  { keys: ['하이코민'], code: 'b12' },
  { keys: ['지씨비본'], code: 'gcbbon' },
  { keys: ['후리아민'], code: 'furiamin' },
  { keys: ['페디아민'], code: 'pediamin' },
  { keys: ['라이넥'], code: 'lainec' },
  { keys: ['MPC FILTER'], code: 'mpc_basic' },
  { keys: ['데노간'], code: 'denogan' },
  { keys: ['덱사메타손'], code: 'ord_basic' },
  { keys: ['지씨멀티'], code: 'multi5' },
  { keys: ['디펩티벤'], code: 'dipeptiven' },
  { keys: ['타치온'], code: 'ns10_tathion' },
  { keys: ['이뮤알파', '싸이모신'], code: 'immune' },
  { keys: ['치옥트'], code: 'thioctacid' },
]

// 수액 처방이 아닌 줄. 세부내역에는 진찰료·검사·재료대·내복약이 함께 찍힌다.
// '항목' 칸으로 거르는 게 가장 확실하다 — 주사료·치료재료대만 남긴다.
const DRUG_SECTIONS = ['주사료', '치료재료']
const NOT_A_DRUG_CODE = /^(AA|AL|KK|E)\d/    // 진찰료·의약품관리료·처치·검사

/**
 * @param rows [{ section, date, code, name, qty }]  좌표로 복원한 표의 한 줄
 * @param opts.date 이 날짜 줄만 쓴다(생략하면 전부)
 * @returns {{ matched, unmatched, skipped }}
 *   matched   [{ itemCode, dose, qty, code, name }]
 *   unmatched [{ code, name, qty }]  ← 화면에 반드시 보여줄 것
 */
export function matchEmrOrders(rows, opts = {}) {
  const matched = []; const unmatched = []; const skipped = []
  for (const r of rows) {
    const name = (r.name ?? '').trim()
    const code = (r.code ?? '').trim()
    if (opts.date && r.date && r.date !== opts.date) continue

    // 수액이 아닌 줄 걸러내기. section이 있으면 그게 가장 확실하다.
    const bySection = r.section ? !DRUG_SECTIONS.some((s) => r.section.includes(s)) : false
    if (bySection || NOT_A_DRUG_CODE.test(code)) { skipped.push({ code, name, why: '진찰·검사·수가' }); continue }

    const hit = EMR_CODES[code]
      ?? EMR_NAMES.find((m) => m.keys.some((k) => name.includes(k)))
    if (!hit) { unmatched.push({ code, name, qty: num(r.qty) }); continue }

    matched.push({
      itemCode: hit.code,
      dose: hit.dose ?? doseOf(hit.code, name),
      qty: num(r.qty),
      code, name,
    })
  }
  return { matched, unmatched, skipped }
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

// 용량은 명칭 안에 괄호로 온다 — 중외엔에스주사액(NS110), 메리트씨주(5g).
// 못 읽으면 null로 둔다. 5g와 10g를 찍어서 맞히면 안 된다.
function doseOf(itemCode, name) {
  if (itemCode === 'ns') {
    const m = name.match(/NS\s*(\d{2,3})/i)
    return m ? m[1] : null
  }
  if (itemCode === 'merit') {
    const m = name.match(/\((\d+)\s*g\)/i)
    return m ? `${m[1]}g` : null
  }
  return ''
}
