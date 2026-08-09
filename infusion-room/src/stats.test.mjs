// node src/v3/stats.test.mjs
import assert from 'node:assert/strict'
import {
  inRange, byDay, byDowHour, byRoom, byStaff, topRevisits, summary,
  presetRange, fmtMinutes, dayKey, startOfDay,
} from './stats.js'

const DAY = 86_400_000
// 2026-08-10(월) 00:00 기준. 로컬 시간대로 만든다 — 집계도 로컬 기준이라 UTC로 잡으면 하루가 밀린다.
const T0 = new Date(2026, 7, 10, 0, 0, 0).getTime()

const row = (over) => ({
  id: 1, roomKey: 'room2', bedNumber: '22', patientName: '가나다', chartNumber: 'K1',
  startedAt: T0 + 10 * 3600_000, endedAt: T0 + 12 * 3600_000,
  lineStaff: '박민순', mixStaff: '이하늘', deleted: 0, ...over,
})

// ── 기간 ─────────────────────────────────────────────────────────────
{
  const rows = [
    row({ endedAt: T0 - 1 }),                    // 하루 전 마지막 ms → 제외
    row({ endedAt: T0 }),                        // 시작일 0시 → 포함
    row({ endedAt: T0 + DAY - 1 }),              // 시작일 끝 → 포함
    row({ endedAt: T0 + DAY }),                  // 다음 날 → to가 T0면 제외
    row({ endedAt: T0 + 3600_000, deleted: 1 }), // 삭제 → 항상 제외
  ]
  assert.equal(inRange(rows, T0, T0).length, 2)
  // to가 그날 끝까지 포함되므로, to를 다음 날로 주면 4번째가 들어온다.
  assert.equal(inRange(rows, T0, T0 + DAY).length, 3)
}

// ── 일자별: 빈 날도 0으로 채운다 ─────────────────────────────────────
{
  const rows = [row({ endedAt: T0 }), row({ endedAt: T0, roomKey: 'room3' }), row({ endedAt: T0 + 2 * DAY })]
  const days = byDay(rows, T0, T0 + 2 * DAY)
  assert.equal(days.length, 3)                 // 기록 없는 가운데 날도 자리를 갖는다
  assert.deepEqual(days.map((d) => d.total), [2, 0, 1])
  assert.equal(days[0].rooms.room2, 1)
  assert.equal(days[0].rooms.room3, 1)
  assert.equal(days[1].total, 0)
  assert.equal(days[0].key, dayKey(T0))
}

// ── 요일 × 시간대: 시작 시각 기준 ────────────────────────────────────
{
  // 10시에 시작해 다음 날 새벽에 끝나는 기록 — '시작'인 10시 칸에 잡혀야 한다.
  const overnight = row({ startedAt: T0 + 22 * 3600_000, endedAt: T0 + DAY + 3600_000 })
  const { hours, grid, max } = byDowHour([row({}), row({}), overnight])
  const monday = new Date(T0).getDay()
  assert.equal(grid[monday][hours.indexOf(10)], 2)
  assert.equal(hours.includes(22), false)               // 22시는 창(9~19시) 밖이라 칸 자체가 없다
  assert.equal(grid[monday].reduce((a, b) => a + b, 0), 2) // 그래서 그 기록은 어디에도 안 잡힌다
  assert.equal(max, 2)
  assert.equal(hours[0], 9)                             // 병원 운영시간 = 오전 9시~오후 7시
  assert.equal(hours[hours.length - 1], 19)
  assert.equal(hours.length, 11)
}

// ── 단순 집계 ────────────────────────────────────────────────────────
{
  const rows = [row({}), row({ roomKey: 'room3' }), row({ roomKey: 'room3' })]
  assert.deepEqual(byRoom(rows).map((r) => r.count), [1, 2, 0]) // room2·room3·floor2 순서 고정
  const staff = byStaff([...rows, row({ lineStaff: null })], 'lineStaff')
  assert.deepEqual(staff, [{ name: '박민순', count: 3 }]) // null은 세지 않는다
}

// ── 재방문: 차트번호 기준, 2회 이상만 ────────────────────────────────
{
  const rows = [
    row({ chartNumber: 'A', patientName: '가' }),
    row({ chartNumber: 'A', patientName: '가', endedAt: T0 + DAY }),
    row({ chartNumber: 'B', patientName: '나' }), // 1회 → 제외
    row({ chartNumber: 'C', patientName: '다' }),
    row({ chartNumber: 'C', patientName: '다' }),
    row({ chartNumber: 'C', patientName: '다' }),
  ]
  const top = topRevisits(rows)
  assert.deepEqual(top.map((p) => [p.chartNo, p.count]), [['C', 3], ['A', 2]])
  assert.equal(top.some((p) => p.chartNo === 'B'), false)
}

// ── 요약: 하루 평균은 '기록이 있는 날'로 나눈다 ──────────────────────
{
  // 사흘 창인데 이틀만 기록이 있다 → 4/2 = 2.0이어야 한다(4/3 = 1.3이 아니라).
  // 하루를 옮길 땐 시작·종료를 같이 옮긴다 — endedAt만 밀면 소요시간이 이틀짜리가 된다.
  const visit = (dayOffset) => row({
    startedAt: T0 + dayOffset * DAY + 10 * 3600_000,
    endedAt: T0 + dayOffset * DAY + 12 * 3600_000,
  })
  const rows = [visit(0), visit(0), visit(2), visit(2)]
  const s = summary(rows)
  assert.equal(s.total, 4)
  assert.equal(s.openDays, 2)
  assert.equal(s.perDay, 2)
  assert.equal(s.avgMinutes, 120)
  assert.equal(s.peakHour, 10)
  assert.deepEqual(summary([]), { total: 0, openDays: 0, perDay: 0, avgMinutes: 0, peakHour: null })
}

// ── 프리셋 ───────────────────────────────────────────────────────────
{
  const noon = T0 + 12 * 3600_000
  assert.deepEqual(presetRange('today', noon), { from: T0, to: T0 })
  assert.equal(presetRange('d7', noon).from, T0 - 6 * DAY)   // 오늘 포함 7일
  assert.equal(presetRange('d30', noon).from, T0 - 29 * DAY)
  assert.equal(presetRange('d90', noon).to, T0)
  assert.equal(startOfDay(noon), T0)
}

assert.equal(fmtMinutes(45), '45분')
assert.equal(fmtMinutes(120), '2시간')
assert.equal(fmtMinutes(150), '2시간 30분')

console.log('stats.js OK')
