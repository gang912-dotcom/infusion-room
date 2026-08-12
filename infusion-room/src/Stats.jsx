import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  inRange, byDay, hourProfile, byRoom, byExamRoom, byStaff, topRevisits, summary,
  presetRange, fmtMinutes, startOfDay,
} from './stats.js'
import './stats.css'

// 통계 — 근무자가 8시간 보는 화면이 아니라 원장·방문자가 가끔 열어 보는 화면이다.
// 그래서 상황판보다 과감해도 되고, 여기서만 답할 수 있는 질문이 하나 있다: "언제 몰리나".
//
// 형태는 손이 아니라 규칙으로 골랐다:
//  - 추이(시간에 따른 변화) → 영역, 단일 계열. 수액실별로 쌓지 않는다 — 부분/전체는 막대의 일이다.
//  - 수액실별·담당자별(이름 비교) → 가로 막대, 전부 같은 한 색. 막대 길이가 이미 크기를
//    말하는데 색까지 값으로 칠하면 정체성 채널을 낭비한다.
//  - 시간대 이용 분포(하루의 모양) → 영역 곡선 하나 + 요일 세그먼트. 요일×시간대 격자를
//    색으로 칠하던 히트맵을 걷어낸 자리다 — 크기를 묻는 그림은 색보다 높이가 정확하다.
//  - 재방문 TOP → 표. 열 개짜리 순위는 차트로 만들 이유가 없다.
//
// 색은 눈으로 고르지 않고 검증기를 돌렸다(라이트 #ffffff / 다크 #1c1c1c 카드 면 각각).
// 값과 검증 결과는 stats.css 머리말 참고.

const PRESETS = [
  ['today', '오늘'],
  ['d7', '최근 7일'],
  ['d30', '최근 30일'],
  ['d90', '최근 90일'],
]

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // 뷰박스를 늘리는 대신 컨테이너 폭을 재서 1:1로 그린다 — 그래야 SVG 안 글자가
    // 확대되지 않아 12px 바닥선이 지켜지고, 실측한 값이 화면의 값과 같아진다.
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export default function Stats({ rows, now }) {
  const [preset, setPreset] = useState('d30')
  const [custom, setCustom] = useState(null) // { from, to }

  const range = useMemo(
    () => custom ?? presetRange(preset, now),
    [custom, preset, now],
  )

  const ranged = useMemo(() => inRange(rows, range.from, range.to), [rows, range])
  const sum = useMemo(() => summary(ranged), [ranged])
  const days = useMemo(() => byDay(ranged, range.from, range.to), [ranged, range])
  const profile = useMemo(() => hourProfile(ranged), [ranged])
  const rooms = useMemo(() => byRoom(ranged), [ranged])
  const examRooms = useMemo(() => byExamRoom(ranged), [ranged])
  const revisits = useMemo(() => topRevisits(ranged), [ranged])

  const [staffField, setStaffField] = useState('lineStaff')
  const staff = useMemo(() => byStaff(ranged, staffField), [ranged, staffField])

  function pickPreset(p) {
    setCustom(null)
    setPreset(p)
  }

  function setCustomDate(which, value) {
    if (!value) return
    const ms = startOfDay(new Date(`${value}T00:00:00`).getTime())
    const base = custom ?? range
    setCustom(which === 'from' ? { from: ms, to: Math.max(ms, base.to) } : { from: Math.min(ms, base.from), to: ms })
  }

  const asDateInput = (ms) => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div className="sv-stats">
      <header className="sv-stats__bar">
        <div className="sv-seg-group" role="group" aria-label="조회 기간">
          {PRESETS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`sv-seg${!custom && preset === id ? ' sv-seg--on' : ''}`}
              onClick={() => pickPreset(id)}
              aria-pressed={!custom && preset === id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sv-stats__custom">
          <input type="date" className="sv-input sv-input--date" value={asDateInput(range.from)}
            onChange={(e) => setCustomDate('from', e.target.value)} aria-label="조회 시작일" />
          <span className="sv-stats__sep">~</span>
          <input type="date" className="sv-input sv-input--date" value={asDateInput(range.to)}
            onChange={(e) => setCustomDate('to', e.target.value)} aria-label="조회 종료일" />
        </div>
      </header>

      {sum.total === 0 ? (
        <p className="sv-stats__empty">이 기간에는 이용 기록이 없습니다.</p>
      ) : (
        <>
          <section className="sv-kpis" aria-label="요약">
            {/* 이 화면이 이끄는 하나의 수 — 나머지는 이걸 설명한다. */}
            <div className="sv-kpi">
              <span className="sv-kpi__label">이용건수</span>
              <span className="sv-kpi__value">{sum.total.toLocaleString()}<span className="sv-kpi__unit">건</span></span>
              <span className="sv-kpi__sub">진료일 {sum.openDays}일</span>
            </div>
            <div className="sv-kpi">
              <span className="sv-kpi__label">하루 평균</span>
              <span className="sv-kpi__value">{sum.perDay}<span className="sv-kpi__unit">건</span></span>
              {/* 달력 날짜가 아니라 기록이 있는 날로 나눈다 — 일요일 휴진이 평균을 끌어내리면 안 된다. */}
              <span className="sv-kpi__sub">진료일 기준</span>
            </div>
            <div className="sv-kpi">
              <span className="sv-kpi__label">평균 소요시간</span>
              <span className="sv-kpi__value">{fmtMinutes(sum.avgMinutes)}</span>
              <span className="sv-kpi__sub">시작~종료</span>
            </div>
            <div className="sv-kpi">
              <span className="sv-kpi__label">가장 붐빈 시간</span>
              <span className="sv-kpi__value">{sum.peakHour}<span className="sv-kpi__unit">시</span></span>
              <span className="sv-kpi__sub">{sum.peakCount.toLocaleString()}건 시작</span>
            </div>
          </section>

          <TrendCard days={days} />

          <HourProfileCard profile={profile} />

          <div className="sv-stats__cols">
            <BarCard
              title="수액실별 이용건수"
              items={rooms.map((r) => ({ name: r.label, count: r.count }))}
            />
            {/* 진료실은 '어느 진료실에서 내려온 처방인가'라 수액실과 다른 축이다.
                미지정 줄은 진료실을 필수로 만들기 전 세션이라 0이면 저절로 빠진다. */}
            <BarCard
              title="진료실별 이용건수"
              items={examRooms.map((r) => ({ name: r.label, count: r.count }))}
            />
            <BarCard
              title="담당자별 이용건수"
              items={staff}
              control={
                <div className="sv-seg-group sv-seg-group--sm" role="group" aria-label="담당 구분">
                  {[['lineStaff', '라인'], ['mixStaff', '믹스']].map(([id, label]) => (
                    <button key={id} type="button"
                      className={`sv-seg${staffField === id ? ' sv-seg--on' : ''}`}
                      onClick={() => setStaffField(id)} aria-pressed={staffField === id}>
                      {label}
                    </button>
                  ))}
                </div>
              }
            />
          </div>

          <RevisitCard rows={revisits} />
        </>
      )}
    </div>
  )
}

