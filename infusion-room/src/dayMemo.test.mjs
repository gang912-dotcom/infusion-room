// node src/dayMemo.test.mjs
// 프레임워크 없이 assert만 쓴다. 여기가 틀리면 손으로 적은 메모가 버튼 한 번에 날아간다.
import assert from 'node:assert/strict'
import { DAY_MEMO_PRESETS, splitMemoTokens, hasMemoToken, toggleMemoToken } from './dayMemo.js'

// 1. 빈 메모에서 켜면 그 토막 하나
assert.equal(toggleMemoToken('', 'cbc+crp'), 'cbc+crp')
assert.equal(toggleMemoToken(null, 'A+'), 'A+')
assert.equal(toggleMemoToken(undefined, 'A+'), 'A+')

// 2. 여러 개를 겹쳐 켤 수 있다(A+·B+는 서로 배타가 아니다) — 누른 순서대로 붙는다
{
  let t = ''
  for (const k of ['cbc+crp', '17종', 'A+']) t = toggleMemoToken(t, k)
  assert.equal(t, 'cbc+crp, 17종, A+')
}

// 3. 다시 누르면 그것만 빠지고 나머지 순서는 그대로
assert.equal(toggleMemoToken('cbc+crp, 17종, A+', '17종'), 'cbc+crp, A+')
assert.equal(toggleMemoToken('cbc+crp, A+', 'cbc+crp'), 'A+')
assert.equal(toggleMemoToken('A+', 'A+'), '')

// 4. 손으로 적은 말은 버튼에 안 지워진다 — 이 파일이 지키려는 핵심
assert.equal(
  toggleMemoToken('보호자 동행, cbc+crp', 'cbc+crp'),
  '보호자 동행',
)
assert.equal(
  toggleMemoToken('보호자 동행', 'lab검사'),
  '보호자 동행, lab검사',
)

// 5. 'cbc+crp'·'A+'의 +는 구분자가 아니다. 'A+'를 껐다고 'cbc+crp'가 다치면 안 된다
assert.equal(toggleMemoToken('cbc+crp, A+', 'A+'), 'cbc+crp')
assert.equal(hasMemoToken('cbc+crp', 'A+'), false)
assert.equal(hasMemoToken('cbc+crp, A+', 'A+'), true)

// 6. 부분일치는 켜진 게 아니다 — 'B+'가 'A+, B+' 안에 있다고 'A+'까지 켜지면 안 된다
assert.equal(hasMemoToken('A+, B+', 'A+'), true)
assert.equal(hasMemoToken('A+, B+', 'C+'), false)
assert.equal(hasMemoToken('lab검사 안내함', 'lab검사'), false)

// 7. 지저분한 입력 정리 — 빈 토막·군더더기 공백·끝 쉼표
assert.deepEqual(splitMemoTokens('a,, b ,'), ['a', 'b'])
assert.equal(toggleMemoToken('cbc+crp,,  A+ ,', 'B+'), 'cbc+crp, A+, B+')

// 8. 손으로 같은 말을 두 번 적었으면 끌 때 전부 지운다(한 번 더 눌러야 사라지면 안 된다)
assert.equal(toggleMemoToken('A+, 열남, A+', 'A+'), '열남')

// 9. 목록은 원장님이 준 10개 그대로 — 표기(괄호 앞 공백 유무)까지 손대지 않는다
assert.deepEqual(DAY_MEMO_PRESETS, [
  'cbc+crp', '17종', 'lab검사',
  'A+', 'B+', 'C+',
  '타치온 (-)', '타치온 (+)', '세파(-)', '세파(+)',
])

// 10. 괄호·공백이 든 문구도 토막 하나로 온전히 오간다.
//     '타치온 (+)'를 켜도 '타치온 (-)'는 켜진 걸로 안 읽혀야 한다(부분일치 금지).
assert.equal(toggleMemoToken('', '타치온 (-)'), '타치온 (-)')
assert.equal(toggleMemoToken('cbc+crp, 세파(+)', '세파(+)'), 'cbc+crp')
assert.equal(hasMemoToken('타치온 (+)', '타치온 (-)'), false)
assert.equal(hasMemoToken('타치온 (-)', '타치온 (-)'), true)
assert.equal(hasMemoToken('세파(+)', '세파(-)'), false)
// 둘 다 켤 수는 있다 — 지금은 서로를 끄지 않는다(아래 주석 참고)
assert.equal(toggleMemoToken('타치온 (-)', '타치온 (+)'), '타치온 (-), 타치온 (+)')

console.log('dayMemo 테스트 통과')
