import { useEffect, useState } from 'react'
import './App.css'
import logoIcon from './assets/logo-icon-white.png'
import headerPortrait from './assets/header-portrait.png'

const STORAGE_KEY = 'infusion-room-beds'
const HISTORY_STORAGE_KEY = 'infusion-room-history'
const SESSION_NOTES_STORAGE_KEY = 'infusion-room-session-notes'
const PATIENT_NOTES_STORAGE_KEY = 'infusion-room-patient-notes'
const ROUNDS_STORAGE_KEY = 'infusion-room-rounds'

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

// 전체보기에서 방별로 묶을 때 쓰는 순서 (전체 탭 자체는 제외)
const ROOM_ORDER = ROOM_TABS.filter((t) => t.id !== 'all')

const DEFAULT_DURATION = 120
const MIN_DURATION = 10

// ─── 환자 특이사항 표준 어휘 (코드로 저장, 라벨로 표시) ──────────────
const SYMPTOM_OPTIONS = [
  { code: 'vein_pain', label: '혈관통' },
  { code: 'palpitation', label: '두근거림' },
  { code: 'chest_tightness', label: '답답함' },
  { code: 'nausea', label: '매스꺼움' },
  { code: 'vomiting', label: '구토' },
  { code: 'dizziness', label: '어지럼' },
  { code: 'feverish', label: '발열감' },
  { code: 'swelling', label: '붓기' },
  { code: 'leakage', label: '누출' },
]

const ACTION_OPTIONS = [
  { code: 'warm_pack', label: '찜질팩' },
  { code: 'rate_adjust', label: '속도조절' },
  { code: 'stop', label: '중단' },
  { code: 'improved', label: '호전' },
  { code: 'observe', label: '경과관찰' },
]

const SEVERITY_OPTIONS = [
  { code: 'mild', label: '경미' },
  { code: 'moderate', label: '보통' },
  { code: 'severe', label: '심함' },
]

const NOTE_CATEGORY_OPTIONS = [
  { code: 'warning', label: '경고' },
  { code: 'caution', label: '주의' },
  { code: 'info', label: '참고' },
]

const NOTE_SOURCE_OPTIONS = [
  { code: 'patient_report', label: '환자 진술' },
  { code: 'clinic_relay', label: '진료실 전달' },
  { code: 'direct_obs', label: '직접 관찰' },
]

// ─── 라운딩(정기 순회 체크) 표준 어휘 · 설정 상수 ──────────────────
const ROUND_STATE_OPTIONS = [
  { code: 'good', label: '양호' },
  { code: 'sleeping', label: '수면 중' },
  { code: 'discomfort', label: '불편감 호소' },
  { code: 'fever', label: '발열' },
]

const ROUND_INTERVAL_MIN = 30 // 라운딩 간격(분)
const ROUND_SOON_LEAD_MIN = 10 // "곧 라운딩" 힌트를 띄우는 리드타임(분)

const FEVER_MILD_MIN = 37.5 // 이상: 미열(주황)
const FEVER_HIGH_MIN = 38.0 // 이상: 고열(빨강). 37.5 미만은 카드에 체온 표시 안 함

function generateNoteId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

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
      sessionId: null,
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
      sessionId: null,
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
      sessionId: null,
    })),
  ]
}

// 수액 세션 고유 ID 생성 ("금일 특이사항"이 세션 진행 중에 붙는 연결 키)
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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

