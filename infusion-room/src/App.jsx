import { useEffect, useState } from 'react'
import './App.css'
import logoIcon from './assets/logo-icon.png'

const STORAGE_KEY = 'infusion-room-beds'
const HISTORY_STORAGE_KEY = 'infusion-room-history'

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'room2', label: '2수액실' },
  { id: 'room3', label: '3수액실' },
  { id: 'floor2', label: '2층수액실' },
  { id: 'history', label: '이용기록' },
  { id: 'patient', label: '환자 조회' },
  { id: 'stats', label: '통계' },
  { id: 'datamanage', label: '데이터관리' },
]

const ROOM_TABS = TABS.filter(
  (t) =>
    t.id !== 'history' &&
    t.id !== 'patient' &&
    t.id !== 'stats' &&
    t.id !== 'datamanage',
)

const DEFAULT_DURATION = 120
const MIN_DURATION = 10

function createDefaultBeds() {
  return [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `room2-${22 + i}`,
      number: String(22 + i),
      room: 'room2',
      status: 'vacant',
      patientName: '',
      chartNumber: '',
      startTime: null,
      durationMinutes: null,
    })),
    ...Array.from({ length: 13 }, (_, i) => ({
      id: `room3-${1 + i}`,
      number: String(1 + i),
      room: 'room3',
      status: 'vacant',
      patientName: '',
      chartNumber: '',
      startTime: null,
      durationMinutes: null,
    })),
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `floor2-${i + 1}`,
      number: `2F-${i + 1}`,
      room: 'floor2',
      status: 'vacant',
      patientName: '',
      chartNumber: '',
      startTime: null,
      durationMinutes: null,
    })),
  ]
}

function loadBedsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultBeds()

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultBeds()

    const savedById = Object.fromEntries(parsed.map((bed) => [bed.id, bed]))
    return createDefaultBeds().map((defaultBed) => {
      const saved = savedById[defaultBed.id]
      if (!saved) return defaultBed
      return { ...defaultBed, ...saved }
    })
  } catch {
    return createDefaultBeds()
  }
}

