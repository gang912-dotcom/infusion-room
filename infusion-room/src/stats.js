// 통계 집계 — 화면이 아니라 셈이다. 순수 함수만 두고 stats.test.mjs가 이 파일을 잡는다.
//
// 예전 통계는 네 가지만 셌다: 전체 건수 · 이번 달 건수 · 수액실별 건수 · 재방문 TOP 10.
// 전부 "얼마나"였고 "언제"를 묻는 화면이 없었다. 일자별 추이와 요일×시간대가 그 자리다 —
// 이 데이터가 답할 수 있는데 아무 화면도 안 묻던 질문이고, 인력 배치를 바꾸는 유일한 축이다.
//
// 입력은 api.js의 mapHistoryRow가 매핑한 이용기록 행이다. 시각은 로캘 문자열(date/startTime)이
// 아니라 같이 실려 오는 startedAt·endedAt(ms)을 쓴다 — 문자열은 되돌려 계산할 수가 없다.
// 수액실도 라벨(room)이 아니라 키(roomKey)로 센다.

// 방 목록은 api.js 한 벌에서만 온다. 예전엔 여기 라벨을 한 벌 더 두고 있었는데,
// 그러면 방을 늘리거나 이름을 바꿀 때 한쪽만 고쳐지고 통계에서 그 방이 조용히 빠진다
// (api.js의 ROOM_LABELS 주석이 경고하던 바로 그 상황이다). 순서도 거기 키 순서를 따른다.
import { ROOM_LABELS, EXAM_ROOMS } from './api.js'

export const ROOM_KEYS = Object.keys(ROOM_LABELS)
export const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']

const DAY = 86_400_000

export function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 기간은 '종료 시각' 기준이다 — 원본 통계와 같은 규칙(이용기록의 날짜도 ended_at이다).
// to는 그날 끝까지 포함한다. 삭제된 기록은 빠진다.
export function inRange(rows, fromMs, toMs) {
  const end = startOfDay(toMs) + DAY - 1
  return rows.filter((r) => !r.deleted && r.endedAt >= fromMs && r.endedAt <= end)
}

export function usedMinutes(row) {
  return Math.round((row.endedAt - row.startedAt) / 60000)
}

// ─── 일자별 추이 ─────────────────────────────────────────────────────
// 기록이 없는 날도 0으로 채운다. 빠뜨리면 선이 빈 날을 건너뛰며 이어져서
// 휴진일이 사라지고 추이가 실제보다 완만해 보인다.
export function byDay(rows, fromMs, toMs) {
  const buckets = new Map()
  for (let t = startOfDay(fromMs); t <= startOfDay(toMs); t += DAY) {
    // 방 목록을 박아 두면 방이 늘어도 그 방만 undefined로 빠진다 — ROOM_KEYS에서 만든다.
    buckets.set(dayKey(t), {
      ts: t, key: dayKey(t), total: 0, rooms: Object.fromEntries(ROOM_KEYS.map((k) => [k, 0])),
    })
  }
  for (const r of rows) {
    const b = buckets.get(dayKey(r.endedAt))
    if (!b) continue
    b.total++
    if (b.rooms[r.roomKey] !== undefined) b.rooms[r.roomKey]++
  }
  return [...buckets.values()]
}

// ─── 시간대 이용 분포(요일별) ─────────────────────────────────────────
// 시작 시각 기준이다 — "몇 시에 사람이 몰리나"를 묻는 것이라 끝난 시각은 답이 아니다.
// 병원 운영시간은 오전 9시~오후 7시다. 창 밖에서 시작된 기록은 이 곡선에 안 잡힌다
// (아래 col < 0). 그런 기록은 대개 종료를 늦게 누른 것이라 '가장 붐빈 시간' 지표에서는
// 창을 걸지 않고 그대로 드러나게 둔다.
//
// 값은 합계가 아니라 '그 요일 하루 평균'이다. 조회 기간에 월요일이 5번, 토요일이 4번
// 들어 있으면 합계끼리 겹쳐 보는 순간 월요일이 그냥 더 커 보인다 — 요일을 비교하는
// 그림에서 그건 거짓말이다. 나누는 수는 달력 날짜가 아니라 '그 요일에 기록이 있던 날'
// 이다(KPI의 진료일 기준과 같은 규칙 — 휴진이 평균을 끌어내리면 안 된다).
export function hourProfile(rows, hourFrom = 9, hourTo = 19) {
  const hours = []
  for (let h = hourFrom; h <= hourTo; h++) hours.push(h)

  const counts = DOW_LABEL.map(() => hours.map(() => 0))
  const openDays = DOW_LABEL.map(() => new Set())

  for (const r of rows) {
    const d = new Date(r.startedAt)
    // 진료일은 창과 무관하게 센다 — 9시 전에 시작한 한 건뿐인 날도 문을 연 날이다.
    openDays[d.getDay()].add(dayKey(r.startedAt))
    const col = hours.indexOf(d.getHours())
    if (col < 0) continue
    counts[d.getDay()][col]++
  }

  const dows = DOW_LABEL.map((label, i) => {
    const days = openDays[i].size
    return {
      dow: i, label, days,
      counts: counts[i],
      avg: counts[i].map((c) => (days ? c / days : 0)),
    }
  })

  // '전체'는 요일 평균들의 평균이 아니라 전 기간 합계 ÷ 전체 진료일이다. 평균의 평균은
  // 적게 열린 요일(토요일 반나절 같은)을 다른 요일과 같은 무게로 세어 기준선을 띄운다.
  const allDays = dows.reduce((n, d) => n + d.days, 0)
  const allCounts = hours.map((_, c) => dows.reduce((n, d) => n + d.counts[c], 0))
  const all = {
    dow: null, label: '전체', days: allDays,
    counts: allCounts,
    avg: allCounts.map((c) => (allDays ? c / allDays : 0)),
  }

  // y 눈금은 모든 계열의 최댓값 하나로 고정한다. 고른 요일에 맞춰 축이 늘었다 줄면
  // 곡선의 높이가 값이 아니라 축을 뜻하게 되어, 요일을 바꿔 봐도 비교가 안 된다.
  const max = Math.max(0, ...dows.flatMap((d) => d.avg), ...all.avg)

  return { hours, dows, all, max }
}