function loadSessionNotesFromStorage() {
  try {
    const raw = localStorage.getItem(SESSION_NOTES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadPatientNotesFromStorage() {
  try {
    const raw = localStorage.getItem(PATIENT_NOTES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadRoundsFromStorage() {
  try {
    const raw = localStorage.getItem(ROUNDS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 최소 유효 라운딩 = occurredAt만 있으면 성립("확인 도장").
// temperature/state/memo는 모두 선택이며 비어도 레코드가 생기고 타이머가 리셋된다.
function createRoundRecord({ sessionId, chartNumber, occurredAt, temperature = null, state = null, memo = '' }) {
  return {
    id: generateNoteId('rnd'),
    sessionId,
    chartNumber,
    occurredAt,
    temperature,
    state,
    memo,
    createdAt: new Date().toISOString(),
    createdBy: null,
    deleted: false,
  }
}

// 라운딩 이력 조회: 해당 환자의 !deleted 라운딩을 occurredAt 내림차순(최신이 위)
function getRoundsByChartNumber(rounds, chartNumber) {
  return rounds
    .filter((r) => r.chartNumber === chartNumber && !r.deleted)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
}

// 체온 색 톤: 고열(≥FEVER_HIGH_MIN) → 'high', 미열(≥FEVER_MILD_MIN) → 'mild', 그 외/null → null
function getRoundTempTone(temp) {
  if (temp == null) return null
  if (temp >= FEVER_HIGH_MIN) return 'high'
  if (temp >= FEVER_MILD_MIN) return 'mild'
  return null
}

// 체온 입력 문자열 → number | null. 빈값/공백/숫자아님은 null.
function parseTemperature(raw) {
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const n = parseFloat(trimmed)
  return Number.isNaN(n) ? null : n
}

// 해당 세션의 마지막 라운딩(!deleted, occurredAt 최신 1건). 없으면 null.
function getLatestSessionRound(rounds, sessionId) {
  if (!sessionId) return null
  let latest = null
  for (const r of rounds) {
    if (r.sessionId !== sessionId || r.deleted) continue
    if (!latest || new Date(r.occurredAt) > new Date(latest.occurredAt)) latest = r
  }
  return latest
}

// 카드 라운딩 상태: anchor = 마지막 라운딩 occurredAt(없으면 수액 시작시각).
// 경과 < 20분 → ok(남은 30−경과), 20~30분 → soon(남은 30−경과), ≥30분 → due(경과−30).
// A-3의 soon은 순수 로컬 타이머 기준(같은 수액실 묶음 필터는 A-4에서).
function getRoundStatus(bed, latestRound, now) {
  const anchor = latestRound ? new Date(latestRound.occurredAt).getTime() : bed.startTime
  if (!anchor) return null
  const elapsedMin = Math.max(0, Math.floor((now - anchor) / 60000))
  const soonAt = ROUND_INTERVAL_MIN - ROUND_SOON_LEAD_MIN // 20
  if (elapsedMin < soonAt) {
    return { status: 'ok', minutes: ROUND_INTERVAL_MIN - elapsedMin }
  }
  if (elapsedMin < ROUND_INTERVAL_MIN) {
    return { status: 'soon', minutes: ROUND_INTERVAL_MIN - elapsedMin }
  }
  return { status: 'due', minutes: elapsedMin - ROUND_INTERVAL_MIN }
}

// 카드에 얹을 체온: 마지막 라운딩 체온이 mild/high면 { temp, tone }, 정상·미측정이면 null.
function getCardRoundTemp(latestRound) {
  if (!latestRound) return null
  const tone = getRoundTempTone(latestRound.temperature)
  if (!tone) return null
  return { temp: latestRound.temperature, tone }
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
    sessionId: bed.sessionId ?? null,
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

function DurationControls({ minutes, onAdjust, remainingMs }) {
  // remainingMs가 전달되면 남은 시간 표시, 아니면 총 시간 표시
  const displayLabel = remainingMs !== undefined ? '남은 시간' : '예상 소요시간'
  const remaining = remainingMs !== undefined
    ? Math.max(0, Math.ceil(remainingMs / 60000))
    : null
  const displayClock = remaining !== null
    ? formatDurationClock(remaining)
    : formatDurationClock(minutes)
  const isExpired = remaining !== null && remaining <= 0

  return (
    <div className="duration">
      <span className="duration__label">{displayLabel}</span>
      <p className={`duration__display${isExpired ? ' duration__display--expired' : ''}`}>
        {displayClock}
      </p>
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

function formatHour24(timestamp) {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 공용 발생시각 선택 컴포넌트: 기본값 지금, 당김 버튼(-5/-15/-30분), 시:분 직접입력.
// 특이사항 기록 폼과 라운딩 모달(A-2) 양쪽에서 재사용한다.
function OccurredAtPicker({ valueMs, onChange }) {
  const d = new Date(valueMs)
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  function adjust(deltaMin) {
    onChange(valueMs + deltaMin * 60000)
  }

  function handleTimeInput(e) {
    const [h, m] = e.target.value.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return
    const next = new Date(valueMs)
    next.setHours(h, m, 0, 0)
    onChange(next.getTime())
  }

  return (
    <div className="occurred-at">
      <div className="occurred-at__row">
        <span className="field__label">발생 시각</span>
        <input
          type="time"
          className="occurred-at__input"
          value={timeStr}
          onChange={handleTimeInput}
        />
        <button type="button" className="occurred-at__now" onClick={() => onChange(Date.now())}>
          지금
        </button>
      </div>
      <div className="occurred-at__pulls">
        <button type="button" className="occurred-at__pull" onClick={() => adjust(-5)}>
          -5분
        </button>
        <button type="button" className="occurred-at__pull" onClick={() => adjust(-15)}>
          -15분
        </button>
        <button type="button" className="occurred-at__pull" onClick={() => adjust(-30)}>
          -30분
        </button>
      </div>
    </div>
  )
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

function getCardClassName(bed, { isCompleted, isWarning }) {
  if (bed.status === 'completed' || isCompleted) {
    return 'bed-card bed-card--completed'
  }
  if (isWarning) return 'bed-card bed-card--warning'
  return 'bed-card bed-card--occupied'
}

// 베드 번호 문자열 끝의 숫자를 추출 ("2F-11" → 11, "22" → 22)
function parseBedNumber(bed) {
  const match = bed.number.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

function sortBedsByNumber(bedList) {
  return [...bedList].sort((a, b) => parseBedNumber(a) - parseBedNumber(b))
}

// 전체보기 상단 요약 바 집계용 상태 분류
function getBedStatusCategory(bed, now) {
  if (bed.status === 'vacant') return 'vacant'
  const { isCompleted, isWarning } = getBedProgress(bed, now)
  if (bed.status === 'completed' || isCompleted) return 'completed'
  if (isWarning) return 'warning'
  return 'occupied'
}

function resetBedToVacant(bed) {
  return {
    ...bed,
    status: 'vacant',
    patientName: '',
    chartNumber: '',
    startTime: null,
    durationMinutes: null,
    sessionId: null,
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

// ─── 브리핑 팝업 데이터 헬퍼 ─────────────────────────────────────
const NOTE_CATEGORY_RANK = { warning: 0, caution: 1, info: 2 }

// occurredAt이 없는 기존(레거시) session_note는 createdAt으로 대체
function getNoteOccurredAt(note) {
  return note.occurredAt ?? note.createdAt
}

function getActivePatientNotes(patientNotes, chartNumber) {
  return patientNotes
    .filter((n) => n.chartNumber === chartNumber && n.active && !n.deleted)
    .sort((a, b) => (NOTE_CATEGORY_RANK[a.category] ?? 3) - (NOTE_CATEGORY_RANK[b.category] ?? 3))
}

// 베드 카드용 특이사항 다줄 요약: 경고(patient_note) → 주의(patient_note) → 금일(session_note) 순,
// 최대 4줄까지, 초과분은 마지막 줄을 "+N건 더"로 (info는 카드에서 계속 제외)
function getCardNoteLines(patientNotes, sessionNotes, bed) {
  const relevantPatientNotes = patientNotes.filter(
    (n) =>
      n.chartNumber === bed.chartNumber &&
      n.active &&
      !n.deleted &&
      (n.category === 'warning' || n.category === 'caution'),
  )
  const warnings = relevantPatientNotes.filter((n) => n.category === 'warning')
  const cautions = relevantPatientNotes.filter((n) => n.category === 'caution')
  const todayNotes = getSessionNotesBySessionId(sessionNotes, bed.sessionId).sort(
    (a, b) => new Date(getNoteOccurredAt(b)) - new Date(getNoteOccurredAt(a)),
  )

  const allLines = [
    ...warnings.map((n) => ({ tone: 'danger', icon: '⚠', text: n.content })),
    ...cautions.map((n) => ({ tone: 'caution', icon: '⚠', text: n.content })),
    ...todayNotes.map((n) => ({
      tone: 'neutral',
      icon: '🕐',
      text: `${formatHour24(getNoteOccurredAt(n))} ${summarizeSessionNotesForTable([n])}`,
    })),
  ]

  const MAX_LINES = 4
  if (allLines.length <= MAX_LINES) {
    return { lines: allLines, moreCount: 0 }
  }
  const shown = allLines.slice(0, MAX_LINES - 1)
  return { lines: shown, moreCount: allLines.length - shown.length }
}

function getRecentSessionNotes(sessionNotes, chartNumber, limit = 5) {
  return sessionNotes
    .filter((n) => n.chartNumber === chartNumber && !n.deleted)
    .sort((a, b) => new Date(getNoteOccurredAt(b)) - new Date(getNoteOccurredAt(a)))
    .slice(0, limit)
}

function formatSessionNoteLine(note) {
  const symptomLabels = note.symptoms
    .map((code) => SYMPTOM_OPTIONS.find((o) => o.code === code)?.label)
    .filter(Boolean)
  const actionLabels = note.actions
    .map((code) => ACTION_OPTIONS.find((o) => o.code === code)?.label)
    .filter(Boolean)
  const dateStr = new Date(getNoteOccurredAt(note)).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = []
  if (symptomLabels.length) parts.push(symptomLabels.join('·'))
  if (actionLabels.length) parts.push(actionLabels.join('·'))
  const summary = parts.length ? parts.join(' → ') : note.memo || '기록'
  return `${dateStr} | 시작 ${note.elapsedMin}분 · ${summary}`
}

function getSessionNotesBySessionId(sessionNotes, sessionId) {
  if (!sessionId) return []
  return sessionNotes.filter((n) => n.sessionId === sessionId && !n.deleted)
}

// history 항목 삭제/복구 시 같은 sessionId를 가진 session_note에도 대칭으로 반영
function cascadeSessionNoteDeleted(historyEntries, sessionNotes, deletedValue) {
  const sessionIds = new Set(historyEntries.map((e) => e.sessionId).filter(Boolean))
  if (sessionIds.size === 0) return sessionNotes
  return sessionNotes.map((n) =>
    sessionIds.has(n.sessionId) ? { ...n, deleted: deletedValue } : n,
  )
}

function summarizeSessionNotesForTable(notes) {
  if (notes.length === 0) return '-'
  return notes
    .map((n) => {
      const symptomLabels = n.symptoms
        .map((code) => SYMPTOM_OPTIONS.find((o) => o.code === code)?.label)
        .filter(Boolean)
      const actionLabels = n.actions
        .map((code) => ACTION_OPTIONS.find((o) => o.code === code)?.label)
        .filter(Boolean)
      const parts = [...symptomLabels, ...actionLabels]
      return parts.length ? parts.join('·') : n.memo || '메모'
    })
    .join(', ')
}

function getPatientVisitInfo(history, chartNumber) {
  const visits = history
    .filter((h) => h.chartNumber === chartNumber && !h.deleted)
    .sort((a, b) => parseDateStr(b.date) - parseDateStr(a.date))
  return { count: visits.length, lastVisitDate: visits[0]?.date ?? null }
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
function PatientView({
  history,
  patientNotes,
  sessionNotes,
  initialChartNumber,
  onInitialChartConsumed,
}) {
  const [query, setQuery] = useState(() => {
    if (!initialChartNumber) return ''
    return history.find((h) => h.chartNumber === initialChartNumber)?.patientName ?? ''
  })
  const [selectedKey, setSelectedKey] = useState(initialChartNumber ?? null) // "chartNumber"

  useEffect(() => {
    if (initialChartNumber) onInitialChartConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const selectedPatientNotes = selectedPatient
    ? getActivePatientNotes(patientNotes, selectedPatient.chartNumber)
    : []

  const selectedPatientRecentNotes = selectedPatient
    ? getRecentSessionNotes(sessionNotes, selectedPatient.chartNumber, 5)
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

          {/* 환자 주의사항 */}
          {selectedPatientNotes.length > 0 && (
            <div className="patient-notes">
              <h3 className="patient-history__title">환자 주의사항</h3>
              <ul className="briefing__note-list">
                {selectedPatientNotes.map((n) => (
                  <li key={n.id} className="briefing__note">
                    <div className="briefing__note-head">
                      <span className={`badge badge--${n.category}`}>
                        {NOTE_CATEGORY_OPTIONS.find((o) => o.code === n.category)?.label}
                      </span>
                      <span className="briefing__note-content">{n.content}</span>
                    </div>
                    <p className="briefing__note-source">
                      근거: {NOTE_SOURCE_OPTIONS.find((o) => o.code === n.source)?.label}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 최근 방문 타임라인 (금일 특이사항) */}
          {selectedPatientRecentNotes.length > 0 && (
            <div className="patient-notes">
              <h3 className="patient-history__title">최근 방문 특이사항</h3>
              <ul className="briefing__history-list">
                {selectedPatientRecentNotes.map((n) => (
                  <li key={n.id}>{formatSessionNoteLine(n)}</li>
                ))}
              </ul>
            </div>
          )}

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
                    <th>특이사항</th>
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
                      <td>
                        {summarizeSessionNotesForTable(
                          getSessionNotesBySessionId(sessionNotes, entry.sessionId),
                        )}
                      </td>
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
function DataManageView({
  allHistory,
  onUpdateHistory,
  sessionNotes,
  onUpdateSessionNotes,
  patientNotes,
  onUpdatePatientNotes,
}) {
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

  // 특이사항 데이터 관리
  const [noteSearchChart, setNoteSearchChart] = useState('')
  const [sessionNoteTrash, setSessionNoteTrash] = useState(false)
  const [patientNoteTrash, setPatientNoteTrash] = useState(false)

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
    const targets = allHistory.filter((e) => checkedIds.has(e.id))
    onUpdateHistory((prev) =>
      prev.map((e) => (checkedIds.has(e.id) ? { ...e, deleted: true } : e)),
    )
    onUpdateSessionNotes((prev) => cascadeSessionNoteDeleted(targets, prev, true))
    setCheckedIds(new Set())
    setDeleteConfirm(false)
  }

  // ── 선택 복구 (deleted: false) ──
  function handleRestore() {
    if (checkedIds.size === 0) return
    const targets = allHistory.filter((e) => checkedIds.has(e.id))
    onUpdateHistory((prev) =>
      prev.map((e) => (checkedIds.has(e.id) ? { ...e, deleted: false } : e)),
    )
    onUpdateSessionNotes((prev) => cascadeSessionNoteDeleted(targets, prev, false))
    setCheckedIds(new Set())
  }

  function handleSearchReset() {
    setSearchName('')
    setSearchChart('')
    setSearchDate('')
  }

  const hasFilter = searchName.trim() || searchChart.trim() || searchDate
  const checkedCount = filtered.filter((e) => checkedIds.has(e.id)).size

  // ── 특이사항 데이터 관리 ──
  function findPatientNameByChart(chartNumber) {
    return (
      allHistory.find((h) => h.chartNumber === chartNumber)?.patientName ??
      patientNotes.find((n) => n.chartNumber === chartNumber)?.patientName ??
      ''
    )
  }

  const trimmedNoteSearch = noteSearchChart.trim()

  const sessionNoteList = sessionNotes
    .filter((n) => (sessionNoteTrash ? n.deleted : !n.deleted))
    .filter((n) => !trimmedNoteSearch || n.chartNumber.includes(trimmedNoteSearch))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const patientNoteList = patientNotes
    .filter((n) => (patientNoteTrash ? n.deleted : !n.deleted))
    .filter((n) => !trimmedNoteSearch || n.chartNumber.includes(trimmedNoteSearch))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  function handleToggleSessionNoteDeleted(id, deletedValue) {
    onUpdateSessionNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, deleted: deletedValue } : n)),
    )
  }

  function handleTogglePatientNoteDeleted(id, deletedValue) {
    onUpdatePatientNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, deleted: deletedValue } : n)),
    )
  }

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

      {/* ── 특이사항 데이터 관리 ── */}
      <div className="dm-note-manage">
        <h3 className="dm-note-manage__title">특이사항 데이터 관리</h3>

        <label className="dm-search__field dm-note-manage__search">
          <span className="dm-search__label">차트번호로 검색</span>
          <input
            type="text"
            className="dm-search__input"
            value={noteSearchChart}
            onChange={(e) => setNoteSearchChart(e.target.value)}
            placeholder="차트번호 검색"
          />
        </label>

        {/* 금일 특이사항 관리 */}
        <div className="dm-note-section">
          <div className="dm-note-section__header">
            <h4>금일 특이사항 ({sessionNoteList.length})</h4>
            <button
              type="button"
              className={`dm-mode-btn dm-mode-btn--trash${sessionNoteTrash ? ' dm-mode-btn--active' : ''}`}
              onClick={() => setSessionNoteTrash((prev) => !prev)}
            >
              🗑 {sessionNoteTrash ? '삭제됨 보는 중' : '삭제됨 보기'}
            </button>
          </div>

          {sessionNoteList.length === 0 ? (
            <div className="dm-empty">
              {sessionNoteTrash ? '삭제된 금일 특이사항이 없습니다.' : '금일 특이사항이 없습니다.'}
            </div>
          ) : (
            <div className="dm-table-wrap">
              <table className="dm-table">
                <thead>
                  <tr>
                    <th>등록일</th>
                    <th>차트번호</th>
                    <th>환자명</th>
                    <th>내용</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessionNoteList.map((n) => (
                    <tr key={n.id}>
                      <td>{new Date(n.createdAt).toLocaleDateString('ko-KR')}</td>
                      <td>{n.chartNumber}</td>
                      <td>{findPatientNameByChart(n.chartNumber)}</td>
                      <td>{summarizeSessionNotesForTable([n])}</td>
                      <td className="dm-note-manage__action">
                        <button
                          type="button"
                          className="dm-note-btn"
                          onClick={() =>
                            handleToggleSessionNoteDeleted(n.id, !sessionNoteTrash)
                          }
                        >
                          {sessionNoteTrash ? '복구' : '삭제'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 환자 주의사항 관리 */}
        <div className="dm-note-section">
          <div className="dm-note-section__header">
            <h4>환자 주의사항 ({patientNoteList.length})</h4>
            <button
              type="button"
              className={`dm-mode-btn dm-mode-btn--trash${patientNoteTrash ? ' dm-mode-btn--active' : ''}`}
              onClick={() => setPatientNoteTrash((prev) => !prev)}
            >
              🗑 {patientNoteTrash ? '삭제됨 보는 중' : '삭제됨 보기'}
            </button>
          </div>

          {patientNoteList.length === 0 ? (
            <div className="dm-empty">
              {patientNoteTrash ? '삭제된 환자 주의사항이 없습니다.' : '환자 주의사항이 없습니다.'}
            </div>
          ) : (
            <div className="dm-table-wrap">
              <table className="dm-table">
                <thead>
                  <tr>
                    <th>등록일</th>
                    <th>차트번호</th>
                    <th>환자명</th>
                    <th>분류</th>
                    <th>내용</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {patientNoteList.map((n) => (
                    <tr key={n.id}>
                      <td>{new Date(n.createdAt).toLocaleDateString('ko-KR')}</td>
                      <td>{n.chartNumber}</td>
                      <td>{n.patientName}</td>
                      <td>
                        <span className={`badge badge--${n.category}`}>
                          {NOTE_CATEGORY_OPTIONS.find((o) => o.code === n.category)?.label}
                        </span>
                      </td>
                      <td>{n.content}</td>
                      <td className="dm-note-manage__action">
                        <button
                          type="button"
                          className="dm-note-btn"
                          onClick={() =>
                            handleTogglePatientNoteDeleted(n.id, !patientNoteTrash)
                          }
                        >
                          {patientNoteTrash ? '복구' : '삭제'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
  const [sessionNotes, setSessionNotes] = useState(() => loadSessionNotesFromStorage())
  const [patientNotes, setPatientNotes] = useState(() => loadPatientNotesFromStorage())
  const [rounds, setRounds] = useState(() => loadRoundsFromStorage())
  const [activeTab, setActiveTab] = useState('all')
  const [selectedBed, setSelectedBed] = useState(null)
  const [cleanupBed, setCleanupBed] = useState(null)
  const [endEarlyConfirm, setEndEarlyConfirm] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [chartNumber, setChartNumber] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION)
  const [now, setNow] = useState(Date.now())
  const [editPatientModal, setEditPatientModal] = useState(false)
  const [editPatientName, setEditPatientName] = useState('')
  const [editChartNumber, setEditChartNumber] = useState('')
  const [removePatientConfirm, setRemovePatientConfirm] = useState(false)
  const [movingBed, setMovingBed] = useState(null)
  const [moveBedAlert, setMoveBedAlert] = useState('')
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteTab, setNoteTab] = useState('session')
  const [noteOccurredAt, setNoteOccurredAt] = useState(() => Date.now())
  const [noteSymptoms, setNoteSymptoms] = useState([])
  const [noteActions, setNoteActions] = useState([])
  const [noteSeverity, setNoteSeverity] = useState(null)
  const [noteMemo, setNoteMemo] = useState('')
  const [noteCategory, setNoteCategory] = useState('caution')
  const [noteContent, setNoteContent] = useState('')
  const [noteSource, setNoteSource] = useState('patient_report')
  const [roundModalOpen, setRoundModalOpen] = useState(false)
  const [roundOccurredAt, setRoundOccurredAt] = useState(() => Date.now())
  const [roundTemp, setRoundTemp] = useState('')
  const [roundState, setRoundState] = useState(null)
  const [roundMemo, setRoundMemo] = useState('')
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [patientViewSeed, setPatientViewSeed] = useState(null)
  const [collapsedRooms, setCollapsedRooms] = useState(() => new Set())

  const hasActiveSessions = beds.some((bed) => bed.status !== 'vacant')

  // deleted: true 항목은 이용기록·통계·환자조회에서 제외
  const activeHistory = history.filter((e) => !e.deleted)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beds))
  }, [beds])

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => {
    localStorage.setItem(SESSION_NOTES_STORAGE_KEY, JSON.stringify(sessionNotes))
  }, [sessionNotes])

  useEffect(() => {
    localStorage.setItem(PATIENT_NOTES_STORAGE_KEY, JSON.stringify(patientNotes))
  }, [patientNotes])

  useEffect(() => {
    localStorage.setItem(ROUNDS_STORAGE_KEY, JSON.stringify(rounds))
  }, [rounds])

  useEffect(() => {
    if (!hasActiveSessions) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasActiveSessions])

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
      : sortBedsByNumber(beds.filter((bed) => bed.room === activeTab))

  const bedSummaryCounts = filteredBeds.reduce(
    (acc, bed) => {
      acc[getBedStatusCategory(bed, now)] += 1
      return acc
    },
    { occupied: 0, warning: 0, completed: 0, vacant: 0 },
  )

  const roomGroups =
    activeTab === 'all'
      ? ROOM_ORDER.map((room) => ({
          room,
          roomBeds: sortBedsByNumber(beds.filter((bed) => bed.room === room.id)),
        }))
      : null

  const currentBed = selectedBed
    ? beds.find((bed) => bed.id === selectedBed.id) ?? selectedBed
    : null
  const isVacant = currentBed?.status === 'vacant'
  const isInProgress = currentBed?.status === 'in-progress'
  const currentBedActiveNotes = currentBed
    ? getActivePatientNotes(patientNotes, currentBed.chartNumber)
    : []
  const currentBedIsWarning = isInProgress ? getBedProgress(currentBed, now).isWarning : false
  const currentBedChipCategory = currentBedIsWarning ? 'warning' : 'occupied'
  const currentBedChipLabel = currentBedIsWarning ? '곧 완료' : '진행중'

  function toggleRoomCollapse(roomId) {
    setCollapsedRooms((prev) => {
      const next = new Set(prev)
      next.has(roomId) ? next.delete(roomId) : next.add(roomId)
      return next
    })
  }

  function openModal(bed) {
    setSelectedBed(bed)
    if (bed.status === 'vacant') {
      setPatientName('')
      setChartNumber('')
      setDurationMinutes(DEFAULT_DURATION)
    }
  }

  function handleBedClick(bed) {
    // 이동 모드일 때 우선 처리
    if (movingBed) {
      handleMoveToBed(bed)
      return
    }
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

  function handleStartMoveBed() {
    if (!currentBed) return
    setMovingBed(currentBed)
    closeModal()
  }

  function handleCancelMoveBed() {
    setMovingBed(null)
    setMoveBedAlert('')
  }

  function handleMoveToBed(targetBed) {
    if (!movingBed) return

    // 자기 자신 클릭
    if (targetBed.id === movingBed.id) {
      setMoveBedAlert('현재 이용 중인 베드입니다.\n다른 빈 베드를 선택해주세요.')
      return
    }

    // 사용 중인 베드 클릭
    if (targetBed.status !== 'vacant') {
      setMoveBedAlert('사용 중인 베드로는 이동할 수 없습니다.\n빈 베드를 선택해주세요.')
      return
    }

    // 이동 실행: 환자 데이터 그대로 새 베드에 복사, 기존 베드 초기화
    setBeds((prev) =>
      prev.map((bed) => {
        if (bed.id === targetBed.id) {
          return {
            ...bed,
            status: movingBed.status,
            patientName: movingBed.patientName,
            chartNumber: movingBed.chartNumber,
            startTime: movingBed.startTime,
            durationMinutes: movingBed.durationMinutes,
            sessionId: movingBed.sessionId,
          }
        }
        if (bed.id === movingBed.id) {
          return resetBedToVacant(bed)
        }
        return bed
      }),
    )

    // 이동한 수액실 탭으로 전환
    setActiveTab(targetBed.room)
    setMovingBed(null)
    setMoveBedAlert('')
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

  function openNoteModal(tab) {
    if (!currentBed) return
    setNoteTab(tab)
    setNoteOccurredAt(Date.now())
    setNoteSymptoms([])
    setNoteActions([])
    setNoteSeverity(null)
    setNoteMemo('')
    setNoteCategory('caution')
    setNoteContent('')
    setNoteSource('patient_report')
    setNoteModalOpen(true)
  }

  function closeNoteModal() {
    setNoteModalOpen(false)
  }

  function openRoundModal(bed) {
    // 카드에서 열 때는 대상 베드를 넘김 → currentBed가 그 베드로 해석되도록 selectedBed 세팅.
    // 베드 상세 모달의 버튼에서 열 때는 인자 없이(이미 selectedBed 설정됨) currentBed 사용.
    const target = bed ?? currentBed
    if (!target) return
    if (bed) setSelectedBed(bed)
    setRoundOccurredAt(now) // 기본 발생시각 = 현재(매초 갱신되는 now state)
    setRoundTemp('')
    setRoundState(null)
    setRoundMemo('')
    setRoundModalOpen(true)
  }

  function closeRoundModal() {
    setRoundModalOpen(false)
  }

  function handleSaveRound() {
    if (!currentBed) return
    const newRound = createRoundRecord({
      sessionId: currentBed.sessionId,
      chartNumber: currentBed.chartNumber,
      occurredAt: new Date(roundOccurredAt).toISOString(),
      temperature: parseTemperature(roundTemp),
      state: roundState,
      memo: roundMemo.trim(),
    })
    setRounds((prev) => [newRound, ...prev])
    closeRoundModal()
  }

  function toggleChip(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  function handleSaveSessionNote() {
    if (!currentBed) return
    if (noteSymptoms.length === 0 && noteActions.length === 0 && !noteMemo.trim()) return

    const elapsedMin = currentBed.startTime
      ? Math.max(0, Math.round((noteOccurredAt - currentBed.startTime) / 60000))
      : 0

    const newNote = {
      id: generateNoteId('sn'),
      sessionId: currentBed.sessionId,
      chartNumber: currentBed.chartNumber,
      occurredAt: new Date(noteOccurredAt).toISOString(),
      elapsedMin,
      symptoms: noteSymptoms,
      actions: noteActions,
      severity: noteSeverity,
      memo: noteMemo.trim(),
      createdAt: new Date().toISOString(),
      createdBy: null,
      deleted: false,
    }
    setSessionNotes((prev) => [newNote, ...prev])
    closeNoteModal()
  }

  function handleSavePatientNote() {
    if (!currentBed || !noteContent.trim()) return

    const nowIso = new Date().toISOString()
    const newNote = {
      id: generateNoteId('pn'),
      chartNumber: currentBed.chartNumber,
      patientName: currentBed.patientName,
      category: noteCategory,
      content: noteContent.trim(),
      source: noteSource,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: null,
      deleted: false,
    }
    setPatientNotes((prev) => [newNote, ...prev])
    closeNoteModal()
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
              sessionId: generateSessionId(),
            }
          : bed,
      ),
    )
    setBriefingOpen(true)
  }

  function handleBriefingDismiss() {
    setBriefingOpen(false)
    closeModal()
  }

  function handleAddNoteFromBriefing() {
    setBriefingOpen(false)
    openNoteModal('patient')
  }

  function handleGoFullHistory() {
    if (!currentBed) return
    setBriefingOpen(false)
    closeModal()
    setPatientViewSeed(currentBed.chartNumber)
    setActiveTab('patient')
  }

  function renderBedCard(bed) {
    if (bed.status === 'vacant') {
      return (
        <article
          key={bed.id}
          className={`bed-card bed-card--vacant${movingBed ? ' bed-card--movable' : ''}`}
          onClick={() => handleBedClick(bed)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed)}
        >
          <p className="bed-card__number">{bed.number}</p>
          <div className="bed-card__add-slot">
            <span className="bed-card__add-icon">＋</span>
            <span className="bed-card__add-label">환자 등록</span>
          </div>
        </article>
      )
    }

    const { progress, isCompleted, isWarning, elapsedMs, remainingMs } = getBedProgress(bed, now)
    const completed = bed.status === 'completed' || isCompleted
    const displayProgress = completed ? 100 : progress
    const category = completed ? 'completed' : isWarning ? 'warning' : 'occupied'
    const chipLabel = completed ? '완료' : isWarning ? '곧 완료' : '진행중'
    const noteLines = getCardNoteLines(patientNotes, sessionNotes, bed)

    // 라운딩 줄 (완료/정리 상태 카드에는 표시 안 함)
    const latestRound = completed ? null : getLatestSessionRound(rounds, bed.sessionId)
    const roundStatus = completed ? null : getRoundStatus(bed, latestRound, now)
    const roundTemp = completed ? null : getCardRoundTemp(latestRound)
    const roundText =
      roundStatus?.status === 'ok'
        ? `라운딩 ${roundStatus.minutes}분 후`
        : roundStatus?.status === 'soon'
          ? `곧 라운딩 · ${roundStatus.minutes}분 후`
          : roundStatus?.status === 'due'
            ? `라운딩 필요 · ${roundStatus.minutes}분 경과`
            : ''
    const roundIcon =
      roundStatus?.status === 'due' ? '⚠' : roundStatus?.status === 'soon' ? '🔔' : '🕐'

    return (
      <article
        key={bed.id}
        className={`${getCardClassName(bed, { isCompleted: completed, isWarning })}${roundStatus?.status === 'due' ? ' bed-card--round-due' : ''}${movingBed && bed.id !== movingBed.id ? ' bed-card--dimmed' : ''}${movingBed && bed.id === movingBed.id ? ' bed-card--moving' : ''}`}
        onClick={() => handleBedClick(bed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed)}
      >
        <span className={`bed-card__chip bed-card__chip--${category}`}>{chipLabel}</span>
        <p className="bed-card__number">{bed.number}</p>
        <p className="bed-card__patient">{bed.patientName}</p>
        <p className="bed-card__chart">{bed.chartNumber}</p>
        {roundStatus && (
          <button
            type="button"
            className={`bed-card__round bed-card__round--${roundStatus.status}`}
            onClick={(e) => {
              e.stopPropagation()
              openRoundModal(bed)
            }}
          >
            <span className="bed-card__round-icon" aria-hidden="true">{roundIcon}</span>
            <span className="bed-card__round-body">
              {roundText}
              {roundTemp && (
                <span className={`bed-card__round-temp bed-card__round-temp--${roundTemp.tone}`}>
                  {' · '}{roundTemp.temp}℃
                </span>
              )}
            </span>
          </button>
        )}
        {noteLines.lines.length > 0 && (
          <div className="bed-card__notes">
            {noteLines.lines.map((line, i) => (
              <p key={i} className={`bed-card__caution bed-card__caution--${line.tone}`}>
                <span className="bed-card__caution-icon">{line.icon}</span>
                {line.text}
              </p>
            ))}
            {noteLines.moreCount > 0 && (
              <p className="bed-card__caution bed-card__caution--more">
                +{noteLines.moreCount}건 더
              </p>
            )}
          </div>
        )}
        <div className="bed-card__spacer" />
        <div className="bed-card__progress">
          <p className="bed-card__progress-text">
            진행률 {displayProgress}%
            {!completed && <span className="bed-card__droplet">💧</span>}
          </p>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${displayProgress}%` }}
            />
          </div>
        </div>
        {completed ? (
          <p className="bed-card__completed-label">정리 필요</p>
        ) : (
          <div className="bed-card__footer">
            <span className="bed-card__meta">
              {formatHour24(bed.startTime)} · {Math.floor(elapsedMs / 60000)}/{bed.durationMinutes}분
            </span>
            <span className="bed-card__remaining">
              남은 {formatDuration(Math.ceil(remainingMs / 60000))}
            </span>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="app">
      <div className="header-wrap">
        <header className="header">
          <img src={logoIcon} alt="벗이비인후과 로고" className="header__logo" />
          <div className="header__text">
            <span className="header__clinic">벗이비인후과</span>
            <h1 className="header__title">수액실 관리</h1>
          </div>
        </header>
        <img src={headerPortrait} alt="" className="header__dog" aria-hidden="true" />
      </div>

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

      {/* ── 자리이동 모드 안내 바 ── */}
      {movingBed && (
        <div className="move-banner">
          <div className="move-banner__text">
            <span className="move-banner__label">자리이동 중</span>
            <span className="move-banner__desc">
              <strong>{movingBed.patientName}</strong> 환자를 이동할 빈 베드를 선택해주세요.
            </span>
          </div>
          <button
            type="button"
            className="move-banner__cancel"
            onClick={handleCancelMoveBed}
          >
            취소
          </button>
        </div>
      )}

      {/* ── 자리이동 알림 메시지 ── */}
      {moveBedAlert && (
        <div className="move-alert">
          {moveBedAlert.split('\n').map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}
          <button
            type="button"
            className="move-alert__close"
            onClick={() => setMoveBedAlert('')}
          >
            확인
          </button>
        </div>
      )}

      {activeTab === 'history' ? (
        <HistoryView history={activeHistory} />
      ) : activeTab === 'patient' ? (
        <PatientView
          history={activeHistory}
          patientNotes={patientNotes}
          sessionNotes={sessionNotes}
          initialChartNumber={patientViewSeed}
          onInitialChartConsumed={() => setPatientViewSeed(null)}
        />
      ) : activeTab === 'stats' ? (
        <StatsView history={activeHistory} />
      ) : activeTab === 'datamanage' ? (
        <DataManageView
          allHistory={history}
          onUpdateHistory={setHistory}
          sessionNotes={sessionNotes}
          onUpdateSessionNotes={setSessionNotes}
          patientNotes={patientNotes}
          onUpdatePatientNotes={setPatientNotes}
        />
      ) : (
        <>
          <div className="bed-summary">
            <div className="bed-summary__card">
              <span className="bed-summary__label">진행중</span>
              <span className="bed-summary__value bed-summary__value--occupied">
                {bedSummaryCounts.occupied}
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">곧 완료</span>
              <span className="bed-summary__value bed-summary__value--warning">
                {bedSummaryCounts.warning}
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">완료 · 정리</span>
              <span className="bed-summary__value bed-summary__value--completed">
                {bedSummaryCounts.completed}
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">빈 베드</span>
              <span className="bed-summary__value bed-summary__value--vacant">
                {bedSummaryCounts.vacant}
              </span>
            </div>
          </div>

          {roomGroups ? (
            roomGroups.map(({ room, roomBeds }) => {
              const isCollapsed = collapsedRooms.has(room.id)
              const occupiedCount = roomBeds.filter((b) => b.status !== 'vacant').length
              const firstNumber = roomBeds[0]?.number
              const lastNumber = roomBeds[roomBeds.length - 1]?.number

              return (
                <section key={room.id} className="room-section">
                  <button
                    type="button"
                    className="room-section__header"
                    onClick={() => toggleRoomCollapse(room.id)}
                    aria-expanded={!isCollapsed}
                  >
                    <span
                      className={`room-section__chevron${isCollapsed ? ' room-section__chevron--collapsed' : ''}`}
                    >
                      ⌄
                    </span>
                    <span className="room-section__name">{room.label}</span>
                    <span className="room-section__meta">
                      {firstNumber}–{lastNumber}번 · {occupiedCount} 사용중
                    </span>
                  </button>
                  {!isCollapsed && (
                    <main className="bed-grid">
                      {roomBeds.map((bed) => renderBedCard(bed))}
                    </main>
                  )}
                </section>
              )
            })
          ) : (
            <main className="bed-grid">
              {filteredBeds.map((bed) => renderBedCard(bed))}
            </main>
          )}
        </>
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
              <div className="modal__header-title">
                <h2>베드 {selectedBed.number}</h2>
                {isInProgress && (
                  <span className={`modal-chip modal-chip--${currentBedChipCategory}`}>
                    {currentBedChipLabel}
                  </span>
                )}
              </div>
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
                <div className="bed-detail-summary">
                  <div className="bed-detail-summary__patient">
                    <span className="bed-detail-summary__name">{currentBed.patientName}</span>
                    <span className="bed-detail-summary__chart">차트 {currentBed.chartNumber}</span>
                    {isInProgress && (
                      <button
                        type="button"
                        className="btn-edit-patient"
                        onClick={openEditPatientModal}
                      >
                        정보 수정
                      </button>
                    )}
                  </div>
                  <div className="bed-detail-summary__meta">
                    <span className="bed-detail-summary__meta-text">
                      {TABS.find((tab) => tab.id === currentBed.room)?.label} · 시작{' '}
                      {formatHour24(currentBed.startTime)} · 진행{' '}
                      {getBedProgress(currentBed, now).progress}%
                    </span>
                    {isInProgress && (
                      <button
                        type="button"
                        className="btn-move-bed"
                        onClick={handleStartMoveBed}
                      >
                        베드이동
                      </button>
                    )}
                  </div>
                </div>

                {currentBedActiveNotes.length > 0 && (
                  <div className="bed-detail-notes">
                    <h3 className="bed-detail-notes__title">환자 주의사항</h3>
                    <ul className="briefing__note-list">
                      {currentBedActiveNotes.map((n) => (
                        <li key={n.id} className="briefing__note">
                          <div className="briefing__note-head">
                            <span className={`badge badge--${n.category}`}>
                              {NOTE_CATEGORY_OPTIONS.find((o) => o.code === n.category)?.label}
                            </span>
                            <span className="briefing__note-content">{n.content}</span>
                          </div>
                          <p className="briefing__note-source">
                            근거: {NOTE_SOURCE_OPTIONS.find((o) => o.code === n.source)?.label}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isInProgress && (
                  <DurationControls
                    minutes={currentBed.durationMinutes}
                    onAdjust={adjustBedDuration}
                    remainingMs={
                      currentBed.startTime && currentBed.durationMinutes
                        ? currentBed.startTime + currentBed.durationMinutes * 60000 - now
                        : undefined
                    }
                  />
                )}

                {isInProgress && (
                  <div className="bed-detail-actions">
                    <button
                      type="button"
                      className="btn-round-entry"
                      onClick={() => openRoundModal()}
                    >
                      라운딩
                    </button>
                    <button
                      type="button"
                      className="btn-register"
                      onClick={() => openNoteModal('session')}
                    >
                      특이사항 기록
                    </button>
                  </div>
                )}

                {isInProgress && (
                  <button
                    type="button"
                    className="btn-remove-patient-link"
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

      {noteModalOpen && currentBed && (
        <div className="modal-overlay modal-overlay--top" onClick={closeNoteModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>특이사항 기록</h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeNoteModal}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="note-segment">
              <button
                type="button"
                className={`note-segment__btn${noteTab === 'session' ? ' note-segment__btn--active' : ''}`}
                onClick={() => setNoteTab('session')}
              >
                금일 특이사항
              </button>
              <button
                type="button"
                className={`note-segment__btn${noteTab === 'patient' ? ' note-segment__btn--active' : ''}`}
                onClick={() => setNoteTab('patient')}
              >
                환자 주의사항
              </button>
            </div>

            {noteTab === 'session' ? (
              <div className="modal__body">
                <OccurredAtPicker valueMs={noteOccurredAt} onChange={setNoteOccurredAt} />
                <p className="note-elapsed">
                  시작 후{' '}
                  {currentBed.startTime
                    ? Math.max(0, Math.round((noteOccurredAt - currentBed.startTime) / 60000))
                    : 0}
                  분
                </p>

                <div className="field">
                  <span className="field__label">증상</span>
                  <div className="chip-group">
                    {SYMPTOM_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip chip--symptom${noteSymptoms.includes(opt.code) ? ' chip--active' : ''}`}
                        onClick={() => setNoteSymptoms((prev) => toggleChip(prev, opt.code))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span className="field__label">조치</span>
                  <div className="chip-group">
                    {ACTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip chip--action${noteActions.includes(opt.code) ? ' chip--active' : ''}`}
                        onClick={() => setNoteActions((prev) => toggleChip(prev, opt.code))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span className="field__label">심각도 (선택)</span>
                  <div className="chip-group">
                    {SEVERITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip${noteSeverity === opt.code ? ' chip--active' : ''}`}
                        onClick={() =>
                          setNoteSeverity((prev) => (prev === opt.code ? null : opt.code))
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="field">
                  <span className="field__label">메모 (선택)</span>
                  <input
                    type="text"
                    className="field__input"
                    value={noteMemo}
                    onChange={(e) => setNoteMemo(e.target.value)}
                    placeholder="자유서술 한 줄"
                  />
                </label>

                <button
                  type="button"
                  className="btn-register"
                  onClick={handleSaveSessionNote}
                  disabled={noteSymptoms.length === 0 && noteActions.length === 0 && !noteMemo.trim()}
                >
                  저장
                </button>
              </div>
            ) : (
              <div className="modal__body">
                <div className="field">
                  <span className="field__label">분류</span>
                  <div className="chip-group">
                    {NOTE_CATEGORY_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip chip--category-${opt.code}${noteCategory === opt.code ? ' chip--active' : ''}`}
                        onClick={() => setNoteCategory(opt.code)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="field">
                  <span className="field__label">내용</span>
                  <input
                    type="text"
                    className="field__input"
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="예: 특정 항생제 부작용 이력"
                  />
                </label>

                <div className="field">
                  <span className="field__label">출처</span>
                  <div className="chip-group">
                    {NOTE_SOURCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip${noteSource === opt.code ? ' chip--active' : ''}`}
                        onClick={() => setNoteSource(opt.code)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-register"
                  onClick={handleSavePatientNote}
                  disabled={!noteContent.trim()}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {roundModalOpen && currentBed && (
        <div className="modal-overlay modal-overlay--top" onClick={closeRoundModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="round-header">
                <h2>라운딩</h2>
                <p className="round-header__sub">
                  {currentBed.number}번 · {currentBed.patientName}
                  {currentBed.startTime
                    ? ` · 시작 후 ${Math.max(0, Math.round((now - currentBed.startTime) / 60000))}분`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="modal__close"
                onClick={closeRoundModal}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="modal__body">
              <div className="round-history">
                <h3 className="round-history__title">지난 라운딩 이력</h3>
                {(() => {
                  const list = getRoundsByChartNumber(rounds, currentBed.chartNumber)
                  if (list.length === 0) {
                    return <p className="round-history__empty">아직 라운딩 기록이 없습니다</p>
                  }
                  return (
                    <ul className="round-history__list">
                      {list.map((r) => {
                        const stateLabel = ROUND_STATE_OPTIONS.find((o) => o.code === r.state)?.label
                        const tone = getRoundTempTone(r.temperature)
                        const isEmpty = !r.state && r.temperature == null && !r.memo
                        return (
                          <li key={r.id} className="round-history__item">
                            <span className="round-history__time">{formatHour24(r.occurredAt)}</span>
                            <span className="round-history__detail">
                              {isEmpty ? (
                                '확인함'
                              ) : (
                                <>
                                  {stateLabel && <span>{stateLabel}</span>}
                                  {stateLabel && <span className="round-history__sep"> · </span>}
                                  {r.temperature != null ? (
                                    <span className={`round-temp${tone ? ` round-temp--${tone}` : ''}`}>
                                      {r.temperature}°C{tone ? ' ↑' : ''}
                                    </span>
                                  ) : (
                                    <span className="round-temp round-temp--none">체온 ---</span>
                                  )}
                                  {r.memo && <span className="round-history__sep"> · </span>}
                                  {r.memo && <span>{r.memo}</span>}
                                </>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )
                })()}
              </div>

              <div className="round-input">
                <h3 className="round-input__title">새 라운딩 기록</h3>

                <OccurredAtPicker valueMs={roundOccurredAt} onChange={setRoundOccurredAt} />

                <label className="field">
                  <span className="field__label">체온 (선택 · 안 재면 비움 ---)</span>
                  <div className="round-temp-input">
                    <span className="round-temp-input__icon" aria-hidden="true">🌡</span>
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      className="round-temp-input__field"
                      value={roundTemp}
                      onChange={(e) => setRoundTemp(e.target.value)}
                      placeholder="--.-"
                    />
                    <span className="round-temp-input__unit">°C</span>
                  </div>
                  {(() => {
                    const n = parseTemperature(roundTemp)
                    if (n != null && (n < 30 || n > 45)) {
                      return <span className="round-temp-input__warn">체온 범위를 확인하세요</span>
                    }
                    return null
                  })()}
                </label>

                <div className="field">
                  <span className="field__label">환자 상태 (선택)</span>
                  <div className="chip-group">
                    {ROUND_STATE_OPTIONS.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        className={`chip${roundState === opt.code ? ' chip--active' : ''}`}
                        onClick={() =>
                          setRoundState((prev) => (prev === opt.code ? null : opt.code))
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="field">
                  <span className="field__label">메모 (선택)</span>
                  <input
                    type="text"
                    className="field__input"
                    value={roundMemo}
                    onChange={(e) => setRoundMemo(e.target.value)}
                    placeholder="특이사항 있으면 한 줄로"
                  />
                </label>

                <div className="round-actions">
                  <button type="button" className="btn-round-cancel" onClick={closeRoundModal}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-register btn-round-complete"
                    onClick={handleSaveRound}
                  >
                    ✓ 라운딩 완료
                  </button>
                </div>
                <p className="round-actions__hint">
                  <strong>취소</strong>는 기록 없이 닫기(타이머 유지) · <strong>완료</strong>는 확인 기록 + 타이머 리셋
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {briefingOpen && currentBed && (() => {
        const chartNumber = currentBed.chartNumber
        const activeNotes = getActivePatientNotes(patientNotes, chartNumber)
        const recentSessionNotes = getRecentSessionNotes(sessionNotes, chartNumber, 5)
        const { count: pastVisitCount, lastVisitDate } = getPatientVisitInfo(
          activeHistory,
          chartNumber,
        )
        const isFirstVisit =
          pastVisitCount === 0 && activeNotes.length === 0 && recentSessionNotes.length === 0

        return (
          <div className="modal-overlay modal-overlay--top" onClick={handleBriefingDismiss}>
            <div className="modal modal--briefing" onClick={(e) => e.stopPropagation()}>
              <div className="modal__header">
                <div className="briefing__identity">
                  <h2>{currentBed.patientName}</h2>
                  <p className="briefing__sub">
                    {chartNumber}
                    {!isFirstVisit && ` · ${pastVisitCount + 1}번째 방문`}
                    {!isFirstVisit && lastVisitDate && ` · 최근 방문 ${lastVisitDate}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="modal__close"
                  onClick={handleBriefingDismiss}
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>

              {isFirstVisit ? (
                <div className="modal__body briefing__empty">
                  <p className="briefing__empty-message">
                    첫 방문입니다.
                    <br />
                    특이사항이 있으면 지금 등록하세요.
                  </p>
                  <button
                    type="button"
                    className="btn-add-note"
                    onClick={handleAddNoteFromBriefing}
                  >
                    주의사항 등록
                  </button>
                </div>
              ) : (
                <div className="modal__body">
                  {activeNotes.length > 0 && (
                    <div className="briefing__section">
                      <h3 className="briefing__section-title">환자 주의사항</h3>
                      <ul className="briefing__note-list">
                        {activeNotes.map((n) => (
                          <li key={n.id} className="briefing__note">
                            <div className="briefing__note-head">
                              <span className={`badge badge--${n.category}`}>
                                {NOTE_CATEGORY_OPTIONS.find((o) => o.code === n.category)?.label}
                              </span>
                              <span className="briefing__note-content">{n.content}</span>
                            </div>
                            <p className="briefing__note-source">
                              근거:{' '}
                              {NOTE_SOURCE_OPTIONS.find((o) => o.code === n.source)?.label}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {recentSessionNotes.length > 0 && (
                    <div className="briefing__section">
                      <h3 className="briefing__section-title">최근 이용 이력</h3>
                      <ul className="briefing__history-list">
                        {recentSessionNotes.map((n) => (
                          <li key={n.id}>{formatSessionNoteLine(n)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="briefing__actions">
                    <div className="briefing__actions-left">
                      <button
                        type="button"
                        className="btn-briefing-secondary"
                        onClick={handleAddNoteFromBriefing}
                      >
                        주의사항 추가
                      </button>
                      <button
                        type="button"
                        className="btn-briefing-secondary"
                        onClick={handleGoFullHistory}
                      >
                        전체 기록
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn-register briefing__confirm"
                      onClick={handleBriefingDismiss}
                    >
                      확인하고 수액 시작
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default App