// ─── 일자별 추이 ─────────────────────────────────────────────────────
// 단일 계열이라 범례를 두지 않는다 — 색이 하나뿐이고 제목이 이미 무엇인지 말한다.
// 값은 점마다 찍지 않는다. 최고점 하나만 직접 달고 나머지는 축과 툴팁이 맡는다.
function TrendCard({ days }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const [table, setTable] = useState(false)

  const H = 200
  const PAD = { t: 16, r: 12, b: 26, l: 40 }
  const iw = Math.max(0, w - PAD.l - PAD.r)
  const ih = H - PAD.t - PAD.b

  const max = Math.max(1, ...days.map((d) => d.total))
  const ticks = niceTicks(max, 4)
  const top = ticks[ticks.length - 1]

  const x = (i) => (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw)
  const y = (v) => ih - (v / top) * ih

  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.total).toFixed(1)}`).join(' ')
  const area = days.length ? `${line} L${x(days.length - 1).toFixed(1)} ${ih} L${x(0).toFixed(1)} ${ih} Z` : ''

  const peakIdx = days.reduce((best, d, i) => (d.total > days[best].total ? i : best), 0)

  const onMove = useCallback((e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left - PAD.l
    if (days.length < 2) return setHover(0)
    const i = Math.round((px / iw) * (days.length - 1))
    setHover(Math.max(0, Math.min(days.length - 1, i)))
  }, [days.length, iw, PAD.l])

  return (
    <section className="sv-vcard">
      <div className="sv-vcard__head">
        <h3 className="sv-vcard__title">일자별 이용건수</h3>
        <button type="button" className="sv-vcard__toggle" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? '그래프 보기' : '표 보기'}
        </button>
      </div>

      {table ? (
        <div className="sv-vtable-wrap">
          <table className="sv-vtable">
            <caption className="sv-sr">일자별 이용건수</caption>
            <thead><tr><th scope="col">날짜</th><th scope="col">건수</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.key}><th scope="row">{d.key}</th><td>{d.total.toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sv-plot" ref={ref}>
          {w > 0 && (
            <svg
              width={w} height={H} className="sv-svg" role="img"
              aria-label={`일자별 이용건수 추이. 최고 ${days[peakIdx]?.total ?? 0}건.`}
              onMouseMove={onMove} onMouseLeave={() => setHover(null)}
            >
              <g transform={`translate(${PAD.l},${PAD.t})`}>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="sv-grid" />
                    <text x={-8} y={y(t)} className="sv-axis sv-axis--y">{t.toLocaleString()}</text>
                  </g>
                ))}

                {area && <path d={area} className="sv-area" />}
                {/* 선은 2px, 면은 같은 색의 옅은 물. 면이 진하면 값의 끝점이 흐려진다. */}
                <path d={line} className="sv-line" />

                {/* 값은 최고점 하나만 직접 단다 — 점마다 달면 아무도 안 읽는다. */}
                {days.length > 0 && (
                  <>
                    <circle cx={x(peakIdx)} cy={y(days[peakIdx].total)} r={4.5} className="sv-dot" />
                    <text
                      x={Math.min(iw - 4, Math.max(14, x(peakIdx)))}
                      y={y(days[peakIdx].total) - 10}
                      className="sv-peak"
                      textAnchor={x(peakIdx) > iw - 40 ? 'end' : 'middle'}
                    >
                      최고 {days[peakIdx].total}건
                    </text>
                  </>
                )}

                {hover != null && days[hover] && (
                  <>
                    <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} className="sv-crosshair" />
                    <circle cx={x(hover)} cy={y(days[hover].total)} r={4.5} className="sv-dot sv-dot--hover" />
                  </>
                )}

                <line x1={0} x2={iw} y1={ih} y2={ih} className="sv-baseline" />
                {xLabels(days).map(({ i, label }) => (
                  <text key={i} x={x(i)} y={ih + 17} className="sv-axis sv-axis--x">{label}</text>
                ))}
              </g>
            </svg>
          )}
          {hover != null && days[hover] && (
            <div
              className="sv-tip"
              style={{ left: Math.min(Math.max(PAD.l + x(hover), 60), Math.max(60, w - 60)) }}
            >
              <b>{days[hover].key}</b>
              <span>{days[hover].total.toLocaleString()}건</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ─── 시간대 이용 분포 ────────────────────────────────────────────────
// "언제 사람이 몰리나"는 인력 배치를 바꾸는 유일한 축이다. 처음엔 요일×시간대 77칸을
// 색 5단계로 칠한 히트맵이었는데, 값이 칸 안에 숨어서 칸마다 커서를 올려야 답이 나왔고
// 테마를 바꾸면 램프 방향까지 뒤집혔다. 크기를 묻는 그림은 색보다 높이가 정확하다 —
// 하루의 모양을 곡선 하나로 두고 요일을 갈아 끼우는 편이 훨씬 빨리 읽힌다.
//
// 축은 요일을 바꿔도 고정이고(stats.js의 max), 요일을 고르면 '전체 평균' 기준선이
// 회색으로 함께 남는다 — 곡선 하나만 떠 있으면 그게 높은 건지 낮은 건지 알 수가 없다.
function HourProfileCard({ profile }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const [table, setTable] = useState(false)
  const [picked, setPicked] = useState(null) // null = 전체

  const { hours, dows, all, max } = profile
  const open = dows.filter((d) => d.days > 0) // 휴진 요일(일요일)은 칩 자체를 안 만든다
  // 기간을 좁히면 골라둔 요일이 사라질 수 있다 — 그때는 조용히 전체로 돌아간다.
  const dow = open.some((d) => d.dow === picked) ? picked : null
  const active = dow == null ? all : open.find((d) => d.dow === dow)

  const H = 200
  const PAD = { t: 16, r: 12, b: 26, l: 40 }
  const iw = Math.max(0, w - PAD.l - PAD.r)
  const ih = H - PAD.t - PAD.b

  // 눈금은 정수 간격이다(niceTicks). 평균이 0.4건이어도 축은 0·1로 서는 게 맞다 —
  // 소수 눈금은 '0.25건 시작'처럼 셀 수 없는 수를 축에 적는 일이 된다.
  const ticks = niceTicks(Math.max(max, 1), 4)
  const top = ticks[ticks.length - 1]

  const x = (i) => (hours.length <= 1 ? iw / 2 : (i / (hours.length - 1)) * iw)
  const y = (v) => ih - (v / top) * ih
  const toPath = (avg) => avg.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')

  const line = toPath(active.avg)
  const area = `${line} L${x(hours.length - 1).toFixed(1)} ${ih} L${x(0).toFixed(1)} ${ih} Z`
  const peakIdx = active.avg.reduce((best, v, i) => (v > active.avg[best] ? i : best), 0)

  const onMove = useCallback((e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left - PAD.l
    const i = Math.round((px / iw) * (hours.length - 1))
    setHover(Math.max(0, Math.min(hours.length - 1, i)))
  }, [hours.length, iw, PAD.l])

  return (
    <section className="sv-vcard">
      <div className="sv-vcard__head">
        <h3 className="sv-vcard__title">시간대 이용 분포</h3>
        {/* 요일 고르기는 기간 고르기와 같은 일이라 같은 세그먼트 화법을 쓴다. */}
        <div className="sv-seg-group sv-seg-group--sm" role="group" aria-label="요일">
          <button
            type="button"
            className={`sv-seg${dow == null ? ' sv-seg--on' : ''}`}
            onClick={() => setPicked(null)}
            aria-pressed={dow == null}
          >
            전체
          </button>
          {open.map((d) => (
            <button
              key={d.dow}
              type="button"
              className={`sv-seg${dow === d.dow ? ' sv-seg--on' : ''}`}
              onClick={() => setPicked(d.dow)}
              aria-pressed={dow === d.dow}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button type="button" className="sv-vcard__toggle" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? '그래프 보기' : '표 보기'}
        </button>
      </div>

      {table ? (
        <div className="sv-vtable-wrap">
          <table className="sv-vtable">
            <caption className="sv-sr">시간대별 하루 평균 이용 시작 건수</caption>
            <thead>
              <tr>
                <th scope="col">시간</th>
                <th scope="col">전체</th>
                {open.map((d) => <th key={d.dow} scope="col">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {hours.map((h, i) => (
                <tr key={h}>
                  <th scope="row">{h}시</th>
                  <td>{fmtAvg(all.avg[i])}</td>
                  {open.map((d) => <td key={d.dow}>{fmtAvg(d.avg[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sv-plot" ref={ref}>
          {w > 0 && (
            <svg
              width={w} height={H} className="sv-svg" role="img"
              aria-label={`${active.label} 시간대 이용 분포. 가장 붐비는 시각 ${hours[peakIdx]}시, 하루 평균 ${fmtAvg(active.avg[peakIdx])}건 시작.`}
              onMouseMove={onMove} onMouseLeave={() => setHover(null)}
            >
              <g transform={`translate(${PAD.l},${PAD.t})`}>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="sv-grid" />
                    <text x={-8} y={y(t)} className="sv-axis sv-axis--y">{t.toLocaleString()}</text>
                  </g>
                ))}

                <path d={area} className="sv-area" />
                <path d={line} className="sv-line" />

                {/* 기준선 — 고른 요일이 전체와 견줘 높은지 낮은지를 말한다.
                    면 없이 얇은 파선이라 앞의 곡선을 가리지 않는다. */}
                {dow != null && <path d={toPath(all.avg)} className="sv-ref" />}

                {/* 값은 최고점 하나만 직접 단다 — 점마다 달면 아무도 안 읽는다. */}
                <circle cx={x(peakIdx)} cy={y(active.avg[peakIdx])} r={4.5} className="sv-dot" />
                <text
                  x={Math.min(iw - 4, Math.max(20, x(peakIdx)))}
                  y={y(active.avg[peakIdx]) - 10}
                  className="sv-peak"
                  textAnchor={x(peakIdx) > iw - 50 ? 'end' : 'middle'}
                >
                  {hours[peakIdx]}시 {fmtAvg(active.avg[peakIdx])}건
                </text>

                {hover != null && (
                  <>
                    <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} className="sv-crosshair" />
                    <circle cx={x(hover)} cy={y(active.avg[hover])} r={4.5} className="sv-dot sv-dot--hover" />
                  </>
                )}

                <line x1={0} x2={iw} y1={ih} y2={ih} className="sv-baseline" />
                {hours.map((h, i) => (
                  // 11칸에 라벨을 전부 달면 12px 글자가 서로 붙는다 — 한 칸 걸러 단다.
                  (i % 2 === 0) && <text key={h} x={x(i)} y={ih + 17} className="sv-axis sv-axis--x">{h}</text>
                ))}
              </g>
            </svg>
          )}
          {hover != null && (
            <div
              className="sv-tip"
              style={{ left: Math.min(Math.max(PAD.l + x(hover), 70), Math.max(70, w - 70)) }}
            >
              <b>{hours[hover]}시</b>
              <span>{fmtAvg(active.avg[hover])}건</span>
            </div>
          )}
        </div>
      )}

      <p className="sv-vcard__foot">
        {/* 표 보기에서는 범례를 뺀다 — 열 이름이 이미 어느 요일인지 말한다. */}
        {dow != null && !table && (
          <span className="sv-legend" aria-hidden="true">
            <span className="sv-legend__item"><i className="sv-legend__key" />{active.label}요일</span>
            <span className="sv-legend__item"><i className="sv-legend__key sv-legend__key--ref" />전체 평균</span>
          </span>
        )}
        <span className="sv-vcard__hint">
          {active.days
            ? `하루 평균 건수 · ${active.label === '전체' ? '진료일' : `${active.label}요일`} ${active.days}일 기준`
            : '이 기간에는 기록이 없습니다'}
        </span>
      </p>
    </section>
  )
}

// 평균은 소수 첫째 자리까지. 딱 떨어지면 '.0'을 달지 않는다 — 하루만 조회하면 평균이
// 곧 그날의 건수라, 거기 '12.0건'이라고 적히면 없던 정밀도가 있는 것처럼 읽힌다.
function fmtAvg(v) {
  return String(Math.round(v * 10) / 10)
}

// ─── 가로 막대 ───────────────────────────────────────────────────────
// 이름을 비교하는 자리라 전부 같은 한 색이다. 값은 막대 끝에 직접 단다.
function BarCard({ title, items, control }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <section className="sv-vcard">
      <div className="sv-vcard__head">
        <h3 className="sv-vcard__title">{title}</h3>
        {control}
      </div>
      {items.length === 0 ? (
        <p className="sv-vcard__empty">기록이 없습니다.</p>
      ) : (
        <ul className="sv-bars">
          {items.map((it) => (
            <li key={it.name} className="sv-bar-row">
              <span className="sv-bar-row__name">{it.name}</span>
              <span className="sv-bar-row__track">
                <span className="sv-bar-row__fill" style={{ width: `${(it.count / max) * 100}%` }} />
              </span>
              <span className="sv-bar-row__value">{it.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── 재방문 TOP 10 ───────────────────────────────────────────────────
function RevisitCard({ rows }) {
  return (
    <section className="sv-vcard">
      <div className="sv-vcard__head">
        <h3 className="sv-vcard__title">재방문 환자 TOP 10</h3>
        <span className="sv-vcard__hint">기간 내 2회 이상</span>
      </div>
      {rows.length === 0 ? (
        <p className="sv-vcard__empty">이 기간에 재방문 환자가 없습니다.</p>
      ) : (
        <table className="sv-vtable sv-vtable--rank">
          <thead>
            <tr>
              <th scope="col">순위</th><th scope="col">환자</th>
              <th scope="col">차트번호</th><th scope="col">방문</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.chartNo}>
                <td><span className={`sv-rank${i < 3 ? ' sv-rank--top' : ''}`}>{i + 1}</span></td>
                <th scope="row">{p.name}</th>
                <td className="sv-num">{p.chartNo}</td>
                <td className="sv-num">{p.count}회</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ─── 축 도우미 ───────────────────────────────────────────────────────
// 눈금은 깔끔한 수로 떨어뜨린다(0 / 10 / 20 …). 최댓값을 그대로 쓰면 '37' 같은 눈금이 생긴다.
function niceTicks(max, count) {
  const raw = Math.max(1, max / count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  // 건수는 정수라 간격도 정수여야 한다. 소수 간격을 두면 반올림한 눈금이 겹쳐
  // 0,0,1 같은 값이 나오고 React key까지 중복된다(실측).
  const step = Math.max(1, Math.round([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10))
  // 맨 위 눈금은 반드시 최댓값 이상이어야 한다. `v <= max`로 끊으면 최댓값이 27일 때
  // 눈금이 0·10·20에서 멈추고, y축 상한이 20이 되어 그 위 값이 그림 밖으로 잘린다(실측:
  // 선이 위에서 평평하게 잘려 있었다).
  const topTick = Math.ceil(max / step) * step
  const out = []
  for (let v = 0; v <= topTick; v += step) out.push(v)
  return out
}

// x축 라벨은 최대 6개만 — 90일이면 날짜가 겹쳐서 아무것도 못 읽는다.
function xLabels(days) {
  if (days.length === 0) return []
  const want = Math.min(6, days.length)
  const stride = Math.max(1, Math.round((days.length - 1) / (want - 1 || 1)))
  const out = []
  for (let i = 0; i < days.length; i += stride) {
    const d = new Date(days[i].ts)
    out.push({ i, label: `${d.getMonth() + 1}.${d.getDate()}` })
  }
  return out
}
