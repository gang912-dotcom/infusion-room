// 당일 메모 빠른 입력 — 자주 쓰는 문구를 버튼으로 넣고 뺀다.
//
// 메모는 자유 텍스트다. 버튼을 '값'이 아니라 '쉼표로 구분된 한 토막'으로 다루는 이유는
// 손으로 적은 말과 섞여도 서로를 안 지우기 때문이다 — "cbc+crp, 보호자 동행"에서
// cbc+crp만 빼면 "보호자 동행"이 남는다. 버튼이 텍스트를 통째로 덮으면 그게 안 된다.
//
// 'cbc+crp'에 +가 들어 있어 구분자로 +를 쓸 수 없다. 쉼표는 검사명에 안 들어간다.
export const DAY_MEMO_PRESETS = ['cbc+crp', '17종', 'lab검사', 'A+', 'B+', 'C+']

// 쉼표로 끊고 앞뒤 공백을 턴다. 빈 토막은 버린다("a,,b"·끝의 쉼표).
export function splitMemoTokens(text) {
  return String(text ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function hasMemoToken(text, token) {
  return splitMemoTokens(text).includes(token)
}

// 있으면 빼고 없으면 뒤에 붙인다. 같은 토막이 여러 번 들어가 있으면(손으로 적었을 수 있다)
// 끌 때 전부 지운다 — 한 번 더 눌러야 사라지는 건 버튼으로 보이지 않는다.
export function toggleMemoToken(text, token) {
  const tokens = splitMemoTokens(text)
  const next = tokens.includes(token)
    ? tokens.filter((t) => t !== token)
    : [...tokens, token]
  return next.join(', ')
}