// ─── 단순 집계 ───────────────────────────────────────────────────────
export function byRoom(rows) {
  const counts = Object.fromEntries(ROOM_KEYS.map((k) => [k, 0]))
  for (const r of rows) if (counts[r.roomKey] !== undefined) counts[r.roomKey]++
  return ROOM_KEYS.map((k) => ({ key: k, label: ROOM_LABELS[k], count: counts[k] }))
}

// 진료실별. 수액실과 달리 '미지정'이 실제로 있다 — 진료실을 필수로 만들기 전에 배정된
// 세션은 값이 비어 있다. 그 칸을 버리면 막대의 합이 전체 건수와 안 맞아서, 보는 사람이
// 어디서 새는지 알 수 없다. 0건이면 줄 자체를 빼되 있으면 반드시 보여준다.
export function byExamRoom(rows) {
  const counts = Object.fromEntries(EXAM_ROOMS.map((k) => [k, 0]))
  let unset = 0
  for (const r of rows) {
    if (counts[r.examRoom] !== undefined) counts[r.examRoom]++
    else unset++   // 목록에 없는 값(옛 데이터·오타)도 여기로 모은다 — 조용히 사라지면 안 된다
  }
  const out = EXAM_ROOMS.map((k) => ({ key: k, label: `${k}진료실`, count: counts[k] }))
  if (unset > 0) out.push({ key: '', label: '미지정', count: unset })
  return out
}

export function byStaff(rows, field) {
  const counts = new Map()
  for (const r of rows) {
    const name = r[field]
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
}

// 재방문 = 기간 안에 2회 이상. 차트번호가 기준이다 — 동명이인이 한 줄로 합쳐지면 안 된다.
export function topRevisits(rows, limit = 10) {
  const map = new Map()
  for (const r of rows) {
    const cur = map.get(r.chartNumber) ?? { chartNo: r.chartNumber, name: r.patientName, count: 0, lastAt: 0 }
    cur.count++
    if (r.endedAt > cur.lastAt) { cur.lastAt = r.endedAt; cur.name = r.patientName }
    map.set(r.chartNumber, cur)
  }
  return [...map.values()]
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit)
}

// ─── 요약 지표 ───────────────────────────────────────────────────────
// perDay는 '기간의 날 수'가 아니라 '기록이 있는 날 수'로 나눈다. 일요일이 휴진이라
// 달력 날짜로 나누면 하루 평균이 실제보다 15%쯤 낮게 나온다.
export function summary(rows) {
  const total = rows.length
  if (!total) return { total: 0, openDays: 0, perDay: 0, avgMinutes: 0, peakHour: null }

  const days = new Set(rows.map((r) => dayKey(r.endedAt)))
  const minutes = rows.reduce((a, r) => a + usedMinutes(r), 0)

  const hourCounts = new Map()
  for (const r of rows) {
    const h = new Date(r.startedAt).getHours()
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1)
  }
  let peakHour = null
  let peakCount = -1
  for (const [h, c] of [...hourCounts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > peakCount) { peakCount = c; peakHour = h }
  }

  return {
    total,
    openDays: days.size,
    perDay: +(total / days.size).toFixed(1),
    avgMinutes: Math.round(minutes / total),
    peakHour,
    peakCount,
  }
}

// ─── 기간 프리셋 ─────────────────────────────────────────────────────
export function presetRange(preset, nowMs) {
  const today = startOfDay(nowMs)
  const days = { d7: 6, d30: 29, d90: 89 }[preset]
  if (preset === 'today') return { from: today, to: today }
  return { from: today - days * DAY, to: today }
}

export function fmtMinutes(min) {
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}시간 ${m}분` : `${h}시간`
}