function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function createHistoryEntry(bed, endTime) {
  const startTime = bed.startTime ?? endTime
  const usedMinutes = Math.round((endTime - startTime) / 60000)
  const dateStr = new Date(endTime).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const roomLabel =
    ROOM_TABS.find((t) => t.id === bed.room)?.label ?? bed.room

  return {
    id: `${bed.id}-${endTime}`,
    date: dateStr,
    room: roomLabel,
    bedNumber: bed.number,
    patientName: bed.patientName,
    chartNumber: bed.chartNumber,
    startTime: new Date(startTime).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    endTime: new Date(endTime).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    usedMinutes,
  }
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}시간 ${m}분`
  if (h > 0) return `${h}시간`
  return `${m}분`
}

function formatDurationClock(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function DurationControls({ minutes, onAdjust }) {
  return (
    <div className="duration">
      <span className="duration__label">예상 소요시간</span>
      <p className="duration__display">{formatDurationClock(minutes)}</p>
      <div className="duration__controls">
        <div className="duration__row duration__row--plus">
          <button
            type="button"
            className="duration__btn duration__btn--plus"
            onClick={() => onAdjust(10)}
          >
            +10분
          </button>
          <button
            type="button"
            className="duration__btn duration__btn--plus"
            onClick={() => onAdjust(30)}
          >
            +30분
          </button>
          <button
            type="button"
            className="duration__btn duration__btn--plus"
            onClick={() => onAdjust(60)}
          >
            +1시간
          </button>
        </div>
        <div className="duration__row duration__row--minus">
          <button
            type="button"
            className="duration__btn duration__btn--minus"
            onClick={() => onAdjust(-10)}
          >
            -10분
          </button>
          <button
            type="button"
            className="duration__btn duration__btn--minus"
            onClick={() => onAdjust(-30)}
          >
            -30분
          </button>
          <button
            type="button"
            className="duration__btn duration__btn--minus"
            onClick={() => onAdjust(-60)}
          >
            -1시간
          </button>
        </div>
      </div>
    </div>
  )
}

function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getBedProgress(bed, now) {
  if (!bed.startTime || !bed.durationMinutes) {
    return {
      progress: 0,
      remainingMs: 0,
      elapsedMs: 0,
      isCompleted: bed.status === 'completed',
      isWarning: false,
    }
  }

  const expectedMinutes = bed.durationMinutes
  const expectedSeconds = expectedMinutes * 60
  const elapsedSeconds = Math.max(0, (now - bed.startTime) / 1000)
  const rawProgress = (elapsedSeconds / expectedSeconds) * 100
  const progress = Math.min(100, Math.round(rawProgress))
  const totalMs = expectedSeconds * 1000
  const elapsedMs = elapsedSeconds * 1000
  const remainingMs = Math.max(0, totalMs - elapsedMs)
  const isCompleted =
    bed.status === 'completed' || rawProgress >= 100 || remainingMs === 0
  const isWarning = !isCompleted && remainingMs <= 30 * 60 * 1000
  return { progress, remainingMs, elapsedMs, isCompleted, isWarning }
}

function markCompletedIfNeeded(bed, now) {
  if (bed.status !== 'in-progress') return bed
  const { isCompleted } = getBedProgress(bed, now)
  if (isCompleted) return { ...bed, status: 'completed' }
  return bed
}

function getTimeDisplay(bed, now, showRemaining) {
  const { remainingMs, elapsedMs, isCompleted } = getBedProgress(bed, now)
  if (isCompleted) return '이용 완료'
  if (showRemaining) {
    return `남은 시간 ${formatDuration(Math.ceil(remainingMs / 60000))}`
  }
  return `진행 시간 ${formatElapsedTime(elapsedMs)}`
}

function getCardClassName(bed, { isCompleted, isWarning }) {
  if (bed.status === 'completed' || isCompleted) {
    return 'bed-card bed-card--completed'
  }
  if (isWarning) return 'bed-card bed-card--warning'
  return 'bed-card bed-card--occupied'
}

function getStatusLabel(bed, now) {
  if (bed.status === 'vacant') return '이용 가능'
  if (bed.status === 'completed' || getBedProgress(bed, now).isCompleted) {
    return '이용 완료'
  }
  return '진행중'
}

function resetBedToVacant(bed) {
  return {
    ...bed,
    status: 'vacant',
    patientName: '',
    chartNumber: '',
    startTime: null,
    durationMinutes: null,
  }
}

// ─── 공통 유틸 ───────────────────────────────────────────────────
// "YYYY. MM. DD." 형식 → Date 객체
function parseDateStr(dateStr) {
  const cleaned = dateStr.replace(/\.\s*/g, '-').replace(/-$/, '').trim()
  return new Date(cleaned)
}

// 오늘 날짜를 "YYYY-MM-DD" 문자열로 반환
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 이번 달 첫째 날을 "YYYY-MM-DD" 문자열로 반환
function thisMonthStartStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// history 항목이 주어진 날짜 범위 내에 있는지 확인
function inRange(entry, from, to) {
  const d = parseDateStr(entry.date)
  if (from) {
    const f = new Date(from)
    if (d < f) return false
  }
  if (to) {
    const t = new Date(to)
    t.setHours(23, 59, 59, 999)
    if (d > t) return false
  }
  return true
}

// ─── 통계 화면 ──────────────────────────────────────────────────
function StatsView({ history }) {
  const [dateFrom, setDateFrom] = useState(thisMonthStartStr)
  const [dateTo, setDateTo] = useState(todayStr)
  // 조회 버튼을 눌렀을 때만 반영되는 확정 범위
  const [appliedFrom, setAppliedFrom] = useState(thisMonthStartStr)
  const [appliedTo, setAppliedTo] = useState(todayStr)

  // ── 상단 요약: 전체 / 이번 달 (기간 선택 무관) ──────────────
  const totalAll = history.length

  const thisMonthStart = thisMonthStartStr()
  const totalThisMonth = history.filter((e) =>
    inRange(e, thisMonthStart, todayStr()),
  ).length

  // 수액실별 전체 이용건수
  const roomCountsAll = {}
  ROOM_TABS.forEach((t) => { roomCountsAll[t.label] = 0 })
  history.forEach((e) => {
    if (roomCountsAll[e.room] !== undefined) roomCountsAll[e.room]++
    else roomCountsAll[e.room] = 1
  })

  // ── 기간 조회 결과 ───────────────────────────────────────────
  const ranged = history.filter((e) => inRange(e, appliedFrom, appliedTo))

  // 수액실별 이용건수 (기간)
  const roomCountsRanged = {}
  ROOM_TABS.forEach((t) => { roomCountsRanged[t.label] = 0 })
  ranged.forEach((e) => {
    if (roomCountsRanged[e.room] !== undefined) roomCountsRanged[e.room]++
    else roomCountsRanged[e.room] = (roomCountsRanged[e.room] ?? 0) + 1
  })

  // 재방문 환자 TOP 10 (차트번호 기준, 2회 이상 방문)
  const visitMap = {}
  ranged.forEach((e) => {
    const k = e.chartNumber
    if (!visitMap[k]) {
      visitMap[k] = { chartNumber: k, patientName: e.patientName, count: 0 }
    }
    visitMap[k].count++
  })
  const top10 = Object.values(visitMap)
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // 기간 표시용
  const rangeLabel =
    appliedFrom && appliedTo
      ? `${appliedFrom} ~ ${appliedTo}`
      : appliedFrom
        ? `${appliedFrom} 이후`
        : appliedTo
          ? `${appliedTo} 이전`
          : '전체 기간'

  function handleQuery() {
    setAppliedFrom(dateFrom)
    setAppliedTo(dateTo)
  }

  // 수액실별 최대값 (프로그레스 바 비율 계산용)
  const maxRangedRoom = Math.max(...Object.values(roomCountsRanged), 1)

  return (
    <div className="stats-section">

      {/* ── 상단 요약 카드 ── */}
      <div className="stats-summary">
        <div className="stats-card stats-card--accent">
          <span className="stats-card__label">전체 이용건수</span>
          <span className="stats-card__value">{totalAll.toLocaleString()}<span className="stats-card__unit">건</span></span>
        </div>
        <div className="stats-card">
          <span className="stats-card__label">이번 달 이용건수</span>
          <span className="stats-card__value">{totalThisMonth.toLocaleString()}<span className="stats-card__unit">건</span></span>
        </div>
        {ROOM_TABS.map((t) => (
          <div className="stats-card" key={t.id}>
            <span className="stats-card__label">{t.label}</span>
            <span className="stats-card__value">
              {(roomCountsAll[t.label] ?? 0).toLocaleString()}
              <span className="stats-card__unit">건</span>
            </span>
          </div>
        ))}
      </div>

      {/* ── 기간 선택 ── */}
      <div className="stats-range">
        <span className="stats-range__label">조회 기간</span>
        <div className="stats-range__inputs">
          <input
            type="date"
            className="stats-range__input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="stats-range__sep">~</span>
          <input
            type="date"
            className="stats-range__input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="stats-range__btn"
          onClick={handleQuery}
        >
          조회
        </button>
      </div>

      {/* ── 기간 조회 결과 ── */}
      <div className="stats-result">
        <p className="stats-result__period">📅 {rangeLabel}</p>

        {ranged.length === 0 ? (
          <div className="stats-empty">해당 기간의 이용 기록이 없습니다.</div>
        ) : (
          <>
            {/* 전체 이용건수 */}
            <div className="stats-block">
              <h3 className="stats-block__title">전체 이용건수</h3>
              <p className="stats-block__count">
                <strong>{ranged.length.toLocaleString()}</strong>건
              </p>
            </div>

            {/* 수액실별 이용건수 */}
            <div className="stats-block">
              <h3 className="stats-block__title">수액실별 이용건수</h3>
              <ul className="stats-room-list">
                {ROOM_TABS.map((t) => {
                  const cnt = roomCountsRanged[t.label] ?? 0
                  const pct = Math.round((cnt / maxRangedRoom) * 100)
                  return (
                    <li key={t.id} className="stats-room-item">
                      <span className="stats-room-item__name">{t.label}</span>
                      <div className="stats-room-item__bar-wrap">
                        <div
                          className="stats-room-item__bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="stats-room-item__cnt">{cnt.toLocaleString()}건</span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* 재방문 TOP 10 */}
            <div className="stats-block">
              <h3 className="stats-block__title">재방문 환자 TOP 10</h3>
              {top10.length === 0 ? (
                <p className="stats-block__empty">해당 기간에 재방문 환자가 없습니다.</p>
              ) : (
                <ol className="stats-top-list">
                  {top10.map((p, idx) => (
                    <li key={p.chartNumber} className="stats-top-item">
                      <span className={`stats-top-item__rank stats-top-item__rank--${idx < 3 ? idx + 1 : 'rest'}`}>
                        {idx + 1}
                      </span>
                      <span className="stats-top-item__name">{p.patientName}</span>
                      <span className="stats-top-item__chart">({p.chartNumber})</span>
                      <span className="stats-top-item__count">{p.count}회</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 환자 조회 화면 ─────────────────────────────────────────────
function PatientView({ history }) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null) // "chartNumber"

  // 차트번호 기준으로 환자 목록 구성
  const patientMap = {}
  history.forEach((entry) => {
    const key = entry.chartNumber
    if (!patientMap[key]) {
      patientMap[key] = {
        chartNumber: entry.chartNumber,
        patientName: entry.patientName,
        entries: [],
      }
    }
    patientMap[key].entries.push(entry)
  })

  // 각 환자: 이용횟수, 최근 이용일 (entries는 이미 최신순으로 history에 들어있음)
  const allPatients = Object.values(patientMap).map((p) => {
    const sorted = [...p.entries].sort((a, b) => {
      // date 문자열 "YYYY. MM. DD." 비교
      return b.id.localeCompare(a.id)
    })
    return {
      ...p,
      count: p.entries.length,
      lastDate: p.entries[0]?.date ?? '',
      sortedEntries: sorted,
    }
  })

  // 검색 필터 (환자명 부분 일치)
  const trimmed = query.trim()
  const searchResults = trimmed
    ? allPatients.filter((p) => p.patientName.includes(trimmed))
    : []

  // 동명이인 처리: 같은 이름이 여러 차트번호로 존재하는 경우 감지
  const nameCounts = {}
  searchResults.forEach((p) => {
    nameCounts[p.patientName] = (nameCounts[p.patientName] ?? 0) + 1
  })

  const selectedPatient = selectedKey
    ? allPatients.find((p) => p.chartNumber === selectedKey) ?? null
    : null

  function handleSelect(chartNumber) {
    setSelectedKey(chartNumber)
  }

  function handleBack() {
    setSelectedKey(null)
  }

  function handleQueryChange(e) {
    setQuery(e.target.value)
    setSelectedKey(null)
  }

  // 이용이력 최신순 정렬 (id에 타임스탬프 포함되어 있으므로 역순)
  const patientHistory = selectedPatient
    ? [...selectedPatient.entries].sort((a, b) => b.id.localeCompare(a.id))
    : []

  return (
    <div className="patient-section">
      {/* 검색창 */}
      <div className="patient-search">
        <input
          type="text"
          className="patient-search__input"
          value={query}
          onChange={handleQueryChange}
          placeholder="환자명을 입력하세요"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="patient-search__clear"
            onClick={() => { setQuery(''); setSelectedKey(null) }}
            aria-label="검색 초기화"
          >
            ×
          </button>
        )}
      </div>

      {/* 상태별 렌더링 */}
      {!trimmed && !selectedPatient && (
        <div className="patient-empty">
          <p>환자명을 입력하면 검색 결과가 표시됩니다.</p>
        </div>
      )}

      {trimmed && !selectedPatient && (
        <>
          {searchResults.length === 0 ? (
            <div className="patient-empty">
              <p>"{trimmed}"에 해당하는 환자가 없습니다.</p>
            </div>
          ) : (
            <ul className="patient-list">
              {searchResults.map((p) => (
                <li key={p.chartNumber}>
                  <button
                    type="button"
                    className="patient-list__item"
                    onClick={() => handleSelect(p.chartNumber)}
                  >
                    <span className="patient-list__name">{p.patientName}</span>
                    {nameCounts[p.patientName] > 1 && (
                      <span className="patient-list__chart">({p.chartNumber})</span>
                    )}
                    <span className="patient-list__meta">
                      {p.count}회 · 최근 {p.lastDate}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selectedPatient && (
        <div className="patient-detail">
          {/* 뒤로 버튼 */}
          <button type="button" className="patient-detail__back" onClick={handleBack}>
            ← 목록으로
          </button>

          {/* 환자 요약 카드 */}
          <div className="patient-card">
            <div className="patient-card__header">
              <span className="patient-card__name">{selectedPatient.patientName}</span>
              <span className="patient-card__chart-badge">{selectedPatient.chartNumber}</span>
            </div>
            <div className="patient-card__stats">
              <div className="patient-card__stat">
                <span className="patient-card__stat-label">총 이용횟수</span>
                <span className="patient-card__stat-value">{selectedPatient.count}회</span>
              </div>
              <div className="patient-card__stat">
                <span className="patient-card__stat-label">최근 이용일</span>
                <span className="patient-card__stat-value">{selectedPatient.lastDate}</span>
              </div>
            </div>
          </div>

          {/* 이용 이력 테이블 */}
          <div className="patient-history">
            <h3 className="patient-history__title">전체 이용 이력</h3>
            <div className="history-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>수액실</th>
                    <th>베드</th>
                    <th>시작시간</th>
                    <th>종료시간</th>
                    <th>이용시간</th>
                  </tr>
                </thead>
                <tbody>
                  {patientHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.date}</td>
                      <td>{entry.room}</td>
                      <td>{entry.bedNumber}</td>
                      <td>{entry.startTime}</td>
                      <td>{entry.endTime}</td>
                      <td>{formatDuration(entry.usedMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 데이터관리 화면 ─────────────────────────────────────────────
function DataManageView({ allHistory, onUpdateHistory }) {
  // 검색 조건
  const [searchName, setSearchName] = useState('')
  const [searchChart, setSearchChart] = useState('')
  const [searchDate, setSearchDate] = useState('')

  // 선택된 항목 id Set
  const [checkedIds, setCheckedIds] = useState(new Set())

  // 삭제 확인 팝업
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // 휴지통 모드
  const [trashMode, setTrashMode] = useState(false)

  // ── 데이터 현황 ──
  const totalAll = allHistory.length
  const totalActive = allHistory.filter((e) => !e.deleted).length
  const totalDeleted = allHistory.filter((e) => e.deleted).length
  const totalPatients = new Set(
    allHistory.filter((e) => !e.deleted).map((e) => e.chartNumber),
  ).size

  // ── 현재 모드에 따른 소스 ──
  const sourceList = trashMode
    ? allHistory.filter((e) => e.deleted)
    : allHistory.filter((e) => !e.deleted)

  // ── 검색 필터 ──
  const filtered = sourceList.filter((entry) => {
    if (searchName.trim() && !entry.patientName.includes(searchName.trim()))
      return false
    if (searchChart.trim() && !entry.chartNumber.includes(searchChart.trim()))
      return false
    if (searchDate) {
      const entryDate = parseDateStr(entry.date)
      const target = new Date(searchDate)
      target.setHours(23, 59, 59, 999)
      const targetStart = new Date(searchDate)
      if (entryDate < targetStart || entryDate > target) return false
    }
    return true
  })

  // ── 전체 선택 ──
  const allChecked = filtered.length > 0 && filtered.every((e) => checkedIds.has(e.id))
  const someChecked = filtered.some((e) => checkedIds.has(e.id))

  function toggleAll() {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((e) => next.add(e.id))
        return next
      })
    }
  }

  function toggleOne(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── 모드 전환 시 선택 초기화 ──
  function switchMode(trash) {
    setTrashMode(trash)
    setCheckedIds(new Set())
  }

  // ── 선택 삭제 (deleted: true) ──
  function handleDeleteRequest() {
    if (checkedIds.size === 0) return
    setDeleteConfirm(true)
  }

  function handleDeleteConfirm() {
    onUpdateHistory((prev) =>
      prev.map((e) => (checkedIds.has(e.id) ? { ...e, deleted: true } : e)),
    )
    setCheckedIds(new Set())
    setDeleteConfirm(false)
  }

  // ── 선택 복구 (deleted: false) ──
  function handleRestore() {
    if (checkedIds.size === 0) return
    onUpdateHistory((prev) =>
      prev.map((e) => (checkedIds.has(e.id) ? { ...e, deleted: false } : e)),
    )
    setCheckedIds(new Set())
  }

  function handleSearchReset() {
    setSearchName('')
    setSearchChart('')
    setSearchDate('')
  }

  const hasFilter = searchName.trim() || searchChart.trim() || searchDate
  const checkedCount = filtered.filter((e) => checkedIds.has(e.id)).size

  return (
    <div className="dm-section">

      {/* ── 데이터 현황 ── */}
      <div className="dm-summary">
        <div className="dm-stat-card">
          <span className="dm-stat-card__label">전체 이용기록</span>
          <span className="dm-stat-card__value">{totalAll.toLocaleString()}<span className="dm-stat-card__unit">건</span></span>
        </div>
        <div className="dm-stat-card dm-stat-card--active">
          <span className="dm-stat-card__label">유효 이용기록</span>
          <span className="dm-stat-card__value">{totalActive.toLocaleString()}<span className="dm-stat-card__unit">건</span></span>
        </div>
        <div className="dm-stat-card dm-stat-card--deleted">
          <span className="dm-stat-card__label">휴지통</span>
          <span className="dm-stat-card__value">{totalDeleted.toLocaleString()}<span className="dm-stat-card__unit">건</span></span>
        </div>
        <div className="dm-stat-card dm-stat-card--patients">
          <span className="dm-stat-card__label">등록 환자 수</span>
          <span className="dm-stat-card__value">{totalPatients.toLocaleString()}<span className="dm-stat-card__unit">명</span></span>
        </div>
      </div>

      {/* ── 모드 전환 탭 ── */}
      <div className="dm-mode-bar">
        <button
          type="button"
          className={`dm-mode-btn${!trashMode ? ' dm-mode-btn--active' : ''}`}
          onClick={() => switchMode(false)}
        >
          이용기록
        </button>
        <button
          type="button"
          className={`dm-mode-btn dm-mode-btn--trash${trashMode ? ' dm-mode-btn--active' : ''}`}
          onClick={() => switchMode(true)}
        >
          🗑 휴지통 {totalDeleted > 0 && <span className="dm-mode-btn__badge">{totalDeleted}</span>}
        </button>
      </div>

      {/* ── 검색 ── */}
      <div className="dm-search">
        <div className="dm-search__row">
          <label className="dm-search__field">
            <span className="dm-search__label">환자명</span>
            <input
              type="text"
              className="dm-search__input"
              value={searchName}
              onChange={(e) => { setSearchName(e.target.value); setCheckedIds(new Set()) }}
              placeholder="환자명 검색"
            />
          </label>
          <label className="dm-search__field">
            <span className="dm-search__label">차트번호</span>
            <input
              type="text"
              className="dm-search__input"
              value={searchChart}
              onChange={(e) => { setSearchChart(e.target.value); setCheckedIds(new Set()) }}
              placeholder="차트번호 검색"
            />
          </label>
          <label className="dm-search__field">
            <span className="dm-search__label">날짜</span>
            <input
              type="date"
              className="dm-search__input"
              value={searchDate}
              onChange={(e) => { setSearchDate(e.target.value); setCheckedIds(new Set()) }}
            />
          </label>
          {hasFilter && (
            <button type="button" className="dm-search__reset" onClick={handleSearchReset}>
              초기화
            </button>
          )}
        </div>
        {hasFilter && (
          <p className="dm-search__count">
            검색 결과 <strong>{filtered.length}</strong>건
            <span className="dm-search__total"> / {trashMode ? '휴지통' : '유효'} {sourceList.length}건</span>
          </p>
        )}
      </div>

      {/* ── 액션 버튼 ── */}
      <div className="dm-actions">
        <span className="dm-actions__selected">
          {checkedCount > 0 ? `${checkedCount}건 선택됨` : ''}
        </span>
        {!trashMode ? (
          <button
            type="button"
            className="dm-btn dm-btn--delete"
            onClick={handleDeleteRequest}
            disabled={checkedCount === 0}
          >
            선택 삭제
          </button>
        ) : (
          <button
            type="button"
            className="dm-btn dm-btn--restore"
            onClick={handleRestore}
            disabled={checkedCount === 0}
          >
            선택 복구
          </button>
        )}
      </div>

      {/* ── 테이블 ── */}
      {filtered.length === 0 ? (
        <div className="dm-empty">
          {trashMode
            ? (totalDeleted === 0 ? '휴지통이 비어 있습니다.' : '검색 결과가 없습니다.')
            : (totalActive === 0 ? '이용 기록이 없습니다.' : '검색 결과가 없습니다.')}
        </div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th className="dm-table__check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                    onChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </th>
                <th>날짜</th>
                <th>수액실</th>
                <th>베드</th>
                <th>환자명</th>
                <th>차트번호</th>
                <th>시작시간</th>
                <th>종료시간</th>
                <th>이용시간</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className={checkedIds.has(entry.id) ? 'dm-table__row--checked' : ''}
                  onClick={() => toggleOne(entry.id)}
                >
                  <td className="dm-table__check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checkedIds.has(entry.id)}
                      onChange={() => toggleOne(entry.id)}
                    />
                  </td>
                  <td>{entry.date}</td>
                  <td>{entry.room}</td>
                  <td>{entry.bedNumber}</td>
                  <td>{entry.patientName}</td>
                  <td>{entry.chartNumber}</td>
                  <td>{entry.startTime}</td>
                  <td>{entry.endTime}</td>
                  <td>{formatDuration(entry.usedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 삭제 확인 팝업 ── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(false)}>
          <div className="modal modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                선택한 기록을 삭제하시겠습니까?
                <br />
                <span className="confirm__sub">삭제된 기록은 휴지통에서 복구할 수 있습니다.</span>
              </p>
              <div className="confirm__actions">
                <button type="button" className="btn-confirm btn-confirm--yes" onClick={handleDeleteConfirm}>
                  예
                </button>
                <button type="button" className="btn-confirm btn-confirm--no" onClick={() => setDeleteConfirm(false)}>
                  아니오
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 이용기록 화면 ──────────────────────────────────────────────
function HistoryView({ history }) {
  const [searchName, setSearchName] = useState('')
  const [searchChart, setSearchChart] = useState('')
  const [searchDateFrom, setSearchDateFrom] = useState('')
  const [searchDateTo, setSearchDateTo] = useState('')

  const filtered = history.filter((entry) => {
    if (searchName.trim()) {
      if (!entry.patientName.includes(searchName.trim())) return false
    }
    if (searchChart.trim()) {
      if (!entry.chartNumber.includes(searchChart.trim())) return false
    }
    if (searchDateFrom) {
      const entryDate = parseDateStr(entry.date)
      const fromDate = new Date(searchDateFrom)
      if (entryDate < fromDate) return false
    }
    if (searchDateTo) {
      const entryDate = parseDateStr(entry.date)
      const toDate = new Date(searchDateTo)
      // 종료일 당일 포함
      toDate.setHours(23, 59, 59, 999)
      if (entryDate > toDate) return false
    }
    return true
  })

  const hasFilter =
    searchName.trim() || searchChart.trim() || searchDateFrom || searchDateTo

  function handleReset() {
    setSearchName('')
    setSearchChart('')
    setSearchDateFrom('')
    setSearchDateTo('')
  }

  return (
    <div className="history-section">
      {/* 검색 필터 */}
      <div className="history-search">
        <div className="history-search__row">
          <label className="history-search__field">
            <span className="history-search__label">환자명</span>
            <input
              type="text"
              className="history-search__input"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="환자명 검색"
            />
          </label>
          <label className="history-search__field">
            <span className="history-search__label">차트번호</span>
            <input
              type="text"
              className="history-search__input"
              value={searchChart}
              onChange={(e) => setSearchChart(e.target.value)}
              placeholder="차트번호 검색"
            />
          </label>
        </div>
        <div className="history-search__row">
          <div className="history-search__field history-search__field--date">
            <span className="history-search__label">날짜 범위</span>
            <div className="history-search__date-range">
              <input
                type="date"
                className="history-search__input history-search__input--date"
                value={searchDateFrom}
                onChange={(e) => setSearchDateFrom(e.target.value)}
              />
              <span className="history-search__date-sep">~</span>
              <input
                type="date"
                className="history-search__input history-search__input--date"
                value={searchDateTo}
                onChange={(e) => setSearchDateTo(e.target.value)}
              />
            </div>
          </div>
          {hasFilter && (
            <button
              type="button"
              className="history-search__reset"
              onClick={handleReset}
            >
              초기화
            </button>
          )}
        </div>
        {hasFilter && (
          <p className="history-search__count">
            검색 결과 <strong>{filtered.length}</strong>건
            {filtered.length !== history.length && (
              <span className="history-search__total"> / 전체 {history.length}건</span>
            )}
          </p>
        )}
      </div>

      {/* 테이블 */}
      {filtered.length === 0 ? (
        <div className="history-empty">
          <p>{history.length === 0 ? '이용 기록이 없습니다.' : '검색 결과가 없습니다.'}</p>
        </div>
      ) : (
        <div className="history-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>수액실</th>
                <th>베드</th>
                <th>환자명</th>
                <th>차트번호</th>
                <th>시작시간</th>
                <th>종료시간</th>
                <th>이용시간</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>{entry.room}</td>
                  <td>{entry.bedNumber}</td>
                  <td>{entry.patientName}</td>
                  <td>{entry.chartNumber}</td>
                  <td>{entry.startTime}</td>
                  <td>{entry.endTime}</td>
                  <td>{formatDuration(entry.usedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── App ────────────────────────────────────────────────────────
function App() {
  const [beds, setBeds] = useState(() => loadBedsFromStorage())
  const [history, setHistory] = useState(() => loadHistoryFromStorage())
  const [activeTab, setActiveTab] = useState('all')
  const [selectedBed, setSelectedBed] = useState(null)
  const [cleanupBed, setCleanupBed] = useState(null)
  const [endEarlyConfirm, setEndEarlyConfirm] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [chartNumber, setChartNumber] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION)
  const [now, setNow] = useState(Date.now())
  const [showRemaining, setShowRemaining] = useState(true)
  const [editPatientModal, setEditPatientModal] = useState(false)
  const [editPatientName, setEditPatientName] = useState('')
  const [editChartNumber, setEditChartNumber] = useState('')
  const [removePatientConfirm, setRemovePatientConfirm] = useState(false)

  const hasActiveSessions = beds.some((bed) => bed.status !== 'vacant')
  const hasInProgressBeds = beds.some((bed) => bed.status === 'in-progress')

  // deleted: true 항목은 이용기록·통계·환자조회에서 제외
  const activeHistory = history.filter((e) => !e.deleted)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beds))
  }, [beds])

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => {
    if (!hasActiveSessions) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasActiveSessions])

  useEffect(() => {
    if (!hasInProgressBeds) {
      setShowRemaining(true)
      return
    }
    const toggleTimer = setInterval(() => {
      setShowRemaining((prev) => !prev)
    }, 3000)
    return () => clearInterval(toggleTimer)
  }, [hasInProgressBeds])

  useEffect(() => {
    setBeds((prev) => {
      let changed = false
      const next = prev.map((bed) => {
        const updated = markCompletedIfNeeded(bed, Date.now())
        if (updated !== bed) changed = true
        return updated
      })
      return changed ? next : prev
    })
  }, [now])

  const filteredBeds =
    activeTab === 'all'
      ? beds
      : beds.filter((bed) => bed.room === activeTab)

  const currentBed = selectedBed
    ? beds.find((bed) => bed.id === selectedBed.id) ?? selectedBed
    : null
  const isVacant = currentBed?.status === 'vacant'
  const isInProgress = currentBed?.status === 'in-progress'

  function openModal(bed) {
    setSelectedBed(bed)
    if (bed.status === 'vacant') {
      setPatientName('')
      setChartNumber('')
      setDurationMinutes(DEFAULT_DURATION)
    }
  }

  function handleBedClick(bed) {
    if (bed.status === 'completed') {
      setCleanupBed(bed)
      return
    }
    openModal(bed)
  }

  function closeModal() {
    setSelectedBed(null)
  }

  function closeCleanupConfirm() {
    setCleanupBed(null)
  }

  function handleCleanupYes() {
    if (!cleanupBed) return
    const endTime = Date.now()
    // 이용기록 저장
    const entry = createHistoryEntry(cleanupBed, endTime)
    setHistory((prev) => [entry, ...prev])
    // 베드 초기화
    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === cleanupBed.id ? resetBedToVacant(bed) : bed,
      ),
    )
    setCleanupBed(null)
  }

  function adjustDuration(delta) {
    setDurationMinutes((prev) => Math.max(MIN_DURATION, prev + delta))
  }

  function adjustBedDuration(delta) {
    if (!selectedBed || !currentBed) return

    if (delta < 0) {
      const { remainingMs } = getBedProgress(currentBed, now)
      const remainingMinutes = remainingMs / (60 * 1000)
      const reductionMinutes = Math.abs(delta)

      if (reductionMinutes > remainingMinutes) {
        setEndEarlyConfirm({ bedId: selectedBed.id })
        return
      }
    }

    setBeds((prev) =>
      prev.map((bed) => {
        if (bed.id !== selectedBed.id) return bed
        const updated = {
          ...bed,
          durationMinutes: Math.max(MIN_DURATION, bed.durationMinutes + delta),
        }
        return markCompletedIfNeeded(updated, Date.now())
      }),
    )
  }

  function closeEndEarlyConfirm() {
    setEndEarlyConfirm(null)
  }

  function handleEndEarlyYes() {
    if (!endEarlyConfirm) return
    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === endEarlyConfirm.bedId
          ? { ...bed, status: 'completed' }
          : bed,
      ),
    )
    setEndEarlyConfirm(null)
  }

  function handleRemovePatientConfirm() {
    if (!selectedBed) return
    // 베드만 초기화, history에는 저장하지 않음
    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === selectedBed.id ? resetBedToVacant(bed) : bed,
      ),
    )
    setRemovePatientConfirm(false)
    closeModal()
  }

  function openEditPatientModal() {
    if (!currentBed) return
    setEditPatientName(currentBed.patientName)
    setEditChartNumber(currentBed.chartNumber)
    setEditPatientModal(true)
  }

  function closeEditPatientModal() {
    setEditPatientModal(false)
  }

  function handleSavePatientEdit() {
    if (!editPatientName.trim() || !editChartNumber.trim() || !selectedBed) return
    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === selectedBed.id
          ? {
              ...bed,
              patientName: editPatientName.trim(),
              chartNumber: editChartNumber.trim(),
            }
          : bed,
      ),
    )
    setEditPatientModal(false)
  }

  function handleRegister() {
    if (!patientName.trim() || !chartNumber.trim() || !selectedBed) return

    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === selectedBed.id
          ? {
              ...bed,
              status: 'in-progress',
              patientName: patientName.trim(),
              chartNumber: chartNumber.trim(),
              startTime: Date.now(),
              durationMinutes,
            }
          : bed,
      ),
    )
    closeModal()
  }

  return (
    <div className="app">
      <header className="header">
        <img src={logoIcon} alt="벗이비인후과 로고" className="header__logo" />
        <div className="header__text">
          <span className="header__clinic">벗이비인후과</span>
          <h1 className="header__title">수액실 관리</h1>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${activeTab === tab.id ? 'tab--active' : ''}${tab.id === 'history' ? ' tab--history' : ''}${tab.id === 'patient' ? ' tab--patient' : ''}${tab.id === 'stats' ? ' tab--stats' : ''}${tab.id === 'datamanage' ? ' tab--datamanage' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'history' ? (
        <HistoryView history={activeHistory} />
      ) : activeTab === 'patient' ? (
        <PatientView history={activeHistory} />
      ) : activeTab === 'stats' ? (
        <StatsView history={activeHistory} />
      ) : activeTab === 'datamanage' ? (
        <DataManageView allHistory={history} onUpdateHistory={setHistory} />
      ) : (
        <main className="bed-grid">
          {filteredBeds.map((bed) => {
            if (bed.status === 'vacant') {
              return (
                <article
                  key={bed.id}
                  className="bed-card bed-card--vacant"
                  onClick={() => handleBedClick(bed)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed)}
                >
                  <p className="bed-card__number">{bed.number}</p>
                  <p className="bed-card__status">이용 가능</p>
                </article>
              )
            }

            const { progress, isCompleted, isWarning } = getBedProgress(bed, now)
            const completed = bed.status === 'completed' || isCompleted
            const displayProgress = completed ? 100 : progress

            return (
              <article
                key={bed.id}
                className={getCardClassName(bed, {
                  isCompleted: completed,
                  isWarning,
                })}
                onClick={() => handleBedClick(bed)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed)}
              >
                <p className="bed-card__number">{bed.number}</p>
                <p className="bed-card__patient">{bed.patientName}</p>
                <p className="bed-card__chart">{bed.chartNumber}</p>
                <div className="bed-card__progress">
                  <p className="bed-card__progress-text">
                    진행률 {displayProgress}%
                  </p>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${displayProgress}%` }}
                    />
                  </div>
                </div>
                {completed ? (
                  <p className="bed-card__completed-label">이용 완료</p>
                ) : (
                  <p
                    key={showRemaining ? 'remaining' : 'elapsed'}
                    className="bed-card__remaining bed-card__time-display"
                  >
                    {getTimeDisplay(bed, now, showRemaining)}
                  </p>
                )}
              </article>
            )
          })}
        </main>
      )}

      {endEarlyConfirm && (
        <div className="modal-overlay modal-overlay--top" onClick={closeEndEarlyConfirm}>
          <div
            className="modal modal--confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                현재 남은 시간보다
                <br />
                빼려는 시간이 더 많습니다.
                <br />
                이용을 종료하시겠습니까?
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn-confirm btn-confirm--yes"
                  onClick={handleEndEarlyYes}
                >
                  예
                </button>
                <button
                  type="button"
                  className="btn-confirm btn-confirm--no"
                  onClick={closeEndEarlyConfirm}
                >
                  아니오
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cleanupBed && (
        <div className="modal-overlay" onClick={closeCleanupConfirm}>
          <div
            className="modal modal--confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                이용이 완료되었습니다.
                <br />
                베드를 정리하시겠습니까?
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn-confirm btn-confirm--yes"
                  onClick={handleCleanupYes}
                >
                  예
                </button>
                <button
                  type="button"
                  className="btn-confirm btn-confirm--no"
                  onClick={closeCleanupConfirm}
                >
                  아니오
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedBed && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>베드 {selectedBed.number}</h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeModal}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            {isVacant ? (
              <div className="modal__body">
                <label className="field">
                  <span className="field__label">환자명</span>
                  <input
                    type="text"
                    className="field__input"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="환자명 입력"
                  />
                </label>

                <label className="field">
                  <span className="field__label">차트번호</span>
                  <input
                    type="text"
                    className="field__input"
                    value={chartNumber}
                    onChange={(e) => setChartNumber(e.target.value)}
                    placeholder="차트번호 입력"
                  />
                </label>

                <DurationControls
                  minutes={durationMinutes}
                  onAdjust={adjustDuration}
                />

                <button
                  type="button"
                  className="btn-register"
                  onClick={handleRegister}
                  disabled={!patientName.trim() || !chartNumber.trim()}
                >
                  등록
                </button>
              </div>
            ) : (
              <div className="modal__body">
                <dl className="info-list">
                  <div className="info-list__row">
                    <dt>수액실</dt>
                    <dd>
                      {TABS.find((tab) => tab.id === currentBed.room)?.label}
                    </dd>
                  </div>
                  <div className="info-list__row">
                    <dt>베드번호</dt>
                    <dd>{currentBed.number}</dd>
                  </div>
                  <div className="info-list__row">
                    <dt>환자명</dt>
                    <dd>{currentBed.patientName}</dd>
                  </div>
                  <div className="info-list__row">
                    <dt>차트번호</dt>
                    <dd>{currentBed.chartNumber}</dd>
                  </div>
                  <div className="info-list__row">
                    <dt>시작시간</dt>
                    <dd>
                      {new Date(currentBed.startTime).toLocaleTimeString(
                        'ko-KR',
                        { hour: '2-digit', minute: '2-digit' },
                      )}
                    </dd>
                  </div>
                  <div className="info-list__row">
                    <dt>진행률</dt>
                    <dd>{getBedProgress(currentBed, now).progress}%</dd>
                  </div>
                  <div className="info-list__row">
                    <dt>상태</dt>
                    <dd>{getStatusLabel(currentBed, now)}</dd>
                  </div>
                </dl>

                {isInProgress && (
                  <DurationControls
                    minutes={currentBed.durationMinutes}
                    onAdjust={adjustBedDuration}
                  />
                )}

                {isInProgress && (
                  <button
                    type="button"
                    className="btn-edit-patient"
                    onClick={openEditPatientModal}
                  >
                    환자 정보 수정
                  </button>
                )}

                {isInProgress && (
                  <button
                    type="button"
                    className="btn-remove-patient"
                    onClick={() => setRemovePatientConfirm(true)}
                  >
                    환자 등록 취소
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {removePatientConfirm && currentBed && (
        <div className="modal-overlay modal-overlay--top" onClick={() => setRemovePatientConfirm(false)}>
          <div className="modal modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                등록 취소는 수액이 취소된 경우에만 눌러주세요.
                <br />
                <span className="confirm__sub">수액이 조기 종료된 경우, 이용시간을 차감하여 완료 처리해주세요.</span>
              </p>
              <p className="confirm__patient-info">
                {currentBed.patientName} ({currentBed.chartNumber})
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn-confirm btn-confirm--yes btn-confirm--danger"
                  onClick={handleRemovePatientConfirm}
                >
                  등록 취소
                </button>
                <button
                  type="button"
                  className="btn-confirm btn-confirm--no"
                  onClick={() => setRemovePatientConfirm(false)}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editPatientModal && currentBed && (
        <div className="modal-overlay" onClick={closeEditPatientModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>환자 정보 수정</h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeEditPatientModal}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal__body">
              <label className="field">
                <span className="field__label">환자명</span>
                <input
                  type="text"
                  className="field__input"
                  value={editPatientName}
                  onChange={(e) => setEditPatientName(e.target.value)}
                  placeholder="환자명 입력"
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field__label">차트번호</span>
                <input
                  type="text"
                  className="field__input"
                  value={editChartNumber}
                  onChange={(e) => setEditChartNumber(e.target.value)}
                  placeholder="차트번호 입력"
                />
              </label>
              <button
                type="button"
                className="btn-register"
                onClick={handleSavePatientEdit}
                disabled={!editPatientName.trim() || !editChartNumber.trim()}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
