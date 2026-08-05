import { useEffect, useRef, useState } from 'react'
import './App.css'
import ChatPanel from './ChatPanel'
import logoIcon from './assets/logo-icon-white.png'
import logoIconColor from './assets/logo-icon.png'
import headerPortrait from './assets/header-portrait-cutout.png'
import {
  login, logout, getCurrentAccount,
  getBoard, readBoardCache,
  loadHistory, toggleHistoryDeleted, restoreSession,
  loadSessionNotes, createSessionNote, toggleSessionNoteDeleted,
  loadRounds, createRound, editRound, toggleRoundDeleted,
  loadVitals, createVitals, editVitals,
  getPatientSessionNotes,
  editSessionNote,
  getStaffList, lookupPatient, logPatientDetailView,
  assignBed, editSessionSpecialNote, editSessionExamRoom, startSession,
  getOrderItems, getPrescription, savePrescription, getOrderBundles,
  listOrderItemsAdmin, createOrderItem, updateOrderItem, deleteOrderItem,
  listOrderBundlesAdmin, createOrderBundle, updateOrderBundle, deleteOrderBundle, cancelSession, moveBedSession, adjustSessionDuration, endSession,
  updateSessionStartedAt,
  updateSessionPatient,
  acquireBedLock, releaseBedLock,
  listAccounts, createAccount, updateAccount,
  listStaffAdmin, createStaffMember, updateStaffMember, getStaffSignature, setStaffSignature,
  getSessionRecord, saveDayMemo, purgeSessions,
  listChatDates, listChatByDate, setChatDeleted,
  listSettings, updateSetting,
  MESSAGE_TTL_MS, getInbox, sendMessage, markMessageRead, getRecipients, getAdminMessages,
  deleteAdminMessage, deleteAdminBroadcast,
} from './api'

// 요약 숫자 카운트업 (이전값 → 새값으로 부드럽게). 모션 최소화 설정이면 즉시 표시.
function CountUp({ value, ms = 500 }) {
  const [n, setN] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const from = prev.current
    prev.current = value
    if (reduce || from === value) { setN(value); return }
    let raf, start
    const tick = (t) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{n}</>
}

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

// ─── 관리자 설정 화면 — 계정 role / 설정값 메타 ──────────────────────
const ACCOUNT_ROLE_OPTIONS = [
  { value: 'admin', label: '관리자' },
  { value: 'staff', label: '직원' },
]

// 라운딩 간격(1회차 15분 / 이후 30분)과 '곧' 리드타임은 화면에서 빼뒀다.
// settings 테이블에 행은 남아 있지만 코드가 상수를 쓰기 때문에 바꿔도 아무 일이 없다 —
// 값 자체가 원장님 지시로 고정이라, 안 먹는 입력칸을 두면 "바꿨는데 왜 그대로냐"가 된다.
// 다시 조정 가능하게 하려면 여기 줄을 되살리고 getRoundStatus가 상수 대신 이 값을 읽게 해야 한다.
const SETTINGS_META = [
  { key: 'fever_mild_min', label: '미열 기준', unit: '℃', step: 0.1 },
  { key: 'fever_high_min', label: '고열 기준', unit: '℃', step: 0.1 },
  { key: 'default_duration_min', label: '기본 소요시간', unit: '분', step: 1 },
  { key: 'min_duration_min', label: '최소 소요시간', unit: '분', step: 1 },
  { key: 'assign_timeout_min', label: '미도착 경고 시간', unit: '분', step: 1 },
]

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



// ─── 라운딩(정기 순회 체크) 설정 상수 ──────────────────────────────
// 상태 칩(양호/수면 중/…)은 제거됐다 — 라운딩은 시각 + 메모만.
// round_states 테이블·rounds.state 컬럼은 방치(마이그레이션 없음).
const ROUND_INTERVAL_MIN = 30 // 2회차 이후 라운딩 간격(분)
// 1회차만 짧다 — 투여 시작 직후가 이상반응이 나오는 구간이라 15분 뒤에 한 번 본다.
// 그 라운딩을 기록한 뒤부터는 30분 간격이다. 원장님 지시로 고정값이다(설정 아님).
const ROUND_FIRST_INTERVAL_MIN = 15
const ROUND_SOON_LEAD_MIN = 10 // "곧 라운딩" 힌트를 띄우는 리드타임(분)

const FEVER_MILD_MIN = 37.5 // 이상: 미열(주황)
const FEVER_HIGH_MIN = 38.0 // 이상: 고열(빨강). 37.5 미만은 카드에 체온 표시 안 함

// 진료실 — 연속이 아니다(4·5진료실은 없음). 서버(sessions.js EXAM_ROOMS)와 같은 목록.
// 관리자 편집은 아직 필요 없어 상수로 둔다.
const EXAM_ROOMS = ['1', '2', '3', '6', '7']

// 처방 작성 체크리스트의 그룹 표시 순서. 항목 자체는 DB(order_items)가 원본이고
// 여기 있는 건 '그룹을 어떤 순서로 보여줄지'뿐이다(그룹 편집은 범위 밖).
// DB에 이 목록에 없는 group_key가 생기면 뒤에 붙여서 렌더한다 — 조용히 사라지면 안 되므로.
// 투여경로는 n/s보다 먼저 고르는 값이라 맨 앞이다.
const ROUTE_GROUP = '투여경로'
const GROUP_ORDER = [ROUTE_GROUP, '기본', '치료제', 'IM,SC', '독감', '증류수']

// 경로 박스는 order_items 행이지만 '처방 항목'이 아니라 경로를 고르는 체크박스다.
// route 컬럼은 NULL이어야 한다 — 값이 있으면 자기 자신을 OR 해버린다.
const ROUTE_ITEM_CODE = { IV: 'route_iv', IM: 'route_im', SC: 'route_sc' }
const ROUTE_CODES = Object.values(ROUTE_ITEM_CODE)

// 처방 체크 상태의 키. NS를 180·110 두 백 담는 처방이 있어 code 단독으로는 못 쓴다.
// 자유입력(증류수 mL)은 타이핑마다 키가 바뀌면 커서가 튀므로 dose를 키에서 뺀다.
// 수량은 소수 첫째 자리까지 허용한다 — 반 앰플(0.5), 0.1 단위 분할이 실제로 있다.
// 반올림을 Math.round(n / 0.1) * 0.1로 하면 0.3이 0.30000000000000004가 되어
// 기록지에 그대로 인쇄된다 → 10을 곱해 정수로 반올림한 뒤 다시 나눈다.
// 숫자·소수점만 남긴다. 소수점이 두 번 들어가면 NaN → 1로 떨어진다.
// 상한을 두는 이유: 오타로 들어간 큰 수가 기록지에 그대로 인쇄된다.
const QTY_MAX = 99
const QTY_MIN = 0.1
function normalizeQty(value) {
  const cleaned = String(value).replace(/[^\d.]/g, '')
  if (cleaned === '') return 1 // 칸을 비우면 기본값으로 돌린다
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.round(n * 10) / 10))
}
function checkKey(code, dose) {
  return `${code}|${dose ?? ''}`
}

// 체크된 항목들의 route를 OR 해서 켤 경로 박스를 정한다.
// route가 NULL인 항목(ORD — 용법에 따라 IV/IM이 갈린다)은 기여하지 않는다.
// 그래서 근무자가 직접 켤 수 있어야 하고, 그게 routeOverride다.
function autoRouteCodes(checks, items) {
  const routeByCode = new Map(items.map((item) => [item.code, item.route]))
  const on = new Set()
  Object.values(checks).forEach((row) => {
    const code = ROUTE_ITEM_CODE[routeByCode.get(row.code)]
    if (code) on.add(code)
  })
  return on
}

// 라운딩 이력 조회: 해당 환자의 !deleted 라운딩을 occurredAt 내림차순(최신이 위)
// SF Symbols 풍 단색 라인 아이콘 (currentColor, 1em) — 이모지 대체
function Icon({ name, className }) {
  const shapes = {
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 1.8" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
        <path d="M10.2 20a2 2 0 0 0 3.6 0" />
      </>
    ),
    alert: (
      <>
        <path d="M10.3 4.4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9.5v4" />
        <path d="M12 17.2h.01" />
      </>
    ),
    droplet: <path d="M12 3.2c3 3.9 6 6.6 6 10.1a6 6 0 0 1-12 0c0-3.5 3-6.2 6-10.1Z" />,
    chat: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-3.8-.8L3 21l1.9-5.4A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z" />
      </>
    ),
    send: (
      <>
        <path d="M21 3 10.5 13.5" />
        <path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />
      </>
    ),
    close: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
    trash: (
      <>
        <path d="M3.5 6.5h17" />
        <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
        <path d="M5.8 6.5 6.8 19a1.8 1.8 0 0 0 1.8 1.6h6.8a1.8 1.8 0 0 0 1.8-1.6l1-12.5" />
        <path d="M10.3 10.3v6.4" />
        <path d="M13.7 10.3v6.4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.6" />
        <path d="M3.5 9.8h17" />
        <path d="M8.2 3.5v3" />
        <path d="M15.8 3.5v3" />
      </>
    ),
    thermometer: (
      <>
        <path d="M13.8 13.6V5.2a1.8 1.8 0 1 0-3.6 0v8.4a4 4 0 1 0 3.6 0Z" />
        <path d="M12 16.4v1.4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </>
    ),
    moon: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.6 8.6 0 1 0 10.2 10.2Z" />,
    'arrow-left': (
      <>
        <path d="M19 12H5" />
        <path d="M11 6 5 12l6 6" />
      </>
    ),
    'arrow-up': (
      <>
        <path d="M12 19V5" />
        <path d="M6 11l6-6 6 6" />
      </>
    ),
  }
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name] ?? null}
    </svg>
  )
}

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
// 간격은 1회차만 15분이고 그 뒤로는 30분이다 — 라운딩 기록이 하나도 없으면 1회차다.
// 경과 < 간격−리드 → ok(남은 시간), 리드 구간 → soon(남은 시간), 간격 이상 → due(anchor 이후 경과).
// due의 분값은 "예정 시각을 얼마나 넘겼나"가 아니라 anchor 이후 실제 경과다 —
// 30분 규칙에서 "9분 경과"라고 뜨면 마지막으로 본 게 언제인지 알 수 없어 헷갈렸다.
// A-3의 soon은 순수 로컬 타이머 기준(같은 수액실 묶음 필터는 A-4에서).
function getRoundStatus(bed, latestRound, now) {
  const anchor = latestRound ? new Date(latestRound.occurredAt).getTime() : bed.startTime
  if (!anchor) return null
  const interval = latestRound ? ROUND_INTERVAL_MIN : ROUND_FIRST_INTERVAL_MIN
  // 리드타임 10분은 30분 간격에 맞춰 정한 값이다. 15분에 그대로 쓰면 창의 2/3가 'soon'이라
  // 힌트가 의미를 잃는다 → 간격의 1/3을 넘지 않게 묶는다(30분은 10분 그대로, 15분은 5분).
  const lead = Math.min(ROUND_SOON_LEAD_MIN, Math.floor(interval / 3))
  const elapsedMin = Math.max(0, Math.floor((now - anchor) / 60000))
  const soonAt = interval - lead
  if (elapsedMin < soonAt) {
    return { status: 'ok', minutes: interval - elapsedMin }
  }
  if (elapsedMin < interval) {
    return { status: 'soon', minutes: interval - elapsedMin }
  }
  return { status: 'due', minutes: elapsedMin }
}

// 카드 우상단 바이탈 — 서버가 준 '필드별 최신'을 표시 문자열로. 잰 항목만 채운다.
// 체온은 열이면(mild/high) 색조를 얹고, 정상이면 색 없이 값만 보여준다(전과 달리 항상 표시).
function getCardVitals(bed) {
  const temp = bed.latestTemp?.value
  const bp = bed.latestBp
  const pulseOnly = bed.latestPulse?.value
  let bpText = null
  if (bp?.systolic != null && bp?.diastolic != null) {
    bpText = `${bp.systolic}/${bp.diastolic}${bp.pulse != null ? `(${bp.pulse})` : ''}`
  } else if (pulseOnly != null) {
    bpText = `맥박 ${pulseOnly}`
  }
  return {
    temp: temp != null ? `${temp}℃` : null,
    tone: temp != null ? getRoundTempTone(temp) : null,
    bp: bpText,
  }
}

// 몰아보기 힌트(A-4): 그 방(진행중·미완료 베드만) 안에 라운딩 밀림(due)이 하나라도 있는지.
// soon 힌트를 보여줄지 게이팅하는 데만 쓰임 — ok/due 판정 자체는 바꾸지 않음.
function getRoomHasDue(roomBeds, rounds, now) {
  return roomBeds.some((bed) => {
    if (bed.status !== 'in-progress') return false
    if (getBedProgress(bed, now).isCompleted) return false
    const latestRound = getLatestSessionRound(rounds, bed.sessionId)
    return getRoundStatus(bed, latestRound, now)?.status === 'due'
  })
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

// ─── 헤더 초상화 한마디 ────────────────────────────────────────────
// 사진을 누르면 아래에 말풍선으로 한 줄 뜬다. 기능이 아니라 분위기용.
const BOSS_LINES = [
  '세척실로 따라와.',
  '좀 씻고 다녀라.',
  '나만 믿어!',
  '나는 너 믿어.',
  '화이팅.',
  '이뻐.',
  '까불지 마.',
  '이럴 시간에 가서 주사기라도 뜯어.',
  '일 안해?',
  '나 보고싶어?',
  '그만 만져.',
  '힘내. 할 수 있어.',
  '그만 찔러.',
  '너 누구야.',
  '팍 씨.',
  '빨리 안 하고 뭐해.',
  '집중해.',
  '잘 하고 있어.',
  '진짜야.',
  '물 마시면서 일해.',
  '잘한다 잘해.',
  '퇴근하고 싶다.',
  '손 느린거 봐라.',
  '괜찮아.',
  '걱정 마.',
  '적당히 해.',
  'ㅋㅋㅋㅋㅋ',
  '?',
  '맞을래?',
  '밥은 먹었어?',
  '다치지 마.',
  '무리하지 마.',
  '쉬엄쉬엄.',
  '센 척은.',
  '귀엽네.',
  '누가 그래.',
  '그건 아니지.',
  '어? 뒤에 누구야?',
  '웃지마',
  '너 G야?',
  '^^',
  '똑바로 해라?',
  '잘하자?',
  '뭐 어쩌라고.',
  '수액이요',
  '너 오늘 끝나고 남아.',
  '회식할까?',
  '귀찮게 하지 마.',
  '그만해.',
  '한가하니?',
  '...',
  '??????',
  '액팅 화이팅!',
  '벗동산으로 가자.',
  '이맛이 땡기네.',
  '오점무?',
  '어쩌라고.',
  '끝나고 구름산으로 집합.',
  '주말에 등산 갈래?',
  '인라인 타러 갈래?',
  '농땡이 피우지 마.',
  '벨 울린다.',
  '이럴 시간에 라운딩이나 한번 돌고 와.',
  '삐졌어?',
  '아프면 말해.',
  '어허.',
  '손 조심해.',
]

const BOSS_LINE_MS = 2800

// 직전에 나온 줄은 빼고 뽑는다 — 연속으로 같은 말이 나오면 고장 난 것처럼 보인다.
function pickBossLine(previous) {
  const pool = BOSS_LINES.length > 1 ? BOSS_LINES.filter((l) => l !== previous) : BOSS_LINES
  return pool[Math.floor(Math.random() * pool.length)]
}

// ─── 모달 닫힘 모션 ────────────────────────────────────────────────
// React는 조건이 falsy가 되는 즉시 언마운트해서 "닫히는 모습"이 안 보인다.
// 값이 사라져도 MODAL_EXIT_MS 동안 마지막 값을 붙잡아 두고, 그동안 --closing 클래스로
// 나가는 애니메이션을 태운다.
//
// 닫기 경로가 모달마다 여러 개다(× 버튼 / 취소 / 확인 / 액션 성공 후 자동 닫힘).
// 핸들러마다 지연을 넣으면 하나씩 빠뜨리기 쉬워서, 모든 경로가 반드시 지나가는
// "값이 falsy가 되는 지점"에서 한 번만 처리한다.
const MODAL_EXIT_MS = 200
const LOCK_IDLE_MS = 3 * 60 * 1000 // 등록창 무입력 방치 3분이면 잠금 자동 해제

function useModalExit(value) {
  const [held, setHeld] = useState(value)

  // 열 때는 렌더 중에 바로 반영한다 — 이펙트를 거치면 한 프레임 늦어 깜빡인다.
  // (React가 권장하는 "렌더 중 state 조정" 패턴. 조건이 있어 무한 루프가 아니다.)
  if (value && value !== held) setHeld(value)

  useEffect(() => {
    if (value || !held) return
    const timer = setTimeout(() => setHeld(null), MODAL_EXIT_MS)
    return () => clearTimeout(timer)
  }, [value, held])

  // [닫히는 동안에도 유지되는 값, 지금 닫히는 중인지]
  return [held, !value && !!held]
}

// 오프라인 배너의 "언제 기준 정보인지" 문구. lastSyncAt이 없으면(캐시도 없는 첫 접속) 시각은 생략.
function formatStaleness(lastSyncAt, nowMs) {
  if (!lastSyncAt) return null
  const minutes = Math.floor(Math.max(0, nowMs - lastSyncAt) / 60000)
  if (minutes < 1) return '방금 전 정보'
  if (minutes < 60) return `${minutes}분 전 정보`
  const hours = Math.floor(minutes / 60)
  return `${hours}시간 ${minutes % 60}분 전 정보`
}

// 공용 발생시각 선택 컴포넌트: 기본값 지금, 당김 버튼(-5/-15/-30분), 시:분 직접입력.
// 증상 기록 폼과 라운딩 모달(A-2) 양쪽에서 재사용한다.
function OccurredAtPicker({ valueMs, onChange, nowMs }) {
  const d = new Date(valueMs)
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

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
        <button type="button" className="occurred-at__now" onClick={() => onChange(nowMs)}>
          지금
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
  if (bed.status === 'reserved') return 'reserved'
  const { isCompleted, isWarning } = getBedProgress(bed, now)
  if (bed.status === 'completed' || isCompleted) return 'completed'
  if (isWarning) return 'warning'
  return 'occupied'
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

// occurredAt이 없는 기존(레거시) session_note는 createdAt으로 대체
function getNoteOccurredAt(note) {
  return note.occurredAt ?? note.createdAt
}

// 처방 작성 여부 — 카드에서 한눈에 구분한다.
// 작성됨은 이름 바로 옆 체크, 미작성은 이름 아래 빨간 줄(PrescriptionTodo)로 갈랐다.
// 한 줄에 같이 두면 '처방 미작성' 글씨가 이름을 눌러 이름이 잘렸다.
// 두 상태를 다 표시하는 이유: 한쪽만 표시하면 '표식 없음'이 미작성인지 데이터 없음인지
// 구분이 안 돼 놓치게 된다. 색만으로 전달하지 않으려고 아이콘·글씨를 함께 쓴다.
function PrescriptionCheck({ done }) {
  if (!done) return null
  return (
    <span className="bed-card__rx-done" title="처방 작성됨" aria-label="처방 작성됨">
      <Icon name="check" />
    </span>
  )
}

function PrescriptionTodo({ done }) {
  if (done) return null
  return <p className="bed-card__rx-todo">처방 미작성</p>
}

// 베드 카드용 요약 다줄: 이 방문의 특이사항 → 당일 메모 → 금일 증상(session_note) 순,
// 최대 4줄까지, 초과분은 마지막 줄을 "+N건 더"로
//
// 특이사항(danger)과 당일 메모(caution)를 색으로 갈라 놓는다 — 전자는 이번 방문의
// 주의점이고 후자는 그 환자에게 계속 따라다니는 메모라 성격이 다르다.
function getCardNoteLines(sessionNotes, bed) {
  const todayNotes = getSessionNotesBySessionId(sessionNotes, bed.sessionId).sort(
    (a, b) => new Date(getNoteOccurredAt(b)) - new Date(getNoteOccurredAt(a)),
  )

  const allLines = [
    ...(bed.specialNote ? [{ tone: 'danger', icon: 'alert', text: bed.specialNote }] : []),
    ...(bed.dayMemo ? [{ tone: 'caution', icon: 'bell', text: bed.dayMemo }] : []),
    ...todayNotes.map((n) => ({
      tone: 'neutral',
      icon: 'clock',
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

// 한 줄 마퀴. 부모 폭을 넘기면 좌우로 왕복(앞뒤로 잠깐 멈춰 읽을 틈), 안 넘치면 가만히.
// 카드 안 어떤 한 줄에도 재사용한다(환자명·차트·라운딩·라인담당·특이사항).
// CSS만으론 넘침을 알 수 없어 실제 폭을 잰다. 카드 폭은 뷰포트에만 좌우되므로
// contentKey(내용)나 창 크기가 바뀔 때 다시 잰다. setState는 setTimeout/resize
// 콜백(비동기)에서만 해서 effect 동기 setState 규칙을 피한다.
function Marquee({ children, contentKey, className }) {
  const viewRef = useRef(null)
  const textRef = useRef(null)
  const [marquee, setMarquee] = useState(null) // { shift, dur } | null

  useEffect(() => {
    function measure() {
      const view = viewRef.current
      const text = textRef.current
      if (!view || !text) return
      const over = text.scrollWidth - view.clientWidth
      if (over > 4) {
        const shift = over + 8 // 끝 글자가 가장자리에 딱 붙지 않게 여유
        setMarquee({ shift, dur: Math.max(6, Math.round(shift / 22)) })
      } else {
        setMarquee(null)
      }
    }
    const t = setTimeout(measure, 0) // 레이아웃 확정 후 1회 측정
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', measure)
    }
  }, [contentKey])

  return (
    <span className={`marquee${className ? ` ${className}` : ''}`} ref={viewRef}>
      <span
        ref={textRef}
        className={`marquee__text${marquee ? ' marquee__text--run' : ''}`}
        style={marquee ? { '--marquee-shift': `${marquee.shift}px`, '--marquee-dur': `${marquee.dur}s` } : undefined}
      >
        {children}
      </span>
    </span>
  )
}

function CardNoteLine({ line }) {
  return (
    <p className={`bed-card__caution bed-card__caution--${line.tone}`}>
      <Icon name={line.icon} className="bed-card__caution-icon" />
      <Marquee contentKey={line.text} className="bed-card__caution-marquee">
        {line.text}
      </Marquee>
    </p>
  )
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

// ─── 데이터 추출 (CSV · 인쇄 리포트) ──────────────────────────────
// 서버/DB는 안 건드리고, 이미 불러온 history·rounds·sessionNotes·patientNotes만 조합한다.
function xLabels(codes, options) {
  return (codes || []).map((c) => options.find((o) => o.code === c)?.label || c).filter(Boolean)
}
function xDate(iso) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function xTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}
// 특이사항(session_note) → "혈관통·붓기 / 찜질팩 / 메모"
function xNoteText(n) {
  const body = [...xLabels(n.symptoms, SYMPTOM_OPTIONS), ...xLabels(n.actions, ACTION_OPTIONS)].join('·')
  return [body, n.memo].filter(Boolean).join(' · ') || '기록'
}
// 바이탈 → "37.8℃ · 120/80(79)" — 잰 항목만. 혈압 없이 맥박만이면 "맥박 79".
function xVitalsText(v) {
  const parts = []
  if (v.temperature != null) parts.push(`${v.temperature}℃`)
  if (v.bpSystolic != null && v.bpDiastolic != null) {
    parts.push(`${v.bpSystolic}/${v.bpDiastolic}${v.pulse != null ? `(${v.pulse})` : ''}`)
  } else if (v.pulse != null) {
    parts.push(`맥박 ${v.pulse}`)
  }
  return parts.join(' · ') || '기록'
}
// 라운딩 → 메모만. 체온은 바이탈로 분리, 상태 칩은 제거됐다.
function xRoundText(r) {
  return r.memo || '확인'
}
// 한 세션의 라운딩+특이사항을 시간순 이벤트로 합친다
function xVisitEvents(sessionId, sessionNotes, rounds, vitals = []) {
  const evs = []
  sessionNotes.filter((n) => n.sessionId === sessionId && !n.deleted)
    .forEach((n) => evs.push({ t: getNoteOccurredAt(n), kind: '증상', text: xNoteText(n) }))
  rounds.filter((r) => r.sessionId === sessionId && !r.deleted)
    .forEach((r) => evs.push({ t: r.occurredAt, kind: '라운딩', text: xRoundText(r) }))
  vitals.filter((v) => v.sessionId === sessionId && !v.deleted)
    .forEach((v) => evs.push({ t: v.occurredAt, kind: '바이탈', text: xVitalsText(v) }))
  return evs.sort((a, b) => new Date(a.t) - new Date(b.t))
}
// 위 xVisitEvents와 같은 병합이지만 원본 레코드를 함께 들고 온다 —
// 베드 상세 오른쪽 패널은 항목마다 수정·삭제를 걸어야 해서 id가 필요하다.
// (xVisitEvents는 CSV·인쇄에서 쓰이므로 그대로 둔다.)
function xEditableEvents(sessionId, sessionNotes, rounds, vitals = []) {
  const evs = []
  sessionNotes.filter((n) => n.sessionId === sessionId && !n.deleted)
    .forEach((n) => evs.push({ key: `n${n.id}`, t: getNoteOccurredAt(n), kind: '증상', text: xNoteText(n), note: n }))
  rounds.filter((r) => r.sessionId === sessionId && !r.deleted)
    .forEach((r) => evs.push({ key: `r${r.id}`, t: r.occurredAt, kind: '라운딩', text: xRoundText(r), round: r }))
  vitals.filter((v) => v.sessionId === sessionId && !v.deleted)
    .forEach((v) => evs.push({ key: `v${v.id}`, t: v.occurredAt, kind: '바이탈', text: xVitalsText(v), vital: v }))
  return evs.sort((a, b) => new Date(a.t) - new Date(b.t))
}
function xCsvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function xToCsv(headers, rows) {
  // BOM(엑셀 한글깨짐 방지) — 엑셀에서 한글이 깨지지 않게
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(xCsvCell).join(',')).join('\r\n')
}
function xDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 수액 처방 요약 셀 — '라벨(용량) · 라벨 · …'. 쉼표는 CSV 열을 밀 수 있어 쓰지 않는다.
// 수량은 1도 붙인다 — 숫자가 없으면 '1개'인지 '안 적은 것'인지 구분이 안 된다.
// 투여경로 줄(IV/IM/SC)은 서버가 qty를 null로 보내 안 붙는다(수량 개념이 없다).
// 배포 전 스냅샷·기록에는 qty가 없다(undefined) → 그대로 안 붙는다.
// 용법은 IM·SC만 찍는다. 수액은 IV가 기본이라 줄마다 반복되면(0번 묶음이면 14줄)
// 정작 예외인 IM·SC가 그 사이에 묻힌다. 전체 경로는 처방 목록 끝의 투여경로 줄
// (IV·SC 항목 자체)에 그대로 남으므로 정보가 사라지지는 않는다.
// 서버는 IV도 그대로 보낸다 — 표기 방침만 여기서 정하면 되도록.
const ROUTE_SHOWN = ['IM', 'SC']
function routeLabel(route) {
  return ROUTE_SHOWN.includes(route) ? route : ''
}

// 표기는 기록지와 같게 맞춘다: 라벨(용량) ×수량 용법.
function xOrdersText(orders = []) {
  return orders.map((o) => {
    const dose = o.dose ? `(${o.dose})` : ''
    const route = routeLabel(o.route)
    return `${o.label}${dose}${o.qty ? ` ×${o.qty}` : ''}${route ? ` ${route}` : ''}`
  }).join(' · ')
}

// 날짜별 이용기록 CSV — 한 세션 = 한 행 (다중값은 시각과 함께 요약 셀)
//
// 종료 세션엔 record_snapshot(공식본)이 있지만 CSV는 **DB 현재값**으로 뽑는다.
// CSV는 데이터 아카이브고, 스냅샷은 서명까지 딸린 그 시점의 공식 기록지 전용이다.
//
// 열 순서: 스펙의 권장 순서를 따르되 기존 열들의 상대 순서(증상→라운딩→바이탈)는 그대로 뒀다.
// 권장 순서는 바이탈을 증상 앞에 두는데, 그러면 기존 CSV를 쓰던 엑셀 작업이 밀린다.
function buildHistoryCsv(history, sessionNotes, rounds, vitals = []) {
  const headers = [
    '날짜', '진료실', '수액실', '베드', '환자명', '차트번호',
    '라인담당', '믹스담당', '라인 제거',
    '시작', '종료', '이용시간(분)', '내원당시증상', '특이사항(기저질환)', '당일메모', '수액처방',
    '증상', '라운딩', '바이탈',
  ]
  const rows = history.map((h) => {
    const notes = sessionNotes.filter((n) => n.sessionId === h.sessionId && !n.deleted)
      .sort((a, b) => new Date(getNoteOccurredAt(a)) - new Date(getNoteOccurredAt(b)))
      .map((n) => `${xTime(getNoteOccurredAt(n))} ${xNoteText(n)}`).join(' | ')
    const rds = rounds.filter((r) => r.sessionId === h.sessionId && !r.deleted)
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
      .map((r) => `${xTime(r.occurredAt)} ${xRoundText(r)}`).join(' | ')
    const vts = vitals.filter((v) => v.sessionId === h.sessionId && !v.deleted)
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
      .map((v) => `${xTime(v.occurredAt)} ${xVitalsText(v)}`).join(' | ')
    return [
      h.date, h.examRoom ? `${h.examRoom}진료실` : '', h.room, h.bedNumber,
      h.patientName, h.chartNumber,
      h.lineStaff ?? '', h.mixStaff ?? '', h.endStaff ?? '',
      h.startTime, h.endTime, h.usedMinutes,
      h.visitSymptom ?? '', h.specialNote ?? '', h.dayMemo ?? '', xOrdersText(h.orders),
      notes, rds, vts,
    ]
  })
  return xToCsv(headers, rows)
}

// 환자별 CSV — 한 이벤트 = 한 행 (주의사항 → 이용/라운딩/특이사항 타임라인)
function buildPatientCsv(chartNumber, history, sessionNotes, rounds, vitals = []) {
  const headers = ['날짜', '시각', '구분', '수액실', '베드', '내용', '비고']
  const rows = []
  const sessions = history.filter((h) => h.chartNumber === chartNumber)
    .sort((a, b) => parseDateStr(a.date) - parseDateStr(b.date))
  sessions.forEach((h) => {
    // 이용 행의 비고에 진료실·담당자를 함께 적는다(방문 단위 정보라 이벤트가 아님).
    const head = [
      h.examRoom ? `${h.examRoom}진료실` : null,
      h.lineStaff ? `라인 ${h.lineStaff}` : null,
      h.mixStaff ? `믹스 ${h.mixStaff}` : null,
      h.endStaff ? `라인 제거 ${h.endStaff}` : null,
    ].filter(Boolean).join(' · ')
    rows.push([h.date, h.startTime, '이용', h.room, h.bedNumber,
      `수액 이용 (${formatDuration(h.usedMinutes)})`,
      [`${h.startTime}~${h.endTime}`, head].filter(Boolean).join(' · ')])
    // 방문 단위 정보는 그 방문 행 바로 아래에 붙인다(이벤트 타임라인과 섞이지 않게).
    if (h.visitSymptom) {
      rows.push([h.date, '', '내원당시증상', h.room, h.bedNumber, h.visitSymptom, ''])
    }
    if (h.specialNote) {
      rows.push([h.date, '', '특이사항(기저질환)', h.room, h.bedNumber, h.specialNote, ''])
    }
    // 당일 메모는 방문이 아니라 환자에 붙는 값이라 방문 블록마다 같은 내용이 반복된다.
    if (h.dayMemo) {
      rows.push([h.date, '', '당일메모', h.room, h.bedNumber, h.dayMemo, ''])
    }
    if (h.orders?.length) {
      rows.push([h.date, '', '수액처방', h.room, h.bedNumber, xOrdersText(h.orders), ''])
    }
    xVisitEvents(h.sessionId, sessionNotes, rounds, vitals).forEach((e) => {
      rows.push([h.date, xTime(e.t), e.kind, h.room, h.bedNumber, e.text, ''])
    })
  })
  return xToCsv(headers, rows)
}

// ─── 수액 간호 기록지 (4b) ──────────────────────────────────────────
// 종이 1:1 재현이 아니라 정리된 디지털판. 새 창에 자체완결 HTML을 띄우고
// 브라우저 인쇄 대화상자에서 "PDF로 저장"하면 그게 곧 PDF 출력이다
// (서버 PDF 엔진을 들이지 않기 위한 선택 — 기존 이용기록 리포트와 같은 방식).
function openRecordSheet(record) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ))
  const t = (ms) => (ms ? xTime(ms) : '—')
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString('ko-KR') : '—')
  // 방 라벨은 서버가 아니라 여기서 푼다 — 상수 사본을 서버에 또 두지 않으려고.
  const roomLabel = TABS.find((tab) => tab.id === record.room)?.label ?? record.room

  const row = (label, value) => (
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : ''
  )

  // 담당자 행 — 다른 필드와 같은 라벨+값 인라인이되, 값 자리에 서명 이미지를
  // 이름 글자 크기로 넣는다(하단 서명블록을 대체).
  // 서명이 없으면 이름 텍스트로 폴백하고, 담당자 자체가 없으면(기존 종료분의 라인 제거 담당자,
  // 아직 시작 전인 믹스담당 등) '—'로 둔다 — 행을 숨기면 빈 자리인지 미지정인지 알 수 없다.
  const staffRow = (label, name, signature) => {
    const value = !name
      ? '—'
      : signature
        ? `<img class="sign-inline" src="${esc(signature)}" alt="${esc(name)} 서명">`
        : esc(name)
    return `<tr><th>${esc(label)}</th><td>${value}</td></tr>`
  }

  const ordersHtml = record.orders.length
    ? `<ul class="orders">${record.orders.map((o) =>
      `<li>${esc(o.label)}`
      + (o.dose ? ` <span class="dose">${esc(o.dose)}</span>` : '')
      + (o.qty ? ` <span class="qty">×${esc(o.qty)}</span>` : '')
      + (routeLabel(o.route) ? ` <span class="route">${esc(routeLabel(o.route))}</span>` : '')
      + '</li>').join('')}</ul>`
    : '<p class="none">체크된 처방 없음</p>'

  const vitalsHtml = record.vitals.length
    ? `<table class="grid"><thead><tr><th>시각</th><th>체온</th><th>혈압</th><th>맥박</th></tr></thead><tbody>${
      record.vitals.map((v) => `<tr>
        <td>${esc(t(v.occurred_at))}</td>
        <td>${v.temperature != null ? esc(v.temperature) + '℃' : '—'}</td>
        <td>${v.bp_systolic != null ? `${esc(v.bp_systolic)}/${esc(v.bp_diastolic)}` : '—'}</td>
        <td>${v.pulse != null ? esc(v.pulse) : '—'}</td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="none">바이탈 기록 없음</p>'

  // 라운딩과 증상 기록을 시각순으로 합쳐 하나의 타임라인으로 낸다.
  const events = [
    ...record.rounds.map((r) => ({ t: r.occurred_at, kind: '라운딩', text: r.memo ?? '' })),
    ...record.notes.map((n) => ({
      t: n.occurred_at,
      kind: '증상',
      text: [[...n.symptoms, ...n.actions].join(' · '), n.memo].filter(Boolean).join(' / '),
    })),
  ].sort((a, b) => a.t - b.t)

  const timelineHtml = events.length
    ? `<ul class="tl">${events.map((e) =>
      `<li><span class="tt">${esc(t(e.t))}</span><span class="kk">${esc(e.kind)}</span><span class="cc">${esc(e.text)}</span></li>`).join('')}</ul>`
    : '<p class="none">라운딩·증상 기록 없음</p>'

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
  <title>수액 간호 기록지 — ${esc(record.patient_name)}(${esc(record.chart_no)})</title>
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box}
    body{font-family:-apple-system,'Pretendard','Apple SD Gothic Neo','Segoe UI',sans-serif;
      color:#111;background:#fff;margin:0 auto;padding:28px;max-width:820px;line-height:1.5}
    header{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:16px;
      display:flex;justify-content:space-between;align-items:flex-end}
    h1{font-size:22px;margin:0;letter-spacing:-0.5px}
    .date{color:#555;font-weight:600}
    h2{font-size:14px;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #ccc;color:#333}
    table.info{width:100%;border-collapse:collapse}
    table.info th{width:96px;text-align:left;font-weight:700;color:#444;padding:4px 8px 4px 0;
      vertical-align:top;font-size:13px}
    table.info td{padding:4px 0;font-size:14px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    table.grid th,table.grid td{border:1px solid #ddd;padding:4px 8px;text-align:left}
    table.grid th{background:#f5f5f5;font-weight:700}
    ul.orders{margin:0;padding-left:18px;font-size:14px;columns:2}
    ul.orders li{margin:2px 0;break-inside:avoid}
    .dose{font-weight:700}
    /* 수량 — 용량과 헷갈리지 않게 굵게. */
    .qty{font-weight:700}
    /* 용법 — 약품명·용량보다 약하게. 인쇄지는 항상 흰 배경이라 #555면 대비 7:1이다. */
    .route{color:#555;font-size:12px}
    p.free{margin:0;font-size:14px;white-space:pre-wrap}
    ul.tl{list-style:none;margin:0;padding:0}
    ul.tl li{display:flex;gap:10px;align-items:baseline;padding:4px 0;font-size:13px;
      border-bottom:1px dotted #e0e0e0}
    .tt{font-variant-numeric:tabular-nums;font-weight:700;min-width:46px}
    .kk{font-size:11px;padding:1px 6px;border:1px solid #bbb;border-radius:8px;flex:none;color:#444}
    .none{color:#999;font-size:13px;margin:0}
    /* 담당자 서명 — 이름 글자가 차지하던 만큼(본문 14px 기준 약 20px)만 쓴다.
       폭이 긴 서명은 max-width로 줄여 표 열이 밀리지 않게 한다. */
    img.sign-inline{height:20px;width:auto;max-width:120px;vertical-align:middle;object-fit:contain}
    .toolbar{position:sticky;top:0;text-align:right;margin-bottom:12px}
    .toolbar button{font:inherit;font-weight:700;padding:8px 16px;border:0;border-radius:8px;
      background:#4c8bf5;color:#fff;cursor:pointer}
    .draft{margin:0 0 12px;padding:6px 10px;background:#fff4d6;border:1px solid #e0c060;
      border-radius:6px;font-size:13px;color:#6b4e00}
    @media print{.toolbar{display:none} body{padding:0} .draft{display:none}}
  </style></head><body>
    <div class="toolbar"><button onclick="window.print()">인쇄 / PDF 저장</button></div>
    ${record.from_snapshot ? '' : '<p class="draft">아직 종료되지 않은 세션입니다 — 확정본이 아닌 현재 시점 미리보기입니다.</p>'}
    <header>
      <h1>수액 간호 기록지</h1>
      <div class="date">${esc(day(record.started_at ?? record.assigned_at))}</div>
    </header>

    <h2>환자 · 배치</h2>
    <table class="info">
      ${row('성명', record.patient_name)}
      ${row('차트번호', record.chart_no)}
      ${row('진료실', record.exam_room ? `${record.exam_room}진료실` : '')}
      ${row('수액실', `${roomLabel} ${record.bed_number}번`)}
      ${staffRow('라인담당', record.line_staff_name, record.line_signature)}
      ${staffRow('믹스담당', record.mix_staff_name, record.mix_signature)}
      ${staffRow('라인 제거', record.end_staff_name, record.end_signature)}
    </table>

    <h2>시간</h2>
    <table class="info">
      ${row('시작', t(record.started_at))}
      ${row('종료', t(record.ended_at))}
      ${row('이용시간', record.used_minutes != null ? formatDuration(record.used_minutes) : '')}
    </table>

    ${record.visit_symptom ? `<h2>내원당시증상</h2><p class="free">${esc(record.visit_symptom)}</p>` : ''}
    ${record.special_note ? `<h2>특이사항(기저질환)</h2><p class="free">${esc(record.special_note)}</p>` : ''}
    ${record.day_memo ? `<h2>당일 메모</h2><p class="free">${esc(record.day_memo)}</p>` : ''}

    <h2>수액 처방</h2>
    ${ordersHtml}

    <h2>바이탈</h2>
    ${vitalsHtml}

    <h2>라운딩 · 증상 기록</h2>
    ${timelineHtml}
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('팝업이 차단되어 기록지를 열 수 없습니다. 팝업 허용 후 다시 시도해주세요.')
    return
  }
  w.document.write(html)
  w.document.close()
}

// 기록지 열기 — 베드 상세 모달과 이용기록 표가 함께 쓴다.
// 오류 표시는 화면마다 다르므로(모달은 field__error, 이용기록은 표뿐) 콜백으로 받는다.
async function openRecordFor(sessionId, onError) {
  if (!sessionId) return
  try {
    openRecordSheet(await getSessionRecord(sessionId))
  } catch (err) {
    if (onError) onError(err.message)
    else alert(err.message)
  }
}

// 환자별 인쇄용 리포트(HTML) — 새 창으로 열고 인쇄/PDF 저장
function openPatientReport(patientName, chartNumber, history, sessionNotes, rounds, vitals = []) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const sessions = history.filter((h) => h.chartNumber === chartNumber)
    .sort((a, b) => parseDateStr(b.date) - parseDateStr(a.date))
  const printedAt = new Date().toLocaleString('ko-KR')

  const notesHtml = ''

  const visitsHtml = sessions.map((h) => {
    const events = xVisitEvents(h.sessionId, sessionNotes, rounds, vitals)
    const tl = events.length ? `<ul class="tl">${events.map((e) =>
      `<li><span class="t">${esc(xTime(e.t))}</span><span class="k k--${e.kind === '라운딩' ? 'round' : 'note'}">${esc(e.kind)}</span><span class="c">${esc(e.text)}</span></li>`).join('')}</ul>`
      : '<p class="none">증상·라운딩 기록 없음</p>'
    // 방문 단위 정보는 그 방문 블록 안에 한 줄씩. 값이 없으면 줄 자체를 뺀다.
    // (내원당시증상·처방은 history 행이 이미 들고 온다 — CSV용으로 실어둔 것을 그대로 쓴다.)
    const line = (label, value) => (
      value ? `<p class="vline"><b>${esc(label)}</b> ${esc(value)}</p>` : ''
    )
    return `<section class="visit">
      <h3>${esc(h.date)} · ${esc(h.room)} ${esc(h.bedNumber)}번</h3>
      <p class="meta">${esc(h.startTime)} ~ ${esc(h.endTime)} · 이용 ${esc(formatDuration(h.usedMinutes))}</p>
      ${line('내원당시증상', h.visitSymptom)}
      ${line('특이사항(기저질환)', h.specialNote)}
      ${line('수액처방', xOrdersText(h.orders))}
      ${tl}
    </section>`
  }).join('')

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
  <title>${esc(patientName)}(${esc(chartNumber)}) 이용기록</title>
  <style>
    /* 배경을 명시하지 않으면 OS가 다크 모드일 때 기본 캔버스가 검게 깔려
       검은 글자가 검은 배경에 얹힌다(기록지 쪽은 원래 #fff를 두고 있었다). */
    *{box-sizing:border-box} body{font-family:-apple-system,'Pretendard','Apple SD Gothic Neo','Segoe UI',sans-serif;color:#1b1b1f;background:#fff;color-scheme:light;margin:0;padding:32px;max-width:860px;margin:0 auto;line-height:1.5}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:8px}
    h1{font-size:24px;margin:0} .chart{color:#666;font-weight:600}
    .sum{color:#555;font-size:14px;margin:6px 0 20px}
    h2{font-size:16px;margin:22px 0 8px;color:#1b6} section.visit h3{font-size:15px;margin:18px 0 2px;border-left:3px solid #4c8bf5;padding-left:8px}
    .meta{color:#666;font-size:13px;margin:0 0 8px 11px}
    ul.notes{list-style:none;padding:0;margin:0} ul.notes li{padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
    .cat{display:inline-block;font-size:12px;padding:1px 7px;border-radius:10px;margin-right:6px;color:#fff}
    .cat--warning{background:#d22b21} .cat--caution{background:#c77400} .cat--info{background:#888}
    .src{color:#999;font-size:12px}
    ul.tl{list-style:none;padding:0;margin:0 0 0 11px} ul.tl li{display:flex;gap:10px;align-items:baseline;padding:4px 0;font-size:14px;border-bottom:1px dotted #e5e5e5}
    .t{font-variant-numeric:tabular-nums;color:#333;font-weight:700;min-width:44px}
    .k{font-size:11px;padding:1px 6px;border-radius:8px;color:#fff;flex:none}
    .k--round{background:#5b8def} .k--note{background:#c77400}
    .none{color:#aaa;font-size:13px;margin:2px 0 0 11px}
    /* 방문 단위 한 줄들(내원당시증상·특이사항·수액처방) — .meta/.none과 같은 들여쓰기로 맞춘다.
       기존 특이사항 줄은 .special 클래스를 쓰면서 정의가 없어 홀로 어긋나 있었다. */
    .vline{font-size:13px;margin:2px 0 0 11px;color:#333}
    .vline b{color:#666;margin-right:4px}
    .toolbar{position:sticky;top:0;text-align:right;margin-bottom:12px}
    .toolbar button{font:inherit;font-weight:700;padding:8px 16px;border:0;border-radius:8px;background:#4c8bf5;color:#fff;cursor:pointer}
    @media print{.toolbar{display:none} body{padding:0}}
  </style></head><body>
    <div class="toolbar"><button onclick="window.print()">인쇄 / PDF 저장</button></div>
    <header><h1>${esc(patientName)} <span class="chart">${esc(chartNumber)}</span></h1><div class="sum">출력: ${esc(printedAt)}</div></header>
    <p class="sum">총 이용 ${sessions.length}회${sessions[0] ? ` · 최근 ${esc(sessions[0].date)}` : ''}</p>
    ${notesHtml}
    <h2>이용 이력 · 타임라인</h2>
    ${visitsHtml || '<p class="none">이용 기록이 없습니다.</p>'}
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('팝업이 차단되어 리포트를 열 수 없습니다. 팝업 허용 후 다시 시도해주세요.')
    return
  }
  w.document.write(html)
  w.document.close()
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
        <p className="stats-result__period"><Icon name="calendar" /> {rangeLabel}</p>

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
  sessionNotes,
  rounds = [],
  vitals = [],
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

  // 접근 로그(7c) — 특정 환자의 상세를 열 때만 남긴다. 검색어를 치는 중이거나
  // 목록만 보는 단계는 대상이 아니다. selectedKey를 보고 있으므로 결과 클릭으로 열든
  // 다른 화면에서 넘어와 열리든(initialChartNumber) 양쪽 다 잡힌다.
  useEffect(() => {
    if (selectedKey) logPatientDetailView(selectedKey)
  }, [selectedKey])

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
      // 세션 id(자동증가·숫자) 역순 = 최신 이용 먼저. (서버 전환 후 id가 숫자라 localeCompare 불가)
      return Number(b.id) - Number(a.id)
    })
    return {
      ...p,
      count: p.entries.length,
      lastDate: p.entries[0]?.date ?? '',
      sortedEntries: sorted,
    }
  })

  // 검색 필터 — 환자명과 차트번호를 같은 칸에서 받는다.
  // 이름은 부분 일치, 차트번호는 앞자리 일치다. 번호를 부분 일치로 두면 '2444'가
  // '2244414'에도 걸려(가운데에 들어 있다) 엉뚱한 환자가 섞인다.
  // 이름에 숫자가 들어가는 경우가 없어 두 조건이 서로 섞이지 않는다.
  // 정렬은 차트번호 오름차순(작은 번호부터). chart_no가 TEXT라 그냥 비교하면
  // '2244414'가 '244414'보다 앞에 온다 → localeCompare의 numeric으로 숫자로 센다.
  // (숫자가 아닌 값이 섞여도 NaN이 안 나온다.)
  const trimmed = query.trim()
  const searchResults = trimmed
    ? allPatients
      .filter((p) => p.patientName.includes(trimmed) || String(p.chartNumber).startsWith(trimmed))
      .sort((a, b) => String(a.chartNumber).localeCompare(String(b.chartNumber), undefined, { numeric: true }))
    : []

  // 숫자만 넣었으면 차트번호로 찾는 것이다 → 결과에 번호를 같이 보여줘야 맞게 찾았는지 안다.
  const isChartQuery = /^\d+$/.test(trimmed)

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

  function handleExportPatientCsv() {
    if (!selectedPatient) return
    const csv = buildPatientCsv(selectedPatient.chartNumber, history, sessionNotes, rounds, vitals)
    xDownload(`환자_${selectedPatient.patientName}_${selectedPatient.chartNumber}.csv`, csv, 'text/csv;charset=utf-8')
  }

  function handleOpenReport() {
    if (!selectedPatient) return
    openPatientReport(
      selectedPatient.patientName, selectedPatient.chartNumber,
      history, sessionNotes, rounds, vitals,
    )
  }

  // 이용이력 최신순 정렬 (세션 id 숫자 역순 — 서버 전환 후 id가 숫자라 localeCompare 불가)
  const patientHistory = selectedPatient
    ? [...selectedPatient.entries].sort((a, b) => Number(b.id) - Number(a.id))
    : []


  const selectedPatientRecentNotes = selectedPatient
    ? getRecentSessionNotes(sessionNotes, selectedPatient.chartNumber, 5)
    : []

  const selectedPatientRounds = selectedPatient
    ? rounds
        .filter((r) => r.chartNumber === selectedPatient.chartNumber && !r.deleted)
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
        .slice(0, 10)
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
          placeholder="환자명 또는 차트번호"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="patient-search__clear"
            onClick={() => { setQuery(''); setSelectedKey(null) }}
            aria-label="검색 초기화"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      {/* 상태별 렌더링 */}
      {!trimmed && !selectedPatient && (
        <div className="patient-empty">
          <p>환자명 또는 차트번호를 입력하면 검색 결과가 표시됩니다.</p>
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
                    {(nameCounts[p.patientName] > 1 || isChartQuery) && (
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
          {/* 뒤로 버튼 + 내보내기 */}
          <div className="patient-detail__toolbar">
            <button type="button" className="patient-detail__back" onClick={handleBack}>
              <Icon name="arrow-left" /> 목록으로
            </button>
            <div className="patient-detail__export">
              <button type="button" className="export-btn" onClick={handleExportPatientCsv}>
                <Icon name="arrow-up" /> CSV
              </button>
              <button type="button" className="export-btn export-btn--primary" onClick={handleOpenReport}>
                <Icon name="calendar" /> 인쇄용 리포트
              </button>
            </div>
          </div>

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


          {/* 최근 방문 타임라인 (금일 증상) */}
          {selectedPatientRecentNotes.length > 0 && (
            <div className="patient-notes">
              <h3 className="patient-history__title">최근 방문 증상</h3>
              <ul className="briefing__history-list">
                {selectedPatientRecentNotes.map((n) => (
                  <li key={n.id}>{formatSessionNoteLine(n)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 라운딩 기록 (최근) */}
          {selectedPatientRounds.length > 0 && (
            <div className="patient-notes">
              <h3 className="patient-history__title">라운딩 기록 (최근)</h3>
              <ul className="briefing__history-list">
                {selectedPatientRounds.map((r) => (
                  <li key={r.id}>
                    {xDate(r.occurredAt)} {xTime(r.occurredAt)} · {xRoundText(r)}
                  </li>
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
                    <th>증상</th>
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

// ─── 수액 Order 체크리스트 (공용) ──────────────────────────────────
// 처방 작성 모달과 관리자 묶음 편집 폼이 같은 것을 쓴다. "이 묶음에 뭐가 들어가나"를
// 실제 처방을 체크하는 것과 똑같은 조작으로 고르게 하려는 것(3b 스펙 4.2).
//
// checks 형태: { [code]: dose } — 키가 있으면 체크됨. 단순 항목은 dose가 ''.
// 수량 — 숫자를 직접 타이핑하거나 ▲▼로 1씩. 체크된 줄에만 뜬다.
//
// 타이핑 중에는 정규화하지 않는다. 매 글자마다 normalizeQty를 물리면 '0.5'를 넣을 수 없다:
// 칸을 지우면 ''가 1로 되돌아가고, '0'을 넣는 순간 1이 되고, '0.'은 NaN이라 1이 된다.
// 그래서 편집 중 원문(draft)을 그대로 들고 있다가 포커스를 뗄 때 한 번만 정리한다.
// draft가 null이면 부모가 준 qty를 보여준다.
// inputMode는 decimal이다 — numeric이면 아이패드 키패드에 소수점이 안 나온다.
function QtyStepper({ qty, onChange, label }) {
  const [draft, setDraft] = useState(null)

  function commit() {
    if (draft !== null) onChange(draft)
    setDraft(null)
  }

  // ▲▼는 편집 중이던 값을 기준으로 움직인다(버튼을 누르면 blur가 먼저 나지만,
  // 순서에 기대지 않고 draft를 직접 본다). QTY_MIN 아래로는 안 내려간다 —
  // 음수를 넘기면 정규화가 부호를 떼어 0.1이 0.9로 '늘어난다'.
  function step(delta) {
    const base = draft !== null ? normalizeQty(draft) : qty
    setDraft(null)
    onChange(Math.max(QTY_MIN, base + delta))
  }

  return (
    <span className="qty">
      <span className="qty__x">×</span>
      <input
        type="text"
        inputMode="decimal"
        className="qty__input"
        value={draft ?? qty}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={`${label} 수량`}
      />
      <span className="qty__steps">
        {/* ▲▼는 ±1이다(대부분 정수). 0.1 단위는 칸에 직접 타이핑한다. */}
        <button type="button" className="qty__step" onClick={() => step(1)} aria-label={`${label} 수량 1 늘리기`}>▲</button>
        <button type="button" className="qty__step" onClick={() => step(-1)} aria-label={`${label} 수량 1 줄이기`}>▼</button>
      </span>
    </span>
  )
}

// routeChecked·onToggleRoute는 경로 그룹을 렌더할 때만 쓰인다(관리자 묶음 편집은 그 그룹을 뺀다).
const EMPTY_SET = new Set()

function OrderChecklist({ items, checks, onToggle, onDose, onFreeText, onQty, routeChecked = EMPTY_SET, onToggleRoute }) {
  // 그룹 순서는 GROUP_ORDER를 따르되, 거기 없는 group_key가 DB에 생기면 뒤에 붙인다 —
  // 관리자가 새 그룹을 만들었을 때 화면에서 조용히 사라지면 안 된다.
  const byGroup = new Map()
  items.forEach((item) => {
    if (!byGroup.has(item.group_key)) byGroup.set(item.group_key, [])
    byGroup.get(item.group_key).push(item)
  })
  const known = GROUP_ORDER.filter((g) => byGroup.has(g))
  const extra = [...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g))
  const groups = [...known, ...extra].map((group) => ({ group, items: byGroup.get(group) }))

  return (
    <div className="order-groups">
      {groups.map(({ group, items: groupItems }) => (
        <section key={group} className="order-group">
          <h3 className="order-group__title">{group}</h3>
          <ul className="order-group__list">
            {groupItems.map((item) => {
              const plainKey = checkKey(item.code, '')
              return (
                <li key={item.code} className="order-item">
                  {group === ROUTE_GROUP ? (
                    /* 경로 박스 — 체크된 항목들의 route에서 자동으로 켜지고, 손으로 보정할 수
                       있다. ORD처럼 용법에 따라 갈리는 항목은 자동에 안 잡히므로 이 손잡이가 있다. */
                    <label className="order-item__check">
                      <input
                        type="checkbox"
                        checked={routeChecked.has(item.code)}
                        onChange={() => onToggleRoute(item.code)}
                      />
                      <span className="order-item__label">{item.label}</span>
                    </label>
                  ) : item.free_text ? (
                    /* 증류수 — 체크박스가 아니라 mL 자유입력. 값이 있으면 체크로 본다.
                       mL이 곧 양이라 수량 스테퍼를 붙이지 않는다. */
                    <label className="order-item__free">
                      <span className="order-item__label">{item.label}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="order-item__free-input"
                        value={checks[plainKey]?.dose ?? ''}
                        onChange={(e) => onFreeText(item.code, e.target.value)}
                        aria-label={`${item.label} mL`}
                      />
                      <span className="order-item__unit">mL</span>
                    </label>
                  ) : item.dose_options ? (
                    /* 용량 항목 — 용량 버튼이 곧 체크다. 용량 없이 체크되는 상태가 없다.
                       용량마다 독립이다: NS 180과 110을 함께 투약하는 처방이 있어 둘 다 켜진다.
                       같은 용량 두 백은 줄이 아니라 수량으로 센다. */
                    <div className="order-item__dosed">
                      <span className="order-item__label">{item.label}</span>
                      <div className="order-item__doses">
                        {item.dose_options.map((dose) => (
                          <button
                            key={dose}
                            type="button"
                            className={`order-dose${checkKey(item.code, dose) in checks ? ' order-dose--on' : ''}`}
                            onClick={() => onDose(item.code, dose)}
                            aria-pressed={checkKey(item.code, dose) in checks}
                          >
                            {dose}
                          </button>
                        ))}
                      </div>
                      {item.dose_options
                        .filter((dose) => checkKey(item.code, dose) in checks)
                        .map((dose) => (
                          <div key={dose} className="order-item__qty-row">
                            <span className="order-item__qty-dose">{dose}</span>
                            <QtyStepper
                              qty={checks[checkKey(item.code, dose)].qty}
                              onChange={(v) => onQty(checkKey(item.code, dose), v)}
                              label={`${item.label} ${dose}`}
                            />
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="order-item__checked-row">
                      <label className="order-item__check">
                        <input
                          type="checkbox"
                          checked={plainKey in checks}
                          onChange={() => onToggle(item.code)}
                        />
                        <span className="order-item__label">{item.label}</span>
                      </label>
                      {plainKey in checks && (
                        <QtyStepper
                          qty={checks[plainKey].qty}
                          onChange={(v) => onQty(plainKey, v)}
                          label={item.label}
                        />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ─── 관리자 설정 — 수액 Order 항목 관리 ────────────────────────────
// code는 화면에 안 보인다. 내부 식별자이고 수정도 불가하므로 관리자가 알 필요가 없다.
function OrderItemManageSection({ offline }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [showAdd, setShowAdd] = useState(false)
  // 새 항목의 기본 그룹은 '기본' — GROUP_ORDER[0]은 투여경로(고정 3개)라 기본값이면 안 된다.
  const [form, setForm] = useState({ label: '', group: '기본', doses: '', freeText: false })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ label: '', group: '', doses: '', freeText: false })

  function reload() {
    listOrderItemsAdmin()
      .then((rows) => { setItems(rows); setError('') })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [offline])

  // 기존 그룹 + GROUP_ORDER를 합쳐 선택지로. 새 그룹은 직접 입력으로 만든다.
  const groupChoices = [...new Set([...GROUP_ORDER, ...items.map((i) => i.group_key)])]

  async function handleAdd() {
    setError('')
    try {
      await createOrderItem({
        label: form.label.trim(),
        group_key: form.group.trim(),
        dose_options: form.doses.trim() ? form.doses.split(',') : null,
        free_text: form.freeText,
        sort_order: items.filter((i) => i.group_key === form.group.trim()).length,
      })
      setForm({ label: '', group: '기본', doses: '', freeText: false })
      setShowAdd(false)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditForm({
      label: item.label,
      group: item.group_key,
      doses: item.dose_options ? item.dose_options.join(',') : '',
      freeText: item.free_text,
    })
  }

  async function handleEditSave(id) {
    setBusyId(id)
    setError('')
    try {
      await updateOrderItem(id, {
        label: editForm.label.trim(),
        group_key: editForm.group.trim(),
        dose_options: editForm.doses.trim() ? editForm.doses.split(',') : null,
        free_text: editForm.freeText,
      })
      setEditingId(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(item) {
    setBusyId(item.id)
    setError('')
    try {
      await updateOrderItem(item.id, { is_active: !item.is_active })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  // 참조가 있으면 서버가 409를 준다 — 그때 비활성 전환을 권한다(이력 보존).
  async function handleDelete(item) {
    setBusyId(item.id)
    setError('')
    try {
      await deleteOrderItem(item.id)
      reload()
    } catch (err) {
      if (item.is_active && window.confirm(`${err.message}\n\n지금 비활성으로 숨길까요?`)) {
        try {
          await updateOrderItem(item.id, { is_active: false })
          reload()
        } catch (e2) {
          setError(e2.message)
        }
      } else {
        setError(err.message)
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleMove(item, dir) {
    const sameGroup = items.filter((i) => i.group_key === item.group_key)
    const idx = sameGroup.findIndex((i) => i.id === item.id)
    const target = sameGroup[idx + dir]
    if (!target) return
    setBusyId(item.id)
    setError('')
    try {
      await Promise.all([
        updateOrderItem(item.id, { sort_order: target.sort_order }),
        updateOrderItem(target.id, { sort_order: item.sort_order }),
      ])
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  function kindLabel(item) {
    if (item.free_text) return '자유입력'
    if (item.dose_options) return item.dose_options.join(' / ')
    return '체크'
  }

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>수액 Order 항목 ({items.length})</h4>
        <button type="button" className="dm-mode-btn" onClick={() => setShowAdd((v) => !v)} disabled={offline}>
          {showAdd ? '취소' : '+ 항목 추가'}
        </button>
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}

      {showAdd && (
        <div className="dm-admin-add-form">
          <label className="field">
            <span className="field__label">라벨</span>
            <input className="field__input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">그룹 (새 그룹은 직접 입력)</span>
            <input className="field__input" list="order-group-choices" value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })} />
            <datalist id="order-group-choices">
              {groupChoices.map((g) => <option key={g} value={g} />)}
            </datalist>
          </label>
          <label className="field">
            <span className="field__label">용량 선택지 (쉼표로 구분, 없으면 비움)</span>
            <input className="field__input" value={form.doses} onChange={(e) => setForm({ ...form, doses: e.target.value })} />
          </label>
          <label className="order-admin-free">
            <input type="checkbox" checked={form.freeText} onChange={(e) => setForm({ ...form, freeText: e.target.checked })} />
            <span>자유입력 항목 (증류수처럼 숫자를 직접 적는 칸)</span>
          </label>
          <button type="button" className="btn-register" disabled={offline || !form.label.trim() || !form.group.trim()} onClick={handleAdd}>
            추가
          </button>
        </div>
      )}

      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr><th>그룹</th><th>라벨</th><th>입력 방식</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {editingId === item.id ? (
                      <input className="field__input" list="order-group-choices" value={editForm.group}
                        onChange={(e) => setEditForm({ ...editForm, group: e.target.value })} />
                    ) : item.group_key}
                  </td>
                  <td>
                    {editingId === item.id ? (
                      <input className="field__input" value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                    ) : item.label}
                  </td>
                  <td>
                    {editingId === item.id ? (
                      <input className="field__input" value={editForm.doses} placeholder="110,180,100"
                        onChange={(e) => setEditForm({ ...editForm, doses: e.target.value })} />
                    ) : kindLabel(item)}
                  </td>
                  <td>
                    <span className={`badge ${item.is_active ? 'badge--info' : 'badge--warning'}`}>
                      {item.is_active ? '사용' : '숨김'}
                    </span>
                  </td>
                  <td className="dm-note-manage__action">
                    {editingId === item.id ? (
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === item.id} onClick={() => handleEditSave(item.id)}>저장</button>
                        <button type="button" className="dm-note-btn" onClick={() => setEditingId(null)}>취소</button>
                      </div>
                    ) : (
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === item.id} aria-label="위로 이동" onClick={() => handleMove(item, -1)}>▲</button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === item.id} aria-label="아래로 이동" onClick={() => handleMove(item, 1)}>▼</button>
                        <button type="button" className="dm-note-btn" onClick={() => startEdit(item)} disabled={offline}>수정</button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === item.id} onClick={() => handleToggleActive(item)}>
                          {item.is_active ? '숨김' : '사용'}
                        </button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === item.id} onClick={() => handleDelete(item)}>삭제</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── 관리자 설정 — 묶음처방 관리 ────────────────────────────────────
// 포함 항목은 처방 작성과 같은 체크리스트로 고른다(OrderChecklist 재사용).
function OrderBundleManageSection({ offline }) {
  const [bundles, setBundles] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  // editingId === 'new'면 추가 폼, 숫자면 그 묶음 수정 폼, null이면 닫힘.
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [emrCode, setEmrCode] = useState('')
  const [checks, setChecks] = useState({})

  function reload() {
    Promise.all([listOrderBundlesAdmin(), getOrderItems()])
      .then(([rows, itemRows]) => { setBundles(rows); setItems(itemRows); setError('') })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [offline])

  function openNew() {
    setEditingId('new')
    setName('')
    setEmrCode('')
    setChecks({})
  }

  function openEdit(bundle) {
    setEditingId(bundle.id)
    setName(bundle.name)
    setEmrCode(bundle.emr_code ?? '')
    const next = {}
    bundle.items.forEach((it) => {
      next[checkKey(it.code, it.dose)] = { code: it.code, dose: it.dose ?? '', qty: it.qty ?? 1 }
    })
    setChecks(next)
  }

  async function handleSave() {
    setError('')
    const payload = {
      name: name.trim(),
      emr_code: emrCode.trim(),
      items: Object.values(checks).map((row) => ({ code: row.code, dose: row.dose, qty: row.qty })),
    }
    try {
      if (editingId === 'new') await createOrderBundle({ ...payload, sort_order: bundles.length })
      else await updateOrderBundle(editingId, payload)
      setEditingId(null)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // 묶음은 세션 기록과 무관해서(세션은 개별 code로 저장) 지워도 과거 기록이 안 깨진다.
  async function handleDelete(bundle) {
    if (!window.confirm(`'${bundle.name}' 묶음을 삭제할까요?`)) return
    setBusyId(bundle.id)
    setError('')
    try {
      await deleteOrderBundle(bundle.id)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  function summary(bundle) {
    const labelOf = (code) => items.find((i) => i.code === code)?.label ?? code
    const names = bundle.items.map((it) => labelOf(it.code)
      + (it.dose ? ` ${it.dose}` : '')
      + (it.qty ? ` ×${it.qty}` : ''))
    if (names.length === 0) return '(비어 있음)'
    return names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} 외 ${names.length - 4}`
  }

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>묶음처방 ({bundles.length})</h4>
        <button type="button" className="dm-mode-btn" onClick={() => (editingId ? setEditingId(null) : openNew())} disabled={offline}>
          {editingId ? '취소' : '+ 묶음 추가'}
        </button>
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}

      {editingId !== null && (
        <div className="dm-admin-add-form">
          <label className="field">
            <span className="field__label">묶음코드</span>
            <input
              className="field__input"
              value={emrCode}
              onChange={(e) => setEmrCode(e.target.value)}
              aria-label="EMR 묶음코드"
            />
            <span className="field__hint">처방 작성 화면의 버튼에 이 값이 찍힌다. 비우면 이름이 찍힌다.</span>
          </label>
          <label className="field">
            <span className="field__label">묶음 이름</span>
            <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <OrderChecklist
            /* 경로 그룹은 빼고 보여준다 — 묶음에 경로를 담는 게 아니라 담긴 항목에서 나온다. */
            items={items.filter((it) => it.group_key !== ROUTE_GROUP)}
            checks={checks}
            onToggle={(code) => setChecks((prev) => {
              const next = { ...prev }
              const key = checkKey(code, '')
              if (key in next) delete next[key]; else next[key] = { code, dose: '', qty: 1 }
              return next
            })}
            onDose={(code, dose) => setChecks((prev) => {
              const next = { ...prev }
              const key = checkKey(code, dose)
              if (key in next) delete next[key]; else next[key] = { code, dose, qty: 1 }
              return next
            })}
            onFreeText={(code, value) => setChecks((prev) => {
              const next = { ...prev }
              const key = checkKey(code, '')
              if (value.trim() === '') delete next[key]; else next[key] = { code, dose: value, qty: 1 }
              return next
            })}
            onQty={(key, value) => setChecks((prev) => (prev[key] ? {
              ...prev,
              [key]: {
                ...prev[key],
                qty: normalizeQty(value),
              },
            } : prev))}
          />
          <button type="button" className="btn-register" disabled={offline || !name.trim()} onClick={handleSave}>
            {editingId === 'new' ? '추가' : '저장'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : bundles.length === 0 ? (
        <div className="dm-empty">등록된 묶음이 없습니다</div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr><th>묶음코드</th><th>이름</th><th>포함 항목</th><th></th></tr>
            </thead>
            <tbody>
              {bundles.map((bundle) => (
                <tr key={bundle.id}>
                  <td>{bundle.emr_code || '—'}</td>
                  <td>{bundle.name}</td>
                  <td>{summary(bundle)}</td>
                  <td className="dm-note-manage__action">
                    <div className="dm-admin-edit-actions__buttons">
                      <button type="button" className="dm-note-btn" onClick={() => openEdit(bundle)} disabled={offline}>수정</button>
                      <button type="button" className="dm-note-btn" disabled={offline || busyId === bundle.id} onClick={() => handleDelete(bundle)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── 관리자 설정 — 계정 관리 ──────────────────────────────────────
function AccountManageSection({ offline }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [showAdd, setShowAdd] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState('staff')

  const [editingId, setEditingId] = useState(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editRole, setEditRole] = useState('staff')

  function reload() {
    listAccounts()
      .then((rows) => { setAccounts(rows); setError('') })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  // offline이 바뀔 때도 다시 부른다 — 연결이 끊긴 동안 목록 로딩이 실패했으면
  // 복구된 뒤에 저절로 채워져야 한다(탭을 다시 눌러야 나오면 안 됨).
  useEffect(() => { reload() }, [offline])

  async function handleAdd() {
    setError('')
    try {
      await createAccount({
        username: newUsername.trim(),
        password: newPassword,
        displayName: newDisplayName.trim(),
        role: newRole,
      })
      setNewUsername(''); setNewPassword(''); setNewDisplayName(''); setNewRole('staff')
      setShowAdd(false)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(acc) {
    setEditingId(acc.id)
    setEditDisplayName(acc.displayName)
    setEditPassword('')
    setEditRole(acc.role)
  }

  async function handleEditSave(id) {
    setBusyId(id)
    setError('')
    try {
      await updateAccount(id, {
        displayName: editDisplayName.trim(),
        password: editPassword || undefined,
        role: editRole,
      })
      setEditingId(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(acc) {
    setBusyId(acc.id)
    setError('')
    try {
      await updateAccount(acc.id, { isActive: !acc.isActive })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>계정 관리 ({accounts.length})</h4>
        <button type="button" className="dm-mode-btn" onClick={() => setShowAdd((v) => !v)} disabled={offline}>
          {showAdd ? '취소' : '+ 계정 추가'}
        </button>
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}

      {showAdd && (
        <div className="dm-admin-add-form">
          <label className="field">
            <span className="field__label">아이디</span>
            <input className="field__input" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">이름</span>
            <input className="field__input" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">비밀번호</span>
            <input type="password" className="field__input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">역할</span>
            <select className="field__input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ACCOUNT_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-register"
            disabled={offline || !newUsername.trim() || !newPassword || !newDisplayName.trim()}
            onClick={handleAdd}
          >
            추가
          </button>
        </div>
      )}

      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>아이디</th>
                <th>이름</th>
                <th>역할</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id}>
                  <td>{acc.username}</td>
                  <td>
                    {editingId === acc.id ? (
                      <input className="field__input" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
                    ) : acc.displayName}
                  </td>
                  <td>
                    {editingId === acc.id ? (
                      <select className="field__input" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                        {ACCOUNT_ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : ACCOUNT_ROLE_OPTIONS.find((o) => o.value === acc.role)?.label}
                  </td>
                  <td>
                    <span className={`badge ${acc.isActive ? 'badge--info' : 'badge--warning'}`}>
                      {acc.isActive ? '사용' : '사용 안함'}
                    </span>
                  </td>
                  <td className="dm-note-manage__action">
                    {editingId === acc.id ? (
                      <div className="dm-admin-edit-actions">
                        <input
                          type="password"
                          className="field__input dm-admin-edit-actions__pw"
                          placeholder="새 비밀번호(선택)"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                        />
                        <div className="dm-admin-edit-actions__buttons">
                          <button type="button" className="dm-note-btn" disabled={offline || busyId === acc.id} onClick={() => handleEditSave(acc.id)}>저장</button>
                          <button type="button" className="dm-note-btn" onClick={() => setEditingId(null)}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" onClick={() => startEdit(acc)} disabled={offline}>수정</button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === acc.id} onClick={() => handleToggleActive(acc)}>
                          {acc.isActive ? '사용 안함' : '사용'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// 서명 이미지를 가로 최대 600px로 줄여 dataURL을 만든다. 서명은 이 정도면 충분하고,
// 원본을 그대로 넣으면 500KB 상한에 쉽게 걸린다(폰 사진은 수 MB).
// PNG는 투명 배경을 살려야 해서 PNG로, JPG는 그대로 JPG로 뽑는다.
const SIGNATURE_MAX_WIDTH = 600

// 스캔·촬영한 서명 파일은 사방에 빈 여백이 붙어 온다. 기록지는 서명을 height 20px로 줄여
// 넣으므로 여백을 그대로 두면 잉크가 절반 크기로 찍혀 이름이 안 읽힌다
// (받아온 7장 실측: 여백이 넓이의 48~62%) → 잉크 영역만 남기고 잘라낸다.
// PNG는 투명 배경, JPG는 흰 배경이라 '투명하지도 않고 거의 흰색도 아닌' 픽셀을 잉크로 본다.
// 배경이 흰색이 아닌 스캔은 경계가 전체가 되어 그대로 통과한다(안전한 폴백).
function inkBounds(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      if (data[i + 3] <= 16) continue
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function resizeSignature(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('이미지를 열지 못했습니다'))
      img.onload = () => {
        const scale = Math.min(1, SIGNATURE_MAX_WIDTH / img.width)
        let canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const box = inkBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        if (box && (box.w < canvas.width || box.h < canvas.height)) {
          const cropped = document.createElement('canvas')
          cropped.width = box.w
          cropped.height = box.h
          cropped.getContext('2d').drawImage(canvas, -box.x, -box.y)
          canvas = cropped
        }

        const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
        resolve(canvas.toDataURL(type, type === 'image/jpeg' ? 0.9 : undefined))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// ─── 관리자 설정 — 직원 관리 ──────────────────────────────────────
function StaffManageSection({ offline }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  // 서명 미리보기 — 목록에는 원본이 안 오므로 눌렀을 때만 받아온다. { [staffId]: dataURL }
  const [signatures, setSignatures] = useState({})
  const fileInputRef = useRef(null)
  const uploadTargetRef = useRef(null)

  function reload() {
    listStaffAdmin()
      .then((rows) => {
        setStaff([...rows].sort((a, b) => a.sortOrder - b.sortOrder))
        setError('')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  // offline이 바뀔 때도 다시 부른다 — 연결이 끊긴 동안 목록 로딩이 실패했으면
  // 복구된 뒤에 저절로 채워져야 한다(탭을 다시 눌러야 나오면 안 됨).
  useEffect(() => { reload() }, [offline])

  async function handleAdd() {
    setError('')
    try {
      await createStaffMember(newName.trim())
      setNewName('')
      setShowAdd(false)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(s) {
    setEditingId(s.id)
    setEditName(s.name)
  }

  async function handleEditSave(id) {
    setBusyId(id)
    setError('')
    try {
      await updateStaffMember(id, { name: editName.trim() })
      setEditingId(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(s) {
    setBusyId(s.id)
    setError('')
    try {
      await updateStaffMember(s.id, { isActive: !s.isActive })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  // 파일 input은 하나만 두고 어느 직원 것인지 ref로 기억한다 — 직원마다 input을 두면
  // 목록이 길어질수록 쓸데없이 늘어난다.
  function pickSignature(staffId) {
    uploadTargetRef.current = staffId
    fileInputRef.current?.click()
  }

  async function handleSignatureFile(e) {
    const file = e.target.files?.[0]
    const staffId = uploadTargetRef.current
    e.target.value = '' // 같은 파일을 다시 골라도 change가 나게
    if (!file || !staffId) return
    setBusyId(staffId)
    setError('')
    try {
      const dataUrl = await resizeSignature(file)
      await setStaffSignature(staffId, dataUrl)
      setSignatures((prev) => ({ ...prev, [staffId]: dataUrl }))
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleSignatureDelete(s) {
    if (!window.confirm(`${s.name} 직원의 서명을 삭제할까요?`)) return
    setBusyId(s.id)
    setError('')
    try {
      await setStaffSignature(s.id, null)
      setSignatures((prev) => {
        const next = { ...prev }
        delete next[s.id]
        return next
      })
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function loadSignature(s) {
    if (signatures[s.id]) return
    try {
      const { signature } = await getStaffSignature(s.id)
      setSignatures((prev) => ({ ...prev, [s.id]: signature }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleMove(index, dir) {
    const current = staff[index]
    const target = staff[index + dir]
    if (!target) return
    setBusyId(current.id)
    setError('')
    try {
      await Promise.all([
        updateStaffMember(current.id, { sortOrder: target.sortOrder }),
        updateStaffMember(target.id, { sortOrder: current.sortOrder }),
      ])
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>직원 관리 ({staff.length})</h4>
        <button type="button" className="dm-mode-btn" onClick={() => setShowAdd((v) => !v)} disabled={offline}>
          {showAdd ? '취소' : '+ 직원 추가'}
        </button>
      </div>

      {/* 서명 파일 선택 — 직원마다 두지 않고 하나를 돌려 쓴다(대상은 uploadTargetRef). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="staff-sign__file"
        onChange={handleSignatureFile}
      />

      {error && <p role="alert" className="field__error">{error}</p>}

      {showAdd && (
        <div className="dm-admin-add-form">
          <label className="field">
            <span className="field__label">이름</span>
            <input className="field__input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="button" className="btn-register" disabled={offline || !newName.trim()} onClick={handleAdd}>
            추가
          </button>
        </div>
      )}

      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : (
        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>상태</th>
                <th>서명</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    {editingId === s.id ? (
                      <input className="field__input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    ) : s.name}
                  </td>
                  <td>
                    <span className={`badge ${s.isActive ? 'badge--info' : 'badge--warning'}`}>
                      {s.isActive ? '사용' : '사용 안함'}
                    </span>
                  </td>
                  <td>
                    <div className="staff-sign">
                      {s.hasSignature ? (
                        signatures[s.id] ? (
                          <img className="staff-sign__img" src={signatures[s.id]} alt={`${s.name} 서명`} />
                        ) : (
                          <button type="button" className="dm-note-btn" onClick={() => loadSignature(s)}>
                            보기
                          </button>
                        )
                      ) : (
                        <span className="staff-sign__none">없음</span>
                      )}
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id} onClick={() => pickSignature(s.id)}>
                          {s.hasSignature ? '교체' : '등록'}
                        </button>
                        {s.hasSignature && (
                          <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id} onClick={() => handleSignatureDelete(s)}>
                            삭제
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="dm-note-manage__action">
                    {editingId === s.id ? (
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id} onClick={() => handleEditSave(s.id)}>저장</button>
                        <button type="button" className="dm-note-btn" onClick={() => setEditingId(null)}>취소</button>
                      </div>
                    ) : (
                      <div className="dm-admin-edit-actions__buttons">
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id || i === 0} aria-label="위로 이동" onClick={() => handleMove(i, -1)}>▲</button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id || i === staff.length - 1} aria-label="아래로 이동" onClick={() => handleMove(i, 1)}>▼</button>
                        <button type="button" className="dm-note-btn" onClick={() => startEdit(s)} disabled={offline}>수정</button>
                        <button type="button" className="dm-note-btn" disabled={offline || busyId === s.id} onClick={() => handleToggleActive(s)}>
                          {s.isActive ? '사용 안함' : '사용'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── 관리자 설정 — 운영 설정값 ────────────────────────────────────
// 쪽지 로그 — 관리자 전용 감사 화면. 직원 화면의 10분 휘발과 무관하게 전부 남는다.
// 내용 수정은 없고 삭제만 된다(완전 삭제, 되돌릴 수 없음).
function formatMessageStamp(ts) {
  const d = new Date(ts)
  const date = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${date} ${formatHour24(ts)}`
}

function MessageLogSection() {
  const PAGE_SIZE = 50
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // 다른 관리자 섹션과 같은 방식 — loading은 true로 시작하고 effect 안에서 동기 setState를 하지 않는다
  // (react-hooks/set-state-in-effect 베이스라인을 넘기지 않기 위해서이기도 하다).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 삭제 후 목록을 다시 받기 위한 트리거. 필터·페이지가 그대로여도 갱신되게 한다.
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    getAdminMessages({ from, to, limit: PAGE_SIZE, offset })
      .then((r) => { if (!cancelled) { setRows(r.messages ?? []); setTotal(r.total ?? 0); setError('') } })
      .catch((err) => { if (!cancelled) setError(err.message ?? '쪽지 로그를 불러오지 못했습니다') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, offset, reloadKey])

  // 완전 삭제라 되돌릴 수 없다 — 무엇을 지우는지 밝혀 한 번 확인받는다.
  async function handleDelete(label, run) {
    if (!window.confirm(`${label}\n\n완전히 삭제됩니다. 되돌릴 수 없습니다. 계속할까요?`)) return
    setBusyId(label)
    setError('')
    try {
      await run()
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message ?? '삭제하지 못했습니다')
    } finally {
      setBusyId(null)
    }
  }

  // 전체발송은 broadcast_id로 묶어 한 건처럼 보여준다(펼치면 개별 대상).
  const groups = []
  const byBroadcast = new Map()
  for (const row of rows) {
    if (!row.broadcast_id) { groups.push({ kind: 'one', row }); continue }
    const found = byBroadcast.get(row.broadcast_id)
    if (found) { found.rows.push(row); continue }
    const group = { kind: 'broadcast', id: row.broadcast_id, rows: [row] }
    byBroadcast.set(row.broadcast_id, group)
    groups.push(group)
  }

  return (
    <section className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>쪽지 로그</h4>
        <span className="msg-log__count">{total}건</span>
      </div>

      <div className="msg-log__filters">
        <label className="dm-search__field">
          <span>시작일</span>
          <input type="date" className="dm-search__input" value={from}
            onChange={(e) => { setFrom(e.target.value); setOffset(0) }} />
        </label>
        <label className="dm-search__field">
          <span>종료일</span>
          <input type="date" className="dm-search__input" value={to}
            onChange={(e) => { setTo(e.target.value); setOffset(0) }} />
        </label>
        {(from || to) && (
          <button type="button" className="dm-search__reset"
            onClick={() => { setFrom(''); setTo(''); setOffset(0) }}>
            초기화
          </button>
        )}
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}
      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : groups.length === 0 ? (
        <div className="dm-empty">쪽지 기록이 없습니다</div>
      ) : (
        <ul className="msg-log__list">
          {groups.map((g) => (
            g.kind === 'one' ? (
              <li key={g.row.id} className="msg-log__item">
                <div className="msg-log__meta">
                  <span className="msg-log__time">{formatMessageStamp(g.row.created_at)}</span>
                  <span className="msg-log__who">{g.row.from_name} → {g.row.to_name}</span>
                  {g.row.read_at && <span className="msg-log__read">읽음</span>}
                  <button
                    type="button"
                    className="dm-note-btn msg-log__del"
                    disabled={busyId !== null}
                    onClick={() => handleDelete(
                      `${g.row.from_name} → ${g.row.to_name} 쪽지 1건`,
                      () => deleteAdminMessage(g.row.id),
                    )}
                  >
                    삭제
                  </button>
                </div>
                <p className="msg-log__content">{g.row.content}</p>
              </li>
            ) : (
              <li key={g.id} className="msg-log__item">
                <div className="msg-log__meta">
                  <span className="msg-log__time">{formatMessageStamp(g.rows[0].created_at)}</span>
                  <span className="msg-log__who">{g.rows[0].from_name} → </span>
                  <span className="msg-log__badge">전체발송 ({g.rows.length}명)</span>
                  <button
                    type="button"
                    className="dm-note-btn msg-log__del"
                    disabled={busyId !== null}
                    onClick={() => handleDelete(
                      `${g.rows[0].from_name}의 전체발송 (수신 ${g.rows.length}명)`,
                      () => deleteAdminBroadcast(g.id),
                    )}
                  >
                    삭제
                  </button>
                </div>
                <p className="msg-log__content">{g.rows[0].content}</p>
                <details className="msg-log__targets">
                  <summary>받는 사람 보기</summary>
                  <ul>
                    {g.rows.map((r) => (
                      <li key={r.id}>{r.to_name}{r.read_at ? ' · 읽음' : ''}</li>
                    ))}
                  </ul>
                </details>
              </li>
            )
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="msg-log__pager">
          <button type="button" className="dm-note-btn" disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
            이전
          </button>
          <span>{Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
          <button type="button" className="dm-note-btn" disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            다음
          </button>
        </div>
      )}
    </section>
  )
}

function SettingsManageSection({ offline }) {
  const [settings, setSettings] = useState([])
  const [draft, setDraft] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState('')

  function reload() {
    listSettings()
      .then((rows) => {
        setSettings(rows)
        setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value])))
        setError('')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  // offline이 바뀔 때도 다시 부른다 — 연결이 끊긴 동안 목록 로딩이 실패했으면
  // 복구된 뒤에 저절로 채워져야 한다(탭을 다시 눌러야 나오면 안 됨).
  useEffect(() => { reload() }, [offline])

  async function handleSave(key) {
    setSavingKey(key)
    setError('')
    try {
      await updateSetting(key, draft[key])
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingKey('')
    }
  }

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>설정</h4>
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}

      {loading ? (
        <div className="dm-empty">불러오는 중...</div>
      ) : (
        <div className="dm-settings-list">
          {SETTINGS_META.map((meta) => {
            const saved = settings.find((s) => s.key === meta.key)?.value ?? ''
            const dirty = draft[meta.key] !== undefined && draft[meta.key] !== saved
            return (
              <div className="dm-settings-row" key={meta.key}>
                <span className="dm-settings-row__label">{meta.label}</span>
                <input
                  type="number"
                  step={meta.step}
                  className="field__input dm-settings-row__input"
                  value={draft[meta.key] ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                />
                <span className="dm-settings-row__unit">{meta.unit}</span>
                <button
                  type="button"
                  className="dm-note-btn"
                  disabled={offline || !dirty || savingKey === meta.key}
                  onClick={() => handleSave(meta.key)}
                >
                  저장
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 관리자 설정 — 채팅 내역 (날짜별) ──────────────────────────────
// 채팅창은 당일 것만 보여준다. 지난 대화는 여기서 날짜별로 본다.
// 삭제는 소프트다 — 채팅창에서만 사라지고 여기엔 '삭제됨'으로 남는다(내역 관리가 목적).
function ChatLogSection({ offline }) {
  const [dates, setDates] = useState([])
  const [date, setDate] = useState('')
  const [rows, setRows] = useState([])
  const [checked, setChecked] = useState(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listChatDates()
      .then((list) => {
        setDates(list)
        // 기본은 가장 최근 날짜(대개 오늘) — 관리자가 매번 고르지 않아도 되게.
        if (list.length) setDate((prev) => prev || list[0].date)
      })
      .catch((err) => setError(err.message))
  }, [])

  // 선택 해제는 날짜를 바꾸는 지점(select onChange)에서 한다 —
  // effect 본문에서 setState를 동기로 부르면 eslint 베이스라인(1건)을 넘는다.
  useEffect(() => {
    if (!date) return
    listChatByDate(date).then(setRows).catch((err) => setError(err.message))
  }, [date])

  async function apply(deleted) {
    if (checked.size === 0) return
    setBusy(true)
    setError('')
    try {
      await setChatDeleted([...checked], deleted)
      setRows(await listChatByDate(date))
      setChecked(new Set())
      setDates(await listChatDates())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id))

  return (
    <div className="dm-admin-section">
      <div className="dm-note-section__header">
        <h4>채팅 내역 ({dates.length ? `${dates.length}일` : '없음'})</h4>
        <select
          className="field__input dm-chat-log__date"
          value={date}
          onChange={(e) => { setChecked(new Set()); setDate(e.target.value) }}
          aria-label="채팅 날짜"
        >
          {dates.length === 0 && <option value="">기록 없음</option>}
          {dates.map((d) => (
            <option key={d.date} value={d.date}>
              {d.date} ({d.total}건{d.deleted_count > 0 ? ` · 삭제 ${d.deleted_count}` : ''})
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="field__error">{error}</p>}

      {rows.length === 0 ? (
        <div className="dm-empty">이 날짜의 대화가 없습니다</div>
      ) : (
        <>
          <div className="dm-actions">
            <button
              type="button"
              className="dm-btn dm-btn--purge"
              onClick={() => apply(true)}
              disabled={offline || busy || checked.size === 0}
            >
              선택 삭제
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--restore"
              onClick={() => apply(false)}
              disabled={offline || busy || checked.size === 0}
            >
              선택 복구
            </button>
            {checked.size > 0 && <span className="dm-actions__selected">{checked.size}건 선택됨</span>}
          </div>

          <div className="dm-table-wrap">
            <table className="dm-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                      aria-label="전체 선택"
                    />
                  </th>
                  <th>시각</th>
                  <th>보낸 사람</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.deleted ? 'dm-chat-log__row--deleted' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`${r.author} 메시지 선택`}
                      />
                    </td>
                    <td>{new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{r.author}</td>
                    <td>
                      {r.content}
                      {r.deleted === 1 && <span className="dm-chat-log__tag">삭제됨</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
  account,
  offline,
}) {
  // 검색 조건
  const [searchName, setSearchName] = useState('')
  const [searchChart, setSearchChart] = useState('')
  const [searchDate, setSearchDate] = useState('')

  // 선택된 항목 id Set
  const [checkedIds, setCheckedIds] = useState(new Set())

  // 삭제 확인 팝업
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [purging, setPurging] = useState(false)
  const [deleteConfirmHeld, deleteConfirmClosing] = useModalExit(deleteConfirm)

  // 휴지통 모드
  const [trashMode, setTrashMode] = useState(false)

  // 증상 데이터 관리
  const [noteSearchChart, setNoteSearchChart] = useState('')
  const [sessionNoteTrash, setSessionNoteTrash] = useState(false)

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

  // ── 선택 완전삭제 (DB에서 제거, 복구 없음) ──
  // 소프트삭제된 것만 대상이다. 서버도 deleted=1만 지우지만 여기서도 걸러서
  // 확인 문구의 건수가 실제로 지워질 건수와 같게 한다.
  async function handlePurge() {
    const targets = allHistory.filter((e) => checkedIds.has(e.id) && e.deleted)
    if (targets.length === 0) return
    if (!window.confirm(
      `${targets.length}건을 완전삭제합니다.\n\n`
      + '바이탈·라운딩·증상·처방까지 함께 지워지고 되돌릴 수 없습니다.\n계속할까요?',
    )) return

    setPurging(true)
    try {
      const { purged } = await purgeSessions(targets.map((e) => e.sessionId))
      const gone = new Set(targets.map((e) => e.sessionId))
      // 서버에서 사라졌으니 화면에서도 빼야 한다(복구 대상이 아니라 존재하지 않는 기록이다).
      onUpdateHistory((prev) => prev.filter((e) => !gone.has(e.sessionId)))
      onUpdateSessionNotes((prev) => prev.filter((n) => !gone.has(n.sessionId)))
      setCheckedIds(new Set())
      if (purged !== targets.length) {
        alert(`${purged}건만 삭제됐습니다. 나머지는 이미 없거나 복구된 기록입니다.`)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setPurging(false)
    }
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
  // filter()는 배열을 반환하므로 .length. (.size는 Set 전용이라 undefined가 돼서
  // "N건 선택됨" 라벨이 안 뜨고 선택삭제 버튼이 항상 활성으로 보이던 버그를 고침)
  const checkedCount = filtered.filter((e) => checkedIds.has(e.id)).length

  // ── 증상 데이터 관리 ──
  function findPatientNameByChart(chartNumber) {
    return (
      allHistory.find((h) => h.chartNumber === chartNumber)?.patientName ?? ''
    )
  }

  const trimmedNoteSearch = noteSearchChart.trim()

  const sessionNoteList = sessionNotes
    .filter((n) => (sessionNoteTrash ? n.deleted : !n.deleted))
    .filter((n) => !trimmedNoteSearch || n.chartNumber.includes(trimmedNoteSearch))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  function handleToggleSessionNoteDeleted(id, deletedValue) {
    onUpdateSessionNotes((prev) =>
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
          <Icon name="trash" /> 휴지통 {totalDeleted > 0 && <span className="dm-mode-btn__badge">{totalDeleted}</span>}
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
              inputMode="numeric" placeholder="차트번호 검색"
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
        {!trashMode ? (
          <button
            type="button"
            className="dm-btn dm-btn--delete"
            onClick={handleDeleteRequest}
            disabled={offline || checkedCount === 0}
          >
            선택 삭제
          </button>
        ) : (
          <>
            <button
              type="button"
              className="dm-btn dm-btn--restore"
              onClick={handleRestore}
              disabled={offline || checkedCount === 0}
            >
              선택 복구
            </button>
            {/* 완전삭제는 복구가 없다 → 관리자만 보인다(데이터관리 탭 자체는 전원 공개다). */}
            {account?.role === 'admin' && (
              <button
                type="button"
                className="dm-btn dm-btn--purge"
                onClick={handlePurge}
                disabled={offline || checkedCount === 0 || purging}
              >
                {purging ? '삭제 중...' : '완전삭제'}
              </button>
            )}
          </>
        )}
        {checkedCount > 0 && (
          <span className="dm-actions__selected">{checkedCount}건 선택됨</span>
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

      {/* ── 증상 데이터 관리 ── */}
      <div className="dm-note-manage">
        <h3 className="dm-note-manage__title">증상 데이터 관리</h3>

        <label className="dm-search__field dm-note-manage__search">
          <span className="dm-search__label">차트번호로 검색</span>
          <input
            type="text"
            className="dm-search__input"
            value={noteSearchChart}
            onChange={(e) => setNoteSearchChart(e.target.value)}
            inputMode="numeric" placeholder="차트번호 검색"
          />
        </label>

        {/* 금일 증상 관리 */}
        <div className="dm-note-section">
          <div className="dm-note-section__header">
            <h4>금일 증상 ({sessionNoteList.length})</h4>
            <button
              type="button"
              className={`dm-mode-btn dm-mode-btn--trash${sessionNoteTrash ? ' dm-mode-btn--active' : ''}`}
              onClick={() => setSessionNoteTrash((prev) => !prev)}
            >
              <Icon name="trash" /> {sessionNoteTrash ? '삭제됨 보는 중' : '삭제됨 보기'}
            </button>
          </div>

          {sessionNoteList.length === 0 ? (
            <div className="dm-empty">
              {sessionNoteTrash ? '삭제된 금일 증상이 없습니다.' : '금일 증상이 없습니다.'}
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
                          disabled={offline}
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

      </div>

      {/* ── 관리자 설정 (admin 롤 전용) ── */}
      {account?.role === 'admin' && (
        <div className="dm-admin">
          <h3 className="dm-note-manage__title">관리자 설정</h3>
          <AccountManageSection offline={offline} />
          <StaffManageSection offline={offline} />
          <OrderItemManageSection offline={offline} />
          <OrderBundleManageSection offline={offline} />
          <SettingsManageSection offline={offline} />
          <ChatLogSection offline={offline} />
          <MessageLogSection />
        </div>
      )}

      {/* ── 삭제 확인 팝업 ── */}
      {deleteConfirmHeld && (
        <div className={`modal-overlay${deleteConfirmClosing ? ' modal-overlay--closing' : ''}`}>
          <div className="modal modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                선택한 기록을 삭제하시겠습니까?
                <br />
                <span className="confirm__sub">삭제된 기록은 휴지통에서 복구할 수 있습니다.</span>
              </p>
              <div className="confirm__actions">
                <button type="button" className="btn-confirm btn-confirm--no" onClick={() => setDeleteConfirm(false)}>
                  아니오
                </button>
                <button type="button" className="btn-confirm btn-confirm--yes" onClick={handleDeleteConfirm} disabled={offline}>
                  예
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
function HistoryView({ history, sessionNotes = [], rounds = [], vitals = [], onRestore }) {
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

  function handleExportCsv() {
    const csv = buildHistoryCsv(filtered, sessionNotes, rounds, vitals)
    const stamp = new Date().toISOString().slice(0, 10)
    xDownload(`이용기록_${stamp}.csv`, csv, 'text/csv;charset=utf-8')
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
              inputMode="numeric" placeholder="차트번호 검색"
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

      {/* 내보내기 바 */}
      {filtered.length > 0 && (
        <div className="export-bar">
          <span className="export-bar__count">
            {hasFilter ? `검색 ${filtered.length}건` : `전체 ${filtered.length}건`}
          </span>
          <button type="button" className="export-btn" onClick={handleExportCsv}>
            <Icon name="arrow-up" /> CSV 내보내기
          </button>
        </div>
      )}

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
                <th></th>
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
                  <td>
                    <div className="dm-admin-edit-actions__buttons">
                      {/* 종료된 세션이라 스냅샷(공식본)이 열린다. 이 기능 이전 세션은 즉석 폴백. */}
                      {entry.sessionId && (
                        <button
                          type="button"
                          className="dm-note-btn"
                          onClick={() => openRecordFor(entry.sessionId)}
                        >
                          수액간호기록지
                        </button>
                      )}
                      {/* 실수로 종료한 것 되돌리기. 베드가 이미 찼으면 서버가 막는다. */}
                      {entry.sessionId && onRestore && (
                        <button
                          type="button"
                          className="dm-note-btn"
                          onClick={() => onRestore(entry)}
                        >
                          복귀
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── 로그인 화면 ────────────────────────────────────────────────
function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const account = await login(username.trim(), password)
      onLoginSuccess(account)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app login-screen">
      <div className="login-card">
        <h1 className="login-card__title">수액실 관리</h1>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">아이디</span>
            <input
              type="text"
              className="field__input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              type="password"
              className="field__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p role="alert" className="field__error">{error}</p>}
          <button
            type="submit"
            className="btn-register"
            disabled={submitting || !username.trim() || !password}
          >
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── 쪽지 메신저 ────────────────────────────────────────────────
// 받은 쪽지 하나 = 카드 하나. 헤더를 잡고 드래그해 옮길 수 있고, 확인/답장으로 닫는다.
// 위치를 안 잡은(=아직 안 옮긴) 카드는 cascade 기본 자리에 뜬다.
// 엔터로 전송, 쉬프트+엔터로 줄바꿈 — 슬랙·디스코드·카톡PC와 같은 관례.
//
// 한글 입력에서 엔터는 조합 중인 글자를 확정하는 키이기도 하다. 그대로 잡아버리면
// '안녕'을 치다 확정하려는 순간 쪽지가 날아간다. isComposing으로 조합 중을 걸러낸다.
// (일부 브라우저는 isComposing 대신 keyCode 229로만 알려줘서 둘 다 본다.)
function sendOnEnter(e, canSend, send) {
  if (e.key !== 'Enter' || e.shiftKey) return
  if (e.nativeEvent?.isComposing || e.keyCode === 229) return
  e.preventDefault() // 줄바꿈이 들어가지 않게
  if (canSend) send()
}

const MSG_CASCADE_STEP = 28
const MSG_CASCADE_MAX = 7 // 이보다 많이 쌓이면 더 밀지 않고 겹쳐 쌓는다

function MessageCard({ message, index, onClose, onMove }) {
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef(null)

  const pos = message.pos
  const step = Math.min(index, MSG_CASCADE_MAX) * MSG_CASCADE_STEP
  const style = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' }
    : { top: `${80 + step}px`, right: `${24 + step}px` }

  function handlePointerDown(e) {
    // 버튼 위에서 시작한 드래그는 무시 — 확인/답장 클릭을 잡아먹지 않게.
    if (e.target.closest('button')) return
    const card = e.currentTarget.closest('.msg-card')
    const rect = card.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height }
    onMove(message.id, { x: rect.left, y: rect.top })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e) {
    const d = dragRef.current
    if (!d) return
    // 화면 밖으로 완전히 빠져나가 못 잡는 일이 없게 가둔다.
    const x = Math.max(0, Math.min(window.innerWidth - d.w, e.clientX - d.dx))
    const y = Math.max(0, Math.min(window.innerHeight - d.h, e.clientY - d.dy))
    onMove(message.id, { x, y })
  }

  function handlePointerUp(e) {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  async function handleConfirm() {
    onClose(message.id)
    markMessageRead(message.id)
  }

  async function handleSendReply() {
    const text = replyText.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    try {
      await sendMessage({ to: message.from_account, content: text, inReplyTo: message.id })
      onClose(message.id) // 원본은 서버가 답장과 함께 읽음처리한다
    } catch (err) {
      setError(err.message ?? '전송 실패')
      setSending(false)
    }
  }

  return (
    <article className="msg-card" style={style}>
      <header
        className="msg-card__head"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <span className="msg-card__from">{message.from_name}</span>
        {message.broadcast_id && <span className="msg-card__badge">전체발송</span>}
      </header>

      {/* content는 React 기본 이스케이프로 텍스트 렌더 — dangerouslySetInnerHTML 금지 */}
      <p className="msg-card__body">{message.content}</p>

      {replying ? (
        <div className="msg-card__reply">
          <textarea
            className="msg-card__input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => sendOnEnter(e, !sending && !!replyText.trim(), handleSendReply)}
            maxLength={1000}
            rows={3}
            placeholder={`${message.from_name}님에게 답장`}
            aria-label="답장 내용"
            autoFocus
          />
          <p className="field__keyhint">엔터로 전송 · 쉬프트+엔터로 줄바꿈</p>
          {error && <p role="alert" className="msg-card__error">{error}</p>}
          <div className="msg-card__actions">
            <button type="button" className="msg-card__btn" onClick={() => setReplying(false)} disabled={sending}>
              취소
            </button>
            <button
              type="button"
              className="msg-card__btn msg-card__btn--primary"
              onClick={handleSendReply}
              disabled={sending || !replyText.trim()}
            >
              {sending ? '보내는 중…' : '보내기'}
            </button>
          </div>
        </div>
      ) : (
        <div className="msg-card__actions">
          <button type="button" className="msg-card__btn" onClick={handleConfirm}>
            확인
          </button>
          <button type="button" className="msg-card__btn msg-card__btn--primary" onClick={() => setReplying(true)}>
            답장
          </button>
        </div>
      )}
    </article>
  )
}

function ComposeMessageModal({ onClose, closing }) {
  const [recipients, setRecipients] = useState([])
  const [to, setTo] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    getRecipients()
      .then((r) => setRecipients(r.recipients ?? []))
      .catch((err) => setError(err.message ?? '받는 사람을 불러오지 못했습니다'))
  }, [])

  async function handleSend() {
    const text = content.trim()
    if (!text || !to || sending) return
    setSending(true)
    setError('')
    try {
      const result = await sendMessage({ to: to === 'all' ? 'all' : Number(to), content: text })
      setDone(result.sent ? `${result.sent}명에게 보냈습니다` : '보냈습니다')
      setTimeout(onClose, 700)
    } catch (err) {
      setError(err.message ?? '전송 실패')
      setSending(false)
    }
  }

  return (
    <div className={`modal-overlay modal-overlay--top${closing ? ' modal-overlay--closing' : ''}`}>
      <div className="modal modal--confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__header-title"><h2>쪽지 쓰기</h2></div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">받는 사람</span>
            <select className="field__input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">선택</option>
              <option value="all">전체발송</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.display_name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">내용</span>
            <textarea
              className="field__input msg-compose__text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => sendOnEnter(e, !sending && !!to && !!content.trim(), handleSend)}
              maxLength={1000}
              rows={5}
              placeholder="쪽지 내용 (1000자까지)"
            />
            <p className="field__keyhint">엔터로 전송 · 쉬프트+엔터로 줄바꿈</p>
          </label>
          {error && <p role="alert" className="field__error">{error}</p>}
          {done && <p role="status" className="msg-compose__done">{done}</p>}
          <button
            type="button"
            className="btn-register msg-compose__send"
            onClick={handleSend}
            disabled={sending || !to || !content.trim()}
          >
            {sending ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── App ────────────────────────────────────────────────────────
function App() {
  const [account, setAccount] = useState(null)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark')
  const tabViewRef = useRef(null)
  const prevTabRef = useRef('all')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('iv-theme', theme)
    } catch {
      /* localStorage 불가 환경 무시 */
    }
  }, [theme])
  const [authChecked, setAuthChecked] = useState(false)
  const [beds, setBeds] = useState([])
  const [staffList, setStaffList] = useState([])
  // 처방 작성 — 오더 항목은 DB가 원본이다(하드코딩 목록 없음).
  const [orderItems, setOrderItems] = useState([])
  const [orderBundles, setOrderBundles] = useState([])
  const [prescriptionBed, setPrescriptionBed] = useState(null)
  // { [code]: dose } — 키가 있으면 체크된 것. 단순 항목은 dose가 ''.
  // { [`${code}|${dose}`]: { code, dose, qty } } — 같은 항목을 용량만 달리해 두 번 담을 수 있다.
  const [orderChecks, setOrderChecks] = useState({})
  // 경로 박스는 항목에서 자동 계산한다. 여기엔 '자동과 다르게 손으로 켠/끈 것'만 남는다.
  const [routeOverride, setRouteOverride] = useState({})
  const [lineStaffId, setLineStaffId] = useState('')
  // 등록 시 선택하는 진료실. 선택 안 하면 '' → 서버에 NULL로 저장된다.
  const [examRoom, setExamRoom] = useState('')
  // 내원당시증상 — 예약 상세(투여 시작 폼)와 진행중 상세가 같은 상태를 쓴다.
  // 두 화면이 동시에 뜨지 않으므로 하나면 충분하다. 저장 경로만 다르다
  // (예약=투여 시작에 실려 나감 / 진행중=PATCH).
  const [visitSymptom, setVisitSymptom] = useState('')
  const [mixStaffId, setMixStaffId] = useState('')
  const [lookupInfo, setLookupInfo] = useState(null)
  const [actionError, setActionError] = useState('')
  const [history, setHistory] = useState([])
  const [sessionNotes, setSessionNotes] = useState([])
  const [rounds, setRounds] = useState([])
  const [vitals, setVitals] = useState([])
  // 직전 방문 증상(읽기전용 상기용). 진행중 상세를 열 때만 채운다.
  const [prevVisitSymptoms, setPrevVisitSymptoms] = useState([])
  const [activeTab, setActiveTab] = useState('all')
  // 탭 전환 시 좌/우 슬라이드 (요소 재마운트 없이 WAAPI로 — 뷰의 데이터/상태 유지)
  useEffect(() => {
    const el = tabViewRef.current
    const order = TABS.map((t) => t.id)
    const dir = order.indexOf(activeTab) >= order.indexOf(prevTabRef.current) ? 1 : -1
    prevTabRef.current = activeTab
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (el && el.animate && !reduce) {
      el.animate(
        [
          { opacity: 0.3, transform: `translateX(${dir * 60}%)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      )
    }
  }, [activeTab])
  const [selectedBed, setSelectedBed] = useState(null)
  const [cleanupBed, setCleanupBed] = useState(null)
  // 라인 제거 담당자 — 종료 확인 모달에서 고른다. 필수.
  const [endStaffId, setEndStaffId] = useState('')
  // 베드 상세에서 종료를 누른 경우, 종료를 취소하면 되돌아갈 베드. (완료 카드 직접 클릭이면 null)
  const [cleanupReopenBed, setCleanupReopenBed] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [chartNumber, setChartNumber] = useState('')
  // 이 방문의 특이사항(등록 모달 입력값). 재방문이면 조회 시 지난 값이 채워진다.
  const [specialNote, setSpecialNote] = useState('')
  // 2단 상세 오른쪽의 특이사항 인라인 편집
  const [specialNoteEditing, setSpecialNoteEditing] = useState(false)
  const [specialNoteDraft, setSpecialNoteDraft] = useState('')
  // 당일 메모(차트번호 기준, 방문을 넘어 유지) — 특이사항과 같은 인라인 편집 패턴.
  const [dayMemoEditing, setDayMemoEditing] = useState(false)
  const [dayMemoDraft, setDayMemoDraft] = useState('')
  // 배정 중 차트번호를 넣었을 때 뜨는 지난 메모 팝업. { chartNo, note } 또는 null.
  // 특이사항(기저질환) 기록이 있는 환자라는 안내. 등록 한 번에 한 번만 뜬다.
  // 차트번호 조회와 라인담당 지정은 순서가 정해져 있지 않아 양쪽 핸들러에서 같은 조건을 본다
  // — effect에 두면 setState-in-effect라 eslint 베이스라인(1건)을 넘는다.
  const [noteAlert, setNoteAlert] = useState(false)
  const noteAlertShownRef = useRef(false)
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION)
  const [now, setNow] = useState(Date.now())
  const [editPatientModal, setEditPatientModal] = useState(false)
  const [editPatientName, setEditPatientName] = useState('')
  const [editChartNumber, setEditChartNumber] = useState('')
  // 시작 시각 인라인 수정 — 열림 여부 + 편집 중인 값(ms)
  const [editStartOpen, setEditStartOpen] = useState(false)
  const [startDraft, setStartDraft] = useState(0)
  const [removePatientConfirm, setRemovePatientConfirm] = useState(false)
  const [movingBed, setMovingBed] = useState(null)
  const [moveBedAlert, setMoveBedAlert] = useState('')
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  // 기록 편집 — null이면 신규 작성, id가 있으면 그 레코드를 수정하는 모드.
  // 폼(특이사항·주의사항·라운딩)은 신규와 편집이 같은 것을 쓰고 저장 시점만 갈린다.
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [noteOccurredAt, setNoteOccurredAt] = useState(() => Date.now())
  const [noteSymptoms, setNoteSymptoms] = useState([])
  const [noteActions, setNoteActions] = useState([])
  const [noteMemo, setNoteMemo] = useState('')
  // 바이탈 기록 모달 — 카드 우상단 버튼과 2단 타임라인 편집이 함께 쓴다.
  const [vitalsModalBed, setVitalsModalBed] = useState(null)
  const [editingVitalsId, setEditingVitalsId] = useState(null)
  const [vitalsOccurredAt, setVitalsOccurredAt] = useState(Date.now())
  const [vitalsTemp, setVitalsTemp] = useState('')
  const [vitalsSys, setVitalsSys] = useState('')
  const [vitalsDia, setVitalsDia] = useState('')
  const [vitalsPulse, setVitalsPulse] = useState('')

  const [roundModalOpen, setRoundModalOpen] = useState(false)
  const [roundModalBedId, setRoundModalBedId] = useState(null)
  const [editingRoundId, setEditingRoundId] = useState(null)
  const [roundOccurredAt, setRoundOccurredAt] = useState(() => Date.now())
  const [roundMemo, setRoundMemo] = useState('')

  // ─── 쪽지 ──────────────────────────────────────────────────────
  // 받은 쪽지(살아있는 것만). 서버 폴링 결과로 갱신하되 카드의 드래그 위치(pos)는 보존한다.
  const [inboxMessages, setInboxMessages] = useState([])
  const [composeOpen, setComposeOpen] = useState(false)
  // 전체 채팅 — 창은 이 PC에만 기억한다(단말마다 화면이 다르다).
  // 마지막으로 본 메시지 id도 여기 둬야 다른 단말의 배지와 섞이지 않는다.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatLatestId, setChatLatestId] = useState(0)
  const [chatSeenId, setChatSeenId] = useState(() => Number(localStorage.getItem('infusion-room-chat-seen')) || 0)
  const chatUnread = Math.max(0, chatLatestId - chatSeenId)
  const [composeHeld, composeClosing] = useModalExit(composeOpen)

  // 확인·답장으로 닫은 쪽지 id. 읽음처리 요청이 서버에 반영되기 전에 폴링이 돌면
  // 아직 안읽음으로 내려와 카드가 되살아나므로, 그 사이를 이걸로 막는다.
  const closedMessageIdsRef = useRef(new Set())

  function closeMessageCard(id) {
    closedMessageIdsRef.current.add(id)
    setInboxMessages((prev) => prev.filter((m) => m.id !== id))
  }

  function moveMessageCard(id, pos) {
    setInboxMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pos } : m)))
  }

  // ESC로 열린 모달 닫기 — 위(top)에 뜬 것부터 하나씩. (HIG: 시트는 Esc/바깥탭으로 해제 가능)
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (composeOpen) setComposeOpen(false)
      else if (noteModalOpen) setNoteModalOpen(false)
      else if (roundModalOpen) setRoundModalOpen(false)
      else if (removePatientConfirm) setRemovePatientConfirm(false)
      else if (editPatientModal) setEditPatientModal(false)
      else if (cleanupBed) setCleanupBed(null)
      else if (movingBed) setMovingBed(null)
      else if (selectedBed) closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeOpen, noteModalOpen, roundModalOpen, removePatientConfirm, editPatientModal, cleanupBed, movingBed, selectedBed])

  // 쪽지 10분 휘발 — 폴링(≤3초)으로도 빠지지만, 정확히 10:00에 사라지게 하는 보조 타이머.
  useEffect(() => {
    if (inboxMessages.length === 0) return
    const timer = setInterval(() => {
      const serverNow = Date.now() + clockOffsetRef.current
      setInboxMessages((prev) => prev.filter((m) => serverNow - m.created_at < MESSAGE_TTL_MS))
    }, 1000)
    return () => clearInterval(timer)
  }, [inboxMessages.length])

  // 헤더 초상화 한마디 — 누를 때마다 랜덤 한 줄, 잠시 뒤 사라진다.
  const [bossLine, setBossLine] = useState(null)
  const bossTimerRef = useRef(null)
  const [patientViewSeed, setPatientViewSeed] = useState(null)
  const [collapsedRooms, setCollapsedRooms] = useState(() => new Set())

  // 오프라인 폴백 — 서버 폴링이 연속 실패하면 읽기 전용으로 전환하고 마지막 화면을 유지한다.
  // lastSyncAt은 "지금 보이는 정보가 언제 기준인지"(배너의 N분 전). 캐시에서 복구할 수도 있어
  // 초기값을 localStorage에서 읽어온다.
  const [offline, setOffline] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)

  // 서버 시각 기준 시계 — 클라이언트 시계가 틀려도 서버와 동일한 여유/곧/밀림 판정이 나오게 함.
  // clockOffsetRef = server_now - Date.now()(마지막 동기화 시점). now = Date.now() + offset.
  const clockOffsetRef = useRef(0)
  const revisionRef = useRef(null)
  const isModalBusyRef = useRef(false)
  // 폴링 루프(=[account] 한 번만 생성)에서 최신 refreshRecords를 부르기 위한 참조.
  // refreshRecords를 effect 의존성에 직접 넣으면 매 렌더마다 폴링이 재생성돼서 ref로 우회한다.
  const refreshRecordsRef = useRef(null)
  // 등록 잠금 하트비트 타이머. 빈 베드 모달이 열려 있는 동안만 돈다.
  const lockHeartbeatRef = useRef(null)
  // 등록창 마지막 사용자 상호작용 시각. 무입력 방치 감지용.
  const lockActivityRef = useRef(0)

  const hasActiveSessions = beds.some((bed) => bed.status !== 'vacant')

  // deleted: true 항목은 이용기록·통계·환자조회에서 제외
  const activeHistory = history.filter((e) => !e.deleted)

  useEffect(() => {
    getCurrentAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    if (!account) return
    refreshBoard()
    refreshRecords()
  }, [account])

  // 참조 데이터(직원 목록·오더 항목·묶음처방) — 거의 안 바뀌므로 로그인 후 받아 캐시한다.
  //
  // 예전에는 한 번만 받고 실패하면 console.error만 찍었다. 그러면 목록이 빈 배열로 굳어
  // **드롭다운에 고를 것이 없어진다** — 실제로 "라인 제거 담당자를 못 골라 종료가 안 되고,
  // 앱을 껐다 켜니 됐다"로 보고됐다. deploy.bat이 서비스를 재시작하는 순간이나 순간적인
  // 끊김이면 충분히 걸린다. 처방 체크리스트가 텅 비는 것도 같은 원인이었다.
  //
  // 그래서 실패하면 보드 폴링과 같은 간격(3→6→12→24→30초)으로 다시 받는다.
  // setState가 전부 async 콜백 안이라 setState-in-effect 규칙에 걸리지 않는다.
  useEffect(() => {
    if (!account) return
    let cancelled = false
    let timer

    async function loadReference(attempt = 0) {
      try {
        const [staff, items, bundles] = await Promise.all([
          getStaffList(), getOrderItems(), getOrderBundles(),
        ])
        if (cancelled) return
        setStaffList(staff)
        setOrderItems(items)
        setOrderBundles(bundles)
      } catch (err) {
        if (cancelled) return
        const wait = Math.min(30000, 3000 * 2 ** attempt)
        console.error(`참조 데이터 로딩 실패 — ${wait / 1000}초 후 재시도`, err)
        timer = setTimeout(() => loadReference(attempt + 1), wait)
      }
    }
    loadReference()

    return () => { cancelled = true; clearTimeout(timer) }
  }, [account])

  // 열려 있는 모달(배정/시작 폼, 라운딩, 베드이동, 정리 확인)이 있는 동안은 폴링이
  // beds를 갈아치우지 않게 막는다 — 입력 중인 내용이나 방금 연 폼이 갱신 때문에 바뀌면 안 됨.
  useEffect(() => {
    isModalBusyRef.current = !!(selectedBed || roundModalOpen || movingBed || cleanupBed)
  }, [selectedBed, roundModalOpen, movingBed, cleanupBed])

  // 보드 폴링 — 화면 표시 중 3초 / 백그라운드 탭 30초, 연속 실패 시 3→6→12→30초로 늘어남.
  useEffect(() => {
    if (!account) return
    let cancelled = false
    let timeoutId = null
    let consecutiveFailures = 0
    const FAILURE_DELAYS_MS = [3000, 6000, 12000, 30000]
    // 한 번 삐끗한 걸로 배너를 번쩍이게 하지 않는다. 3초 간격이라 2번이면 약 6초.
    const OFFLINE_AFTER_FAILURES = 2

    function nextDelay() {
      if (document.visibilityState !== 'visible') return 30000
      return FAILURE_DELAYS_MS[Math.min(consecutiveFailures, FAILURE_DELAYS_MS.length - 1)]
    }

    async function poll() {
      if (cancelled) return
      try {
        const result = await getBoard(revisionRef.current)
        if (!cancelled) {
          clockOffsetRef.current = result.serverNow - Date.now()
          if (!result.unchanged && !isModalBusyRef.current) {
            setBeds(result.beds)
            revisionRef.current = result.revision
            // 서버 상태가 바뀌었다 = 다른 단말이 특이사항·라운딩·종료 등을 했을 수 있다.
            // 보드만 갱신하면 카드의 note_count는 맞지만 특이사항 내용·이용기록은 옛것이라
            // 기록(history/rounds/notes)도 함께 다시 불러 실시간 반영한다.
            refreshRecordsRef.current?.()
          }
          // unchanged든 아니든 서버와 통신에 성공한 시점 = 지금 보이는 정보의 기준 시각.
          setLastSyncAt(result.serverNow)
          setOffline(false)
          consecutiveFailures = 0
        }
        // 쪽지 수신 — 타이머를 새로 만들지 않고 이 루프에 얹는다.
        // 쪽지 쪽 실패가 보드 폴링·오프라인 판정을 건드리면 안 되므로 try/catch를 따로 둔다.
        try {
          const inbox = await getInbox()
          if (!cancelled) {
            // 서버가 준 "살아있는 목록"으로 맞추되, 이미 떠 있는 카드의 드래그 위치는 보존한다.
            const closed = closedMessageIdsRef.current
            const live = inbox.messages.filter((m) => !closed.has(m.id))
            // 서버가 더는 안 주는 id는 읽음처리가 반영된 것 — 기억해둘 필요가 없어졌다.
            const stillPending = new Set(inbox.messages.map((m) => m.id))
            for (const id of closed) if (!stillPending.has(id)) closed.delete(id)
            setInboxMessages((prev) => {
              const posById = new Map(prev.map((m) => [m.id, m.pos]))
              return live.map((m) => ({ ...m, pos: posById.get(m.id) ?? null }))
            })
          }
        } catch (err) {
          console.error('쪽지 수신 실패', err)
        }
      } catch (err) {
        console.error('보드 폴링 실패', err)
        consecutiveFailures += 1
        if (!cancelled && consecutiveFailures >= OFFLINE_AFTER_FAILURES) {
          setOffline(true)
        }
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, nextDelay())
      }
    }

    timeoutId = setTimeout(poll, nextDelay())
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [account])

  // offline도 조건에 넣는다 — 진행 중인 세션이 없으면 now가 안 도는데,
  // 그러면 오프라인 배너의 "N분 전"이 멈춰 있게 된다.
  useEffect(() => {
    if (!hasActiveSessions && !offline) return
    const timer = setInterval(() => setNow(Date.now() + clockOffsetRef.current), 1000)
    return () => clearInterval(timer)
  }, [hasActiveSessions, offline])

  useEffect(() => {
    setBeds((prev) => {
      let changed = false
      const next = prev.map((bed) => {
        const updated = markCompletedIfNeeded(bed, now)
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
    { occupied: 0, warning: 0, completed: 0, vacant: 0, reserved: 0 },
  )

  const roomGroups =
    activeTab === 'all'
      ? ROOM_ORDER.map((room) => ({
          room,
          roomBeds: sortBedsByNumber(beds.filter((bed) => bed.room === room.id)),
        }))
      : null

  // 몰아보기 힌트(A-4): 방 id → 그 방에 due(밀림)가 있는지. 탭과 무관하게 항상 beds 전체 기준.
  const roomDueMap = {}
  for (const room of ROOM_ORDER) {
    roomDueMap[room.id] = getRoomHasDue(
      beds.filter((bed) => bed.room === room.id),
      rounds,
      now,
    )
  }

  // 모달 닫힘 모션용 — 값이 비워져도 나가는 애니메이션 동안은 마지막 값을 유지한다.
  const [selectedBedHeld, selectedBedClosing] = useModalExit(selectedBed)

  // ── genie(요술램프) 프레젠테이션 ──────────────────────────────────
  // 베드 모달이 '방금 누른 카드'에서 확대되며 나타나고, 닫힐 때 그 카드로 축소되며 빨려들어간다.
  const modalOriginRef = useRef(null)   // 소스 카드의 화면 좌표
  const bedModalRef = useRef(null)      // 베드 모달 .modal 요소
  useEffect(() => {
    const el = bedModalRef.current
    if (!el) return
    const origin = modalOriginRef.current
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (!origin || reduce) return // 소스(카드) 없으면 CSS 기본 모션에 맡긴다
    el.style.animation = 'none'   // genie는 WAAPI가 직접 제어
    const m = el.getBoundingClientRect()
    if (!m.width || !m.height) return
    const dx = (origin.left + origin.width / 2) - (m.left + m.width / 2)
    const dy = (origin.top + origin.height / 2) - (m.top + m.height / 2)
    const scale = Math.max(0.12, Math.min(origin.width / m.width, origin.height / m.height))
    const atCard = `translate(${dx}px, ${dy}px) scale(${scale})`
    const centered = 'translate(0, 0) scale(1)'
    if (!selectedBedClosing) {
      el.animate(
        [{ transform: atCard, opacity: 0 }, { transform: centered, opacity: 1 }],
        { duration: 440, easing: 'cubic-bezier(0.32, 1.25, 0.5, 1)', fill: 'both' },
      )
    } else {
      el.animate(
        [{ transform: centered, opacity: 1 }, { transform: atCard, opacity: 0 }],
        { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'both' },
      )
    }
  }, [selectedBedHeld, selectedBedClosing])
  const [cleanupBedHeld, cleanupBedClosing] = useModalExit(cleanupBed)
  const [removeConfirmHeld, removeConfirmClosing] = useModalExit(removePatientConfirm)
  const [editPatientHeld, editPatientClosing] = useModalExit(editPatientModal)
  const [noteModalHeld, noteModalClosing] = useModalExit(noteModalOpen)
  const [roundModalHeld, roundModalClosing] = useModalExit(roundModalOpen)
  const [roundModalBedIdHeld] = useModalExit(roundModalBedId)

  // currentBed는 붙잡힌 selectedBed에서 만든다 — 닫히는 동안 환자명·차트번호가 사라지면
  // 모달이 빈 껍데기로 줄어드는 게 보인다. 그 위에 겹치는 모달들(등록취소 확인·정보수정·특이사항)도
  // currentBed를 쓰므로 같이 살아 있어야 한다.
  const currentBed = selectedBedHeld
    ? beds.find((bed) => bed.id === selectedBedHeld.id) ?? selectedBedHeld
    : null
  // 라운딩 모달은 베드 상세와 별개 상태로 대상을 들고 있음(selectedBed 딸림 방지, A-5)
  const roundModalBed = roundModalBedIdHeld
    ? beds.find((bed) => bed.id === roundModalBedIdHeld) ?? null
    : null
  const isVacant = currentBed?.status === 'vacant'
  const isReserved = currentBed?.status === 'reserved'
  const isInProgress = currentBed?.status === 'in-progress'
  const currentBedIsWarning = isInProgress ? getBedProgress(currentBed, now).isWarning : false
  // 오른쪽 기록 패널용 — 이번 세션의 특이사항·라운딩만 시각순으로. 과거 세션 것은 안 띄운다.
  const currentBedEvents = isInProgress && currentBed?.sessionId
    ? xEditableEvents(currentBed.sessionId, sessionNotes, rounds, vitals)
    : []
  const currentBedChipCategory = currentBedIsWarning ? 'warning' : 'occupied'
  const currentBedChipLabel = currentBedIsWarning ? '곧 완료' : '진행중'

  // 진료실 정정(오등록 대비) — 예약·진행중 상세가 같은 것을 쓴다. 고르는 즉시 저장.
  async function handleChangeExamRoom(value) {
    if (!currentBed?.sessionId) return
    setActionError('')
    try {
      await editSessionExamRoom(currentBed.sessionId, value)
      await refreshBoard()
    } catch (err) {
      setActionError(err.message)
    }
  }

  const examRoomField = currentBed && (
    <label className="field">
      <span className="field__label">진료실</span>
      <select
        className="field__input"
        value={currentBed.examRoom ?? ''}
        onChange={(e) => handleChangeExamRoom(e.target.value)}
        disabled={offline}
      >
        {/* 진료실 필수화 이전에 배정된 세션은 값이 비어 있다 — 그 상태를 보여주되
            다시 '선택'으로 되돌리지는 못하게 한다(서버도 비우기를 400으로 막는다). */}
        <option value="" disabled>선택</option>
        {EXAM_ROOMS.map((room) => (
          <option key={room} value={room}>{room}진료실</option>
        ))}
      </select>
    </label>
  )

  // 내원당시증상 입력은 3a단계에서 '처방 작성' 모달로 옮겼다(투여 시작과 분리).


  // 직전 방문 증상 상기 — 진행중 상세를 열 때 한 번 조회한다.
  // 상기용이라 실패해도 조용히 비운다(모달 동작을 막으면 안 됨).
  const prevVisitPatientId = isInProgress ? currentBed?.patientId : null
  const prevVisitSessionId = isInProgress ? currentBed?.sessionId : null
  useEffect(() => {
    if (!prevVisitPatientId || !prevVisitSessionId) return undefined
    let cancelled = false
    getPatientSessionNotes(prevVisitPatientId)
      .then((notes) => {
        if (cancelled) return
        // id가 방문 순서(autoincrement)라 현재보다 작은 것 중 가장 큰 세션 = 직전 방문
        const prevSessionId = notes
          .map((n) => n.session_id)
          .filter((sid) => sid < prevVisitSessionId)
          .reduce((max, sid) => (sid > max ? sid : max), -Infinity)
        const labels = [...new Set(
          notes.filter((n) => n.session_id === prevSessionId && !n.deleted)
            .flatMap((n) => n.symptoms ?? []),
        )].map((code) => SYMPTOM_OPTIONS.find((o) => o.code === code)?.label).filter(Boolean)
        setPrevVisitSymptoms(labels)
      })
      .catch(() => { if (!cancelled) setPrevVisitSymptoms([]) })
    return () => {
      cancelled = true
      setPrevVisitSymptoms([])
    }
  }, [prevVisitPatientId, prevVisitSessionId])

  // 초상화 클릭 — 이미 떠 있으면 즉시 다음 줄로 갈아끼운다(타이머도 다시 시작).
  function handleBossClick() {
    clearTimeout(bossTimerRef.current)
    setBossLine((prev) => pickBossLine(prev))
    bossTimerRef.current = setTimeout(() => setBossLine(null), BOSS_LINE_MS)
  }

  // 말풍선이 떠 있는 채로 화면을 벗어나도 타이머가 남지 않게
  useEffect(() => () => clearTimeout(bossTimerRef.current), [])

  // 언마운트(로그아웃 등) 시 등록 잠금 하트비트 타이머 정리
  useEffect(() => () => clearInterval(lockHeartbeatRef.current), [])

  // 빈 베드 등록 모달이 열려 있는 동안, 사용자 상호작용마다 마지막 입력 시각 갱신(무입력 방치 감지용)
  useEffect(() => {
    if (selectedBed?.status !== 'vacant') return
    const bump = () => { lockActivityRef.current = Date.now() }
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [selectedBed?.status])

  function toggleRoomCollapse(roomId) {
    setCollapsedRooms((prev) => {
      const next = new Set(prev)
      next.has(roomId) ? next.delete(roomId) : next.add(roomId)
      return next
    })
  }

  // 액션(배정/시작/종료 등) 직후 호출 — 폴링과 달리 항상 즉시 반영해야 하므로
  // isModalBusyRef를 보지 않는다(내가 방금 연 모달이 그 대상이라 오히려 반영이 필요함).
  // 채팅을 본 시점을 이 PC에 남긴다 — 새로고침해도 배지가 되살아나지 않게.
  function markChatSeen(latestId) {
    if (!Number.isFinite(latestId) || latestId <= 0) return
    setChatSeenId((prev) => {
      if (latestId <= prev) return prev
      try {
        localStorage.setItem('infusion-room-chat-seen', String(latestId))
      } catch {
        // 저장 실패해도 이번 세션 동안은 배지가 정상 동작한다
      }
      return latestId
    })
  }

  async function refreshBoard() {
    try {
      const result = await getBoard(revisionRef.current)
      clockOffsetRef.current = result.serverNow - Date.now()
      setNow(result.serverNow)
      if (!result.unchanged) {
        setBeds(result.beds)
        revisionRef.current = result.revision
      }
      // 채팅 배지 — 창이 닫혀 있어도 이 값으로 새 메시지 여부를 안다(추가 요청 없음).
      // unchanged 응답에도 실려 온다(채팅은 보드 revision을 올리지 않으므로).
      if (Number.isFinite(result.chatLatestId)) setChatLatestId(result.chatLatestId)
      setLastSyncAt(result.serverNow)
      setOffline(false)
    } catch (err) {
      console.error('보드 갱신 실패', err)
      // 서버가 이미 죽은 채로 접속·새로고침한 경우 — 캐시라도 띄워서 마지막 화면을 보여준다.
      // revisionRef가 아직 null = 이번 세션에서 board를 한 번도 못 받았다는 뜻.
      // 이미 받은 적이 있으면(액션 직후 갱신 실패) 화면을 캐시로 되돌리지 않고 그대로 둔다.
      if (revisionRef.current === null) {
        const cached = readBoardCache()
        if (cached) {
          setBeds(cached.beds)
          setLastSyncAt(cached.cachedAt)
        }
      }
      setOffline(true)
    }
  }

  async function refreshRecords() {
    try {
      const [nextHistory, nextRounds, nextSessionNotes, nextVitals] = await Promise.all([
        loadHistory(), loadRounds(), loadSessionNotes(), loadVitals(),
      ])
      setHistory(nextHistory)
      setRounds(nextRounds)
      setSessionNotes(nextSessionNotes)
      setVitals(nextVitals)
    } catch (err) {
      console.error('기록 갱신 실패', err)
    }
  }

  // 폴링 루프가 항상 최신 refreshRecords를 부르도록 ref를 갱신해둔다.
  useEffect(() => {
    refreshRecordsRef.current = refreshRecords
  })

  async function handleLogout() {
    try {
      await logout()
    } catch (err) {
      console.error('로그아웃 실패', err)
    }
    setAccount(null)
  }

  // DataManageView는 로컬 배열을 직접 map/filter해서 새 배열을 넘긴다(선택 삭제/복구,
  // deleted·active 토글). 여기서 이전 값과 비교해 실제로 바뀐 것만 서버에 반영한다 —
  // 필드 하나짜리 boolean 토글이라 diff가 모호할 일이 없어 beds 때와 달리 안전하다.
  async function updateHistoryWithSync(updater) {
    const prevArr = history
    const nextArr = typeof updater === 'function' ? updater(prevArr) : updater
    setHistory(nextArr)
    const prevById = new Map(prevArr.map((e) => [e.id, e]))
    const changed = nextArr.filter((e) => {
      const old = prevById.get(e.id)
      return old && old.deleted !== e.deleted && e.sessionId
    })
    try {
      await Promise.all(changed.map((e) => toggleHistoryDeleted(e.sessionId, e.deleted)))
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function updateSessionNotesWithSync(updater) {
    const prevArr = sessionNotes
    const nextArr = typeof updater === 'function' ? updater(prevArr) : updater
    setSessionNotes(nextArr)
    const prevById = new Map(prevArr.map((n) => [n.id, n]))
    const changed = nextArr.filter((n) => {
      const old = prevById.get(n.id)
      return old && old.deleted !== n.deleted
    })
    try {
      await Promise.all(changed.map((n) => toggleSessionNoteDeleted(n.id, n.deleted)))
    } catch (err) {
      setActionError(err.message)
    }
  }

  // 차트 조회 결과와 라인담당이 둘 다 갖춰졌을 때만, 그리고 한 번만 띄운다.
  function maybeAlertBaselineNote(info, staffId) {
    if (noteAlertShownRef.current) return
    if (!info?.baseline_note || !staffId) return
    noteAlertShownRef.current = true
    setNoteAlert(true)
  }

  async function handleChartNumberBlur() {
    const trimmed = chartNumber.trim()
    if (!trimmed) {
      setLookupInfo(null)
      return
    }
    try {
      const result = await lookupPatient(trimmed)
      setLookupInfo(result)
      maybeAlertBaselineNote(result, lineStaffId)
      if (result.found && !patientName.trim()) {
        setPatientName(result.name)
      }
      // 특이사항(기저질환) 정본을 칸에 채워준다. 이미 뭔가 입력한 상태면 덮지 않는다.
      // 여기서 채운 값을 근무자가 고치면 그게 곧 새 정본이 된다(서버가 함께 쓴다).
      if (result.baseline_note && !specialNote.trim()) {
        setSpecialNote(result.baseline_note)
      }
      // 팝업은 여기서 띄우지 않는다 — 라인담당까지 지정돼 '환자 조회가 성립'한 뒤에
      // 안내 모달이 뜬다(아래 effect). 차트번호를 나중에 입력하는 순서도 있어서
      // select의 onChange에만 걸면 그 경우 안 뜬다.
    } catch {
      setLookupInfo(null)
    }
  }

  function openModal(bed) {
    setSelectedBed(bed)
    setActionError('')
    setEditStartOpen(false)
    if (bed.status === 'vacant') {
      setPatientName('')
      setChartNumber('')
      setLineStaffId('')
      setLookupInfo(null)
      setSpecialNote('')
      setExamRoom('')
      // 새 등록이니 안내를 다시 띄울 수 있게 되돌린다.
      noteAlertShownRef.current = false
      setNoteAlert(false)
    }
    if (bed.status === 'reserved') {
      setDurationMinutes(DEFAULT_DURATION)
      setMixStaffId('')
    }
  }

  // 등록 잠금: 빈 베드 모달을 여는 동안 잠금을 걸고 30초마다 하트비트로 유지한다.
  // 단, LOCK_IDLE_MS 동안 무입력이면 방치로 보고 모달을 닫아 잠금을 자동 해제한다.
  function startLockHeartbeat(code) {
    clearInterval(lockHeartbeatRef.current)
    lockActivityRef.current = Date.now()
    lockHeartbeatRef.current = setInterval(() => {
      if (Date.now() - lockActivityRef.current > LOCK_IDLE_MS) {
        // 무입력 방치 — closure의 code로 확실히 잠금 해제(하트비트도 정지)한 뒤 모달 닫기.
        // closeModal은 selectedBed를 참조하는데 이 콜백이 캡처한 값이 낡을 수 있어, 해제는 여기서 직접 한다.
        stopLockAndRelease(code)
        closeModal()
        return
      }
      acquireBedLock(code).catch(() => {})
    }, 30000)
  }

  function stopLockAndRelease(code) {
    clearInterval(lockHeartbeatRef.current)
    lockHeartbeatRef.current = null
    if (code) releaseBedLock(code)
  }

  async function handleBedClick(bed, sourceEl) {
    // genie(요술램프)용 — 방금 누른 카드의 화면 위치를 기억해뒀다가 모달을 그 지점에서 확대/축소.
    if (sourceEl && sourceEl.getBoundingClientRect) modalOriginRef.current = sourceEl.getBoundingClientRect()
    // 이동 모드일 때 우선 처리
    if (movingBed) {
      handleMoveToBed(bed)
      return
    }
    if (bed.status === 'completed') {
      setEndStaffId('') // 종료 확인마다 라인 제거 담당자를 새로 고르게 한다
      setCleanupBed(bed)
      return
    }
    if (bed.status === 'vacant') {
      if (bed.lockedBy) return // 남이 등록 중 — 카드도 비활성이지만 방어
      try {
        await acquireBedLock(bed.id) // 남이 방금 선점했으면 409 → 모달 안 열림
      } catch (err) {
        setMoveBedAlert(err.message || '다른 사람이 등록 중입니다.')
        refreshBoard() // 잠금 상태를 즉시 반영
        return
      }
      startLockHeartbeat(bed.id)
    }
    openModal(bed)
  }

  function closeModal() {
    // 빈 베드 등록 모달을 닫는 거면 잠금 해제(취소로 간주).
    if (selectedBed?.status === 'vacant') stopLockAndRelease(selectedBed.id)
    setSelectedBed(null)
    setEditStartOpen(false)
    // 모달이 열려 있는 동안은 폴링이 보드 갱신을 미룬다(입력 보호).
    // 닫는 즉시 한 번 강제 동기화해서, 그 사이 다른 단말이 건 잠금·변경을 바로 반영한다.
    refreshBoard()
  }

  // 베드 상세에서 "종료"를 누르면 상세 모달을 닫고 종료 확인 모달을 띄운다.
  // 종료를 취소(아니오)하면 원래 보던 상세 모달로 되돌아가게 reopen 대상을 기억해둔다.
  function requestCleanupFromDetail() {
    if (!currentBed) return
    setCleanupReopenBed(currentBed)
    setSelectedBed(null)
    setEndStaffId('') // 종료할 때마다 새로 고르게 한다(직전 선택이 남아 오선택되면 안 됨)
    setCleanupBed(currentBed)
  }

  function closeCleanupConfirm() {
    setCleanupBed(null)
    // 상세에서 온 종료였으면 그 상세 모달을 다시 연다.
    if (cleanupReopenBed) {
      openModal(cleanupReopenBed)
      setCleanupReopenBed(null)
    }
  }

  // 정리 확인 모달에서 시간추가 — '완료'는 서버 종료가 아니라 클라 계산이라
  // (markCompletedIfNeeded) ended_at은 아직 NULL이다. 그래서 예정시간만 늘리면
  // 카드가 그대로 진행중으로 되돌아온다.
  //
  // 기존 예정시간에 그냥 더하면 안 된다 — 이미 초과된 상태라 '예정+30'이 여전히
  // 경과보다 작을 수 있고, 그러면 눌러도 완료가 안 풀린다. 경과와 예정 중 큰 값을
  // 기준으로 더해 확실히 진행중이 되게 한다.
  async function handleAddTimeFromCleanup(addMinutes) {
    if (!cleanupBed) return
    const elapsedMin = cleanupBed.startTime
      ? Math.ceil((now - cleanupBed.startTime) / 60000)
      : 0
    const base = Math.max(cleanupBed.durationMinutes ?? 0, elapsedMin)
    const nextDuration = Math.max(MIN_DURATION, base + addMinutes)
    try {
      await adjustSessionDuration(cleanupBed.sessionId, nextDuration)
      await refreshBoard()
      setCleanupBed(null)
      setCleanupReopenBed(null)
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleCleanupYes() {
    if (!cleanupBed) return
    const endTime = now
    try {
      await endSession(cleanupBed.sessionId, endTime, Number(endStaffId))
      await refreshBoard()
      await refreshRecords()
      closeModal()
    } catch (err) {
      setActionError(err.message)
    }
    setCleanupBed(null)
    setCleanupReopenBed(null)
  }

  function adjustDuration(delta) {
    setDurationMinutes((prev) => Math.max(MIN_DURATION, prev + delta))
  }

  async function adjustBedDuration(delta) {
    if (!selectedBed || !currentBed) return

    const nextDuration = Math.max(MIN_DURATION, currentBed.durationMinutes + delta)
    try {
      await adjustSessionDuration(currentBed.sessionId, nextDuration)
      await refreshBoard()
    } catch (err) {
      setActionError(err.message)
    }
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

  async function handleMoveToBed(targetBed) {
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

    try {
      await moveBedSession(movingBed.sessionId, targetBed.id)
      await refreshBoard()
    } catch (err) {
      // 그 사이 다른 곳에서 같은 베드를 배정했을 수 있음(409) — 이동 모드는 유지, 다른 베드 재선택 가능
      setMoveBedAlert(err.message)
      return
    }

    // 이동한 수액실 탭으로 전환
    setActiveTab(targetBed.room)
    setMovingBed(null)
    setMoveBedAlert('')
  }

  async function handleRemovePatientConfirm() {
    if (!selectedBed) return
    try {
      await cancelSession(selectedBed.sessionId)
      await refreshBoard()
    } catch (err) {
      setActionError(err.message)
    }
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

  async function handleSavePatientEdit() {
    if (!editPatientName.trim() || !editChartNumber.trim() || !selectedBed) return
    try {
      await updateSessionPatient(selectedBed.sessionId, {
        patientName: editPatientName.trim(),
        chartNo: editChartNumber.trim(),
      })
      await refreshBoard()
    } catch (err) {
      setActionError(err.message)
      return
    }
    setEditPatientModal(false)
  }

  function openStartEdit() {
    if (!currentBed?.startTime) return
    setActionError('')
    setStartDraft(currentBed.startTime)
    setEditStartOpen(true)
  }

  // 시작 시각은 시:분만 바꾼다(같은 날 기준). 날짜 부분은 기존 시작시각을 그대로 쓴다.
  function setStartDraftTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return
    const next = new Date(startDraft)
    next.setHours(h, m, 0, 0)
    setStartDraft(next.getTime())
  }

  async function handleSaveStartEdit() {
    if (!selectedBed) return
    setActionError('')
    try {
      await updateSessionStartedAt(selectedBed.sessionId, startDraft)
      await refreshBoard()
    } catch (err) {
      setActionError(err.message)
      return
    }
    setEditStartOpen(false)
  }

  // record를 주면 그 값으로 폼을 채운 '편집 모드', 안 주면 빈 폼(신규 작성).
  function openNoteModal(record) {
    if (!currentBed) return
    setActionError('')
    setEditingNoteId(record?.id ?? null)
    setNoteOccurredAt(record ? new Date(getNoteOccurredAt(record)).getTime() : now)
    setNoteSymptoms(record?.symptoms ?? [])
    setNoteActions(record?.actions ?? [])
    setNoteMemo(record?.memo ?? '')
    setNoteModalOpen(true)
  }

  function closeNoteModal() {
    setNoteModalOpen(false)
    setEditingNoteId(null)
  }

  // record를 주면 편집 모드(prefill), 없으면 신규 기록.
  function openVitalsModal(bed, record) {
    const target = bed ?? currentBed
    if (!target) return
    setVitalsModalBed(target)
    setActionError('')
    setEditingVitalsId(record?.id ?? null)
    setVitalsOccurredAt(record ? new Date(record.occurredAt).getTime() : now)
    setVitalsTemp(record?.temperature != null ? String(record.temperature) : '')
    setVitalsSys(record?.bpSystolic != null ? String(record.bpSystolic) : '')
    setVitalsDia(record?.bpDiastolic != null ? String(record.bpDiastolic) : '')
    setVitalsPulse(record?.pulse != null ? String(record.pulse) : '')
  }

  function closeVitalsModal() {
    setVitalsModalBed(null)
    setEditingVitalsId(null)
  }

  // ─── 처방 작성 ────────────────────────────────────────────────────
  // 투여 시작과 독립된 동작이다 — 예약·진행중 어느 쪽에서든 열리고, 순서를 강제하지 않는다
  // (급하면 투약 먼저 하고 기록은 나중에).
  async function openPrescriptionModal(bed) {
    const target = bed ?? currentBed
    if (!target?.sessionId) return
    setPrescriptionBed(target)
    setActionError('')
    setOrderChecks({})
    setRouteOverride({})
    setVisitSymptom('')
    try {
      const saved = await getPrescription(target.sessionId)
      const checks = {}
      const savedRoutes = new Set()
      saved.items.forEach((it) => {
        if (ROUTE_CODES.includes(it.code)) { savedRoutes.add(it.code); return }
        checks[checkKey(it.code, it.dose)] = { code: it.code, dose: it.dose ?? '', qty: it.qty ?? 1 }
      })
      // 저장된 경로가 자동 계산과 다르면 그 차이만 수동 보정으로 기억한다 — 손으로 켠 IM이
      // 항목을 하나 더 고치는 순간 사라지면 안 된다.
      const auto = autoRouteCodes(checks, orderItems)
      const override = {}
      ROUTE_CODES.forEach((code) => {
        if (savedRoutes.has(code) !== auto.has(code)) override[code] = savedRoutes.has(code)
      })
      setOrderChecks(checks)
      setRouteOverride(override)
      setVisitSymptom(saved.visit_symptom ?? '')
    } catch (err) {
      setActionError(err.message)
    }
  }

  function closePrescriptionModal() {
    setPrescriptionBed(null)
  }

  // 단순 항목: 있으면 빼고 없으면 넣는다.
  function toggleOrderItem(code) {
    setOrderChecks((prev) => {
      const next = { ...prev }
      const key = checkKey(code, '')
      if (key in next) delete next[key]
      else next[key] = { code, dose: '', qty: 1 }
      return next
    })
  }

  // 용량 항목: 용량 버튼 자체가 체크다. 같은 용량을 다시 누르면 해제.
  // 이렇게 하면 "체크됐는데 용량이 비어 있는" 상태가 구조적으로 생기지 않는다
  // (기록지에 용량 빈 칸이 나가면 안 되므로).
  // 용량끼리는 독립이다 — NS 180과 110을 함께 투약하는 처방이 있어 교체가 아니라 각각 체크된다.
  function selectOrderDose(code, dose) {
    setOrderChecks((prev) => {
      const next = { ...prev }
      const key = checkKey(code, dose)
      if (key in next) delete next[key]
      else next[key] = { code, dose, qty: 1 }
      return next
    })
  }

  // 자유입력 항목(증류수 mL): 값이 있으면 체크, 비우면 해제.
  // 키에 dose를 넣지 않는다 — 타이핑마다 키가 바뀌면 입력이 끊긴다.
  function setOrderFreeText(code, value) {
    setOrderChecks((prev) => {
      const next = { ...prev }
      const key = checkKey(code, '')
      if (value.trim() === '') delete next[key]
      else next[key] = { code, dose: value, qty: 1 }
      return next
    })
  }

  // 수량: 타이핑값도 ▲▼도 여기로 온다. 숫자가 아닌 입력은 버리고 1~99로 묶는다 —
  // 오타로 들어간 값이 기록지에 그대로 인쇄되면 안 된다.
  function setOrderQty(key, value) {
    const qty = normalizeQty(value)
    setOrderChecks((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], qty } } : prev))
  }

  // 실제로 켜진 경로 = 수동 보정이 있으면 그 값, 없으면 자동 계산.
  function effectiveRouteCodes() {
    const auto = autoRouteCodes(orderChecks, orderItems)
    return ROUTE_CODES.filter((code) => routeOverride[code] ?? auto.has(code))
  }

  // 경로 박스 수동 보정. 자동 계산과 다른 값을 눌렀을 때만 보정으로 남는다.
  function toggleRouteItem(code) {
    const auto = autoRouteCodes(orderChecks, orderItems)
    const now = routeOverride[code] ?? auto.has(code)
    setRouteOverride((prev) => {
      const next = { ...prev }
      if (auto.has(code) === !now) delete next[code]
      else next[code] = !now
      return next
    })
  }

  // 묶음 적용 = 덮어쓰기(합치기 아님, 사용자 결정). 저장이 아니라 로컬 상태만 바꾼다.
  // 이미 체크한 게 있으면 한 번 확인한다 — 실수로 눌러 날아가면 되돌릴 방법이 없다.
  function applyOrderBundle(bundle) {
    if (Object.keys(orderChecks).length > 0
        && !window.confirm(`현재 체크를 '${bundle.name}' 묶음으로 바꿀까요?`)) return
    const next = {}
    bundle.items.forEach((it) => {
      next[checkKey(it.code, it.dose)] = { code: it.code, dose: it.dose ?? '', qty: it.qty ?? 1 }
    })
    setOrderChecks(next)
    // 묶음이 항목을 통째로 정의하므로 경로도 자동 계산으로 되돌린다.
    setRouteOverride({})
  }

  // 종료 복귀 — 실수로 종료한 세션을 다시 이용 중으로 되돌린다.
  // 이용기록 화면에서 부르므로 setActionError(베드 상세용)가 안 보인다 — alert로 알린다.
  async function handleRestoreSession(entry) {
    if (!entry?.sessionId) return
    if (!window.confirm(`${entry.patientName} 환자를 다시 이용 중으로 되돌릴까요?`)) return
    try {
      await restoreSession(entry.sessionId)
      await Promise.all([refreshBoard(), refreshRecords()])
    } catch (err) {
      alert(err.message)
    }
  }

  // 기록지 열기 — 종료본이면 스냅샷, 아니면 즉석 조립본이 온다(서버가 판단).
  function handleOpenRecord(sessionId) {
    setActionError('')
    return openRecordFor(sessionId, setActionError)
  }

  async function handleSavePrescription() {
    if (!prescriptionBed?.sessionId) return
    setActionError('')
    // 경로 박스도 order_items 행이라 함께 저장한다(기록지·CSV가 이 행을 읽는다).
    const items = Object.values(orderChecks).map((row) => ({ code: row.code, dose: row.dose, qty: row.qty }))
    effectiveRouteCodes().forEach((code) => items.push({ code, dose: '', qty: 1 }))
    try {
      await savePrescription(prescriptionBed.sessionId, { items, visitSymptom })
      await refreshBoard()
      closePrescriptionModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleSaveVitals() {
    if (!vitalsModalBed?.sessionId) return
    const toNum = (v) => (v.trim() === '' ? null : Number(v))
    const payload = {
      occurredAt: vitalsOccurredAt,
      temperature: parseTemperature(vitalsTemp),
      bpSystolic: toNum(vitalsSys),
      bpDiastolic: toNum(vitalsDia),
      pulse: toNum(vitalsPulse),
    }
    try {
      if (editingVitalsId) await editVitals(editingVitalsId, payload)
      else await createVitals(vitalsModalBed.sessionId, payload)
      await Promise.all([refreshRecords(), refreshBoard()]) // 카드 최신값도 갱신돼야 한다
      closeVitalsModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function openRoundModal(bed, record) {
    // 라운딩 모달은 selectedBed(베드 상세 트리거)와 별개인 roundModalBedId로 대상을 들고 있음.
    // 카드에서 열 때는 그 베드를, 베드 상세 안 버튼에서 열 때는 인자 없이(이미 열려있는 currentBed) 대상으로 삼음.
    const target = bed ?? currentBed
    if (!target) return
    setRoundModalBedId(target.id)
    setActionError('')
    setEditingRoundId(record?.id ?? null)
    setRoundOccurredAt(record ? new Date(record.occurredAt).getTime() : now)
    setRoundMemo(record?.memo ?? '')
    setRoundModalOpen(true)
  }

  function closeRoundModal() {
    setRoundModalOpen(false)
    setRoundModalBedId(null)
    setEditingRoundId(null)
  }

  async function handleSaveRound() {
    if (!roundModalBed) return
    try {
      const payload = {
        occurredAt: roundOccurredAt,
        memo: roundMemo.trim(),
      }
      if (editingRoundId) await editRound(editingRoundId, payload)
      else await createRound({ sessionId: roundModalBed.sessionId, ...payload })
      await refreshRecords()
      closeRoundModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function toggleChip(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  async function handleSaveSessionNote() {
    if (!currentBed) return
    if (noteSymptoms.length === 0 && noteActions.length === 0 && !noteMemo.trim()) return

    try {
      const payload = {
        occurredAt: noteOccurredAt,
        symptoms: noteSymptoms,
        actions: noteActions,
        memo: noteMemo.trim(),
      }
      if (editingNoteId) await editSessionNote(editingNoteId, payload)
      else await createSessionNote({ sessionId: currentBed.sessionId, ...payload })
      await refreshRecords()
      closeNoteModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function startSpecialNoteEdit() {
    setSpecialNoteDraft(currentBed?.specialNote ?? '')
    setSpecialNoteEditing(true)
  }

  async function handleSaveSpecialNote() {
    if (!currentBed?.sessionId) return
    try {
      await editSessionSpecialNote(currentBed.sessionId, specialNoteDraft.trim())
      await refreshBoard() // 특이사항은 board payload에 실려 오므로 보드를 다시 받아야 반영된다
      setSpecialNoteEditing(false)
    } catch (err) {
      setActionError(err.message)
    }
  }

  // 당일 메모 — 이 방문에만 유효하다(다음 방문엔 안 뜬다). 특이사항과 같은 인라인 편집
  // 패턴이고, 이제 저장 대상도 같은 세션이다(구 당일 메모는 차트번호에 붙었다).
  function startDayMemoEdit() {
    setDayMemoDraft(currentBed?.dayMemo ?? '')
    setDayMemoEditing(true)
  }

  async function handleSaveDayMemo() {
    if (!currentBed?.sessionId) return
    try {
      await saveDayMemo(currentBed.sessionId, dayMemoDraft.trim())
      await refreshBoard() // 당일 메모도 board payload에 실려 온다
      setDayMemoEditing(false)
    } catch (err) {
      setActionError(err.message)
    }
  }

  // 타임라인 항목 삭제 — 특이사항·라운딩 모두 기존 소프트삭제 토글을 재사용한다.
  async function handleDeleteRecord(ev) {
    try {
      if (ev.vital) await editVitals(ev.vital.id, { deleted: true })
      else if (ev.round) await toggleRoundDeleted(ev.round.id, true)
      else await toggleSessionNoteDeleted(ev.note.id, true)
      await Promise.all([refreshRecords(), refreshBoard()])
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleRegister() {
    if (!patientName.trim() || !chartNumber.trim() || !selectedBed || !lineStaffId) return
    setActionError('')
    try {
      await assignBed({
        bedCode: selectedBed.id,
        chartNo: chartNumber.trim(),
        patientName: patientName.trim(),
        lineStaffId: Number(lineStaffId),
        specialNote: specialNote.trim(),
        examRoom,
      })
      stopLockAndRelease(selectedBed.id) // 배정 완료 — 등록 잠금 해제
      await refreshBoard()
      setDurationMinutes(DEFAULT_DURATION)
      setMixStaffId('')
      // 배정 후에는 아무 팝업도 자동으로 열지 않는다.
      // 다음 단계(믹스 담당자·투여 시작)는 사용자가 카드를 다시 눌러서 진행한다.
      closeModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleStartSession() {
    if (!currentBed || !mixStaffId) return
    setActionError('')
    try {
      await startSession(currentBed.sessionId, {
        mixStaffId: Number(mixStaffId),
        durationMinutes,
      })
      await refreshBoard()
      closeModal()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function renderBedCard(bed) {
    if (bed.status === 'vacant') {
      // 다른 단말에서 등록 중이면 잠긴 상태로 표시하고 클릭을 막는다.
      if (bed.lockedBy) {
        return (
          <article key={bed.id} className="bed-card bed-card--vacant bed-card--locked">
            <p className="bed-card__number">{bed.number}</p>
            <div className="bed-card__add-slot">
              <span className="bed-card__add-icon"><Icon name="clock" /></span>
              <span className="bed-card__add-label">환자 등록중</span>
            </div>
          </article>
        )
      }
      return (
        <article
          key={bed.id}
          className={`bed-card bed-card--vacant${movingBed ? ' bed-card--movable' : ''}`}
          onClick={(e) => handleBedClick(bed, e.currentTarget)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed, e.currentTarget)}
        >
          <p className="bed-card__number">{bed.number}</p>
          <div className="bed-card__add-slot">
            <span className="bed-card__add-icon"><Icon name="plus" /></span>
            <span className="bed-card__add-label">환자 등록</span>
          </div>
        </article>
      )
    }

    if (bed.status === 'reserved') {
      return (
        <article
          key={bed.id}
          className={`bed-card bed-card--reserved${bed.overdue ? ' bed-card--reserved-overdue' : ''}`}
          onClick={(e) => handleBedClick(bed, e.currentTarget)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed, e.currentTarget)}
        >
          <span className="bed-card__chip bed-card__chip--reserved">배정됨 · 미도착</span>
          <p className="bed-card__number">{bed.number}</p>
          <p className="bed-card__patient">
            <Marquee contentKey={bed.patientName}>{bed.patientName}</Marquee>
            <PrescriptionCheck done={bed.hasPrescription} />
          </p>
          <p className="bed-card__chart"><Marquee contentKey={bed.chartNumber}>{bed.chartNumber}</Marquee></p>
          {/* 진료실 칩 + 처방 미작성을 한 줄에 둔다 — 미작성을 별도 줄로 두면
              이 카드만 한 줄 더 길어져 옆 카드들과 줄이 어긋난다.
              진료실은 미선택이면 안 뜨므로(기존 세션) 줄 자체도 조건부다. */}
          {(bed.examRoom || !bed.hasPrescription) && (
            <div className="bed-card__exam-row">
              {bed.examRoom && <p className="bed-card__exam-room">{bed.examRoom}진료실</p>}
              <PrescriptionTodo done={bed.hasPrescription} />
            </div>
          )}
          {/* 특이사항은 배정 단계부터 보여야 한다(투여 전에 알아야 하는 정보라). */}
          {bed.specialNote && (
            <p className="bed-card__caution bed-card__caution--danger">
              <Icon name="alert" />
              <Marquee contentKey={bed.specialNote}>{bed.specialNote}</Marquee>
            </p>
          )}
          <div className="bed-card__spacer" />
          {bed.overdue && (
            <p className="bed-card__overdue-label"><Icon name="alert" /> 환자 미도착</p>
          )}
          <p className="bed-card__reserved-label"><Marquee contentKey={bed.lineStaff}>라인 {bed.lineStaff}</Marquee></p>
        </article>
      )
    }

    const { progress, isCompleted, isWarning, elapsedMs, remainingMs } = getBedProgress(bed, now)
    const completed = bed.status === 'completed' || isCompleted
    const displayProgress = completed ? 100 : progress
    const category = completed ? 'completed' : isWarning ? 'warning' : 'occupied'
    const chipLabel = completed ? '완료' : isWarning ? '곧 완료' : '진행중'
    const noteLines = getCardNoteLines(sessionNotes, bed)

    // 라운딩 줄 (완료/정리 상태 카드에는 표시 안 함)
    const latestRound = completed ? null : getLatestSessionRound(rounds, bed.sessionId)
    const rawRoundStatus = completed ? null : getRoundStatus(bed, latestRound, now)
    // 몰아보기 힌트(A-4): soon은 같은 방에 due가 있을 때만 노출, 없으면 ok처럼 조용히 표시.
    // ok·due 판정 자체와 minutes 공식은 그대로(둘 다 30−경과) — 상태 라벨만 강등.
    const roundStatus =
      rawRoundStatus?.status === 'soon' && !roomDueMap[bed.room]
        ? { ...rawRoundStatus, status: 'ok' }
        : rawRoundStatus
    const vitalsView = getCardVitals(bed)
    const roundText =
      roundStatus?.status === 'ok'
        ? `라운딩 ${roundStatus.minutes}분 후`
        : roundStatus?.status === 'soon'
          ? `곧 라운딩 · ${roundStatus.minutes}분 후`
          : roundStatus?.status === 'due'
            ? `라운딩 필요 · ${roundStatus.minutes}분 경과`
            : ''
    const roundIcon =
      roundStatus?.status === 'due' ? 'alert' : roundStatus?.status === 'soon' ? 'bell' : 'clock'

    return (
      <article
        key={bed.id}
        className={`${getCardClassName(bed, { isCompleted: completed, isWarning })}${movingBed && bed.id !== movingBed.id ? ' bed-card--dimmed' : ''}${movingBed && bed.id === movingBed.id ? ' bed-card--moving' : ''}`}
        onClick={(e) => handleBedClick(bed, e.currentTarget)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleBedClick(bed, e.currentTarget)}
      >
        <span className={`bed-card__chip bed-card__chip--${category}`}>{chipLabel}</span>
        {/* 우상단 바이탈 — 잰 항목만 표시. 아무것도 없으면 값 없이 기록 버튼만 남긴다. */}
        {!completed && (
          <button
            type="button"
            className={`bed-card__vitals${vitalsView.temp || vitalsView.bp ? '' : ' bed-card__vitals--empty'}`}
            onClick={(e) => { e.stopPropagation(); openVitalsModal(bed) }}
            aria-label="바이탈 기록"
            title="바이탈 기록"
          >
            {vitalsView.temp || vitalsView.bp ? (
              <>
                {vitalsView.temp && (
                  <span className={`bed-card__vitals-temp${vitalsView.tone ? ` bed-card__vitals-temp--${vitalsView.tone}` : ''}`}>
                    {vitalsView.temp}
                  </span>
                )}
                {vitalsView.bp && <span className="bed-card__vitals-bp">{vitalsView.bp}</span>}
              </>
            ) : (
              /* 값이 없을 때는 아이콘만으로는 눌러야 하는 줄 모른다 — 라벨을 붙여 알약 버튼으로 */
              <>
                <Icon name="thermometer" />
                <span className="bed-card__vitals-cta">바이탈</span>
              </>
            )}
          </button>
        )}
        <p className="bed-card__number">{bed.number}</p>
        <p className="bed-card__patient">
          <Marquee contentKey={bed.patientName}>{bed.patientName}</Marquee>
          <PrescriptionCheck done={bed.hasPrescription} />
        </p>
        <p className="bed-card__chart"><Marquee contentKey={bed.chartNumber}>{bed.chartNumber}</Marquee></p>
        {/* 진료실 칩 + 처방 미작성을 한 줄에 둔다 — 미작성을 별도 줄로 두면
            이 카드만 한 줄 더 길어져 옆 카드들과 줄이 어긋난다.
            진료실은 미선택이면 안 뜨므로(기존 세션) 줄 자체도 조건부다. */}
        {(bed.examRoom || !bed.hasPrescription) && (
          <div className="bed-card__exam-row">
            {bed.examRoom && <p className="bed-card__exam-room">{bed.examRoom}진료실</p>}
            <PrescriptionTodo done={bed.hasPrescription} />
          </div>
        )}
        {roundStatus && (
          <button
            type="button"
            className={`bed-card__round bed-card__round--${roundStatus.status}`}
            onClick={(e) => {
              e.stopPropagation()
              openRoundModal(bed)
            }}
          >
            <Icon name={roundIcon} className="bed-card__round-icon" />
            <Marquee className="bed-card__round-body" contentKey={roundText}>
              {roundText}
            </Marquee>
          </button>
        )}
        {noteLines.lines.length > 0 && (
          <div className="bed-card__notes">
            {noteLines.lines.map((line, i) => (
              <CardNoteLine key={i} line={line} />
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
            <span>
              진행률 {displayProgress}%
              {!completed && <Icon name="droplet" className="bed-card__droplet" />}
            </span>
            {!completed && (
              <span className="bed-card__progress-elapsed">
                {Math.floor(elapsedMs / 60000)}/{bed.durationMinutes}분
              </span>
            )}
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
            <span className="bed-card__meta">시작 - {formatHour24(bed.startTime)}</span>
            <span className="bed-card__remaining">
              {formatDuration(Math.ceil(remainingMs / 60000))} 남음
            </span>
          </div>
        )}
      </article>
    )
  }

  if (!authChecked) {
    return <div className="app login-screen" />
  }

  if (!account) {
    return <LoginScreen onLoginSuccess={setAccount} />
  }

  return (
    <div className="app">
      {/* header-zone: 말풍선을 헤더 카드 바로 아래에 앉히기 위한 기준점 */}
      <div className="header-zone">
        <div className="header-wrap">
          <header className="header">
            <img src={theme === 'light' ? logoIconColor : logoIcon} alt="벗이비인후과 로고" className="header__logo" />
            <div className="header__text">
              <span className="header__clinic">벗이비인후과</span>
              <h1 className="header__title">수액실 관리</h1>
            </div>
          </header>
          <div className="header-account">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="밝게/어둡게 전환"
              title="밝게/어둡게 전환"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            {/* 쪽지 쓰기 — 받은 쪽지는 알아서 팝업으로 뜨므로 이 버튼은 쓰기 전용 */}
            <button
              type="button"
              className="header-msg-btn"
              onClick={() => setComposeOpen(true)}
              aria-label={inboxMessages.length > 0 ? `쪽지 쓰기 (안읽음 ${inboxMessages.length})` : '쪽지 쓰기'}
              title="쪽지 쓰기"
            >
              <Icon name="send" />
              {inboxMessages.length > 0 && (
                <span className="header-msg-btn__badge">{inboxMessages.length}</span>
              )}
            </button>
            {/* 전체 채팅 — 쪽지와 별개다. 눌러서 창을 켜고 끈다.
                배지는 마지막으로 본 id 이후의 개수(보드 폴링이 최신 id를 실어 온다). */}
            <button
              type="button"
              className={`header-msg-btn${chatOpen ? ' header-msg-btn--on' : ''}`}
              onClick={() => {
                setChatOpen((prev) => {
                  if (!prev) markChatSeen(chatLatestId)
                  return !prev
                })
              }}
              aria-pressed={chatOpen}
              aria-label={chatUnread > 0 ? `전체 채팅 (새 메시지 ${chatUnread})` : '전체 채팅'}
              title="전체 채팅"
            >
              <Icon name="chat" />
              {!chatOpen && chatUnread > 0 && (
                <span className="header-msg-btn__badge">{chatUnread > 99 ? '99+' : chatUnread}</span>
              )}
            </button>
            <span className="header-account__name">{account.displayName}</span>
            <button type="button" className="header-account__logout" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
          {/* 클릭해서 한마디를 듣는 요소라 button — 키보드로도 눌러진다 */}
          <button
            type="button"
            className="header__dog-btn"
            onClick={handleBossClick}
            aria-label="한마디 듣기"
          >
            <img src={headerPortrait} alt="" className="header__dog" aria-hidden="true" />
          </button>
        </div>

        {/* 한마디 말풍선 — header-wrap이 overflow:hidden이라 카드 안에는 못 넣는다.
            header-zone 기준 absolute라 떴다 사라져도 아래 탭이 밀리지 않는다. */}
        <p className="boss-say" role="status" aria-live="polite">
          {bossLine && <span className="boss-say__bubble">{bossLine}</span>}
        </p>
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

      {/* ── 오프라인 배너 — 서버 연결이 끊긴 동안 읽기 전용임을 알린다 ── */}
      {offline && (
        <div className="offline-banner" role="status">
          <span className="offline-banner__label">서버 연결 끊김</span>
          <span className="offline-banner__desc">
            {formatStaleness(lastSyncAt, now) ?? '저장된 정보가 없습니다'}
            {' · 읽기 전용 — 기록·저장은 연결이 돌아온 뒤에 가능합니다'}
          </span>
        </div>
      )}

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
        <div className="move-alert" role="alert">
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

      <div className="tab-view" ref={tabViewRef}>
      {activeTab === 'history' ? (
        <HistoryView
          history={activeHistory}
          sessionNotes={sessionNotes}
          rounds={rounds}
          vitals={vitals}
          onRestore={handleRestoreSession}
        />
      ) : activeTab === 'patient' ? (
        <PatientView
          history={activeHistory}
          sessionNotes={sessionNotes}
          rounds={rounds}
          vitals={vitals}
          initialChartNumber={patientViewSeed}
          onInitialChartConsumed={() => setPatientViewSeed(null)}
        />
      ) : activeTab === 'stats' ? (
        <StatsView history={activeHistory} />
      ) : activeTab === 'datamanage' ? (
        <DataManageView
          allHistory={history}
          onUpdateHistory={updateHistoryWithSync}
          sessionNotes={sessionNotes}
          onUpdateSessionNotes={updateSessionNotesWithSync}
          account={account}
          offline={offline}
        />
      ) : (
        <>
          <div className="bed-summary">
            <div className="bed-summary__card">
              <span className="bed-summary__label">배정됨</span>
              <span className="bed-summary__value bed-summary__value--reserved">
                <CountUp value={bedSummaryCounts.reserved} />
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">진행중</span>
              <span className="bed-summary__value bed-summary__value--occupied">
                <CountUp value={bedSummaryCounts.occupied} />
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">곧 완료</span>
              <span className="bed-summary__value bed-summary__value--warning">
                <CountUp value={bedSummaryCounts.warning} />
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">완료 · 정리</span>
              <span className="bed-summary__value bed-summary__value--completed">
                <CountUp value={bedSummaryCounts.completed} />
              </span>
            </div>
            <div className="bed-summary__card">
              <span className="bed-summary__label">빈 베드</span>
              <span className="bed-summary__value bed-summary__value--vacant">
                <CountUp value={bedSummaryCounts.vacant} />
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
      </div>

      {cleanupBedHeld && (
        <div className={`modal-overlay${cleanupBedClosing ? ' modal-overlay--closing' : ''}`}>
          <div
            className="modal modal--confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__body modal__body--confirm">
              <p className="confirm__message">
                이용을 종료하시겠습니까?
              </p>
              {/* 완료 카드는 상세가 안 열려 시간추가 진입점이 여기밖에 없다.
                  아직 더 맞아야 하면 종료 대신 이걸로 되돌린다. */}
              <div className="confirm__extend">
                <button
                  type="button"
                  className="btn-extend"
                  onClick={() => handleAddTimeFromCleanup(15)}
                  disabled={offline}
                >
                  시간추가 +15분
                </button>
                <button
                  type="button"
                  className="btn-extend"
                  onClick={() => handleAddTimeFromCleanup(30)}
                  disabled={offline}
                >
                  +30분
                </button>
              </div>
              {/* 라인 제거 — 라인을 뽑은 직원. 고르기 전엔 '예'가 안 눌린다. */}
              <label className="field confirm__field">
                <span className="field__label">라인 제거</span>
                <select
                  className="field__input"
                  value={endStaffId}
                  onChange={(e) => setEndStaffId(e.target.value)}
                >
                  {/* 목록이 비면 이유를 보여준다 — 예전엔 '선택'만 남아 죽은 칸처럼 보였다. */}
                  <option value="" disabled>{staffList.length ? '선택' : '직원 목록 불러오는 중...'}</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              {actionError && <p role="alert" className="field__error">{actionError}</p>}
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn-confirm btn-confirm--no"
                  onClick={closeCleanupConfirm}
                >
                  아니오
                </button>
                <button
                  type="button"
                  className="btn-confirm btn-confirm--yes"
                  onClick={handleCleanupYes}
                  disabled={offline || !endStaffId}
                >
                  예
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedBedHeld && (
        <div className={`modal-overlay${selectedBedClosing ? ' modal-overlay--closing' : ''}`}>
          <div
            className={`modal modal--genie${isInProgress ? ' modal--detail-wide' : ''}`}
            ref={bedModalRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <div className="modal__header-title">
                {/* selectedBed가 아니라 currentBed — 닫히는 동안 selectedBed는 이미 null이다 */}
                <h2>베드 {currentBed.number}</h2>
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
                <Icon name="close" />
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
                    onBlur={handleChartNumberBlur}
                    inputMode="numeric" placeholder="차트번호 입력"
                  />
                </label>

                {lookupInfo && (
                  <p className={`field__hint ${lookupInfo.found ? 'field__hint--ok' : 'field__hint--new'}`}>
                    {lookupInfo.found ? `등록된 환자입니다 (${lookupInfo.name})` : '신규 환자입니다'}
                  </p>
                )}

                <label className="field">
                  <span className="field__label">라인 담당자</span>
                  <select
                    className="field__input"
                    value={lineStaffId}
                    onChange={(e) => {
                      setLineStaffId(e.target.value)
                      maybeAlertBaselineNote(lookupInfo, e.target.value)
                    }}
                  >
                    <option value="">{staffList.length ? '선택' : '직원 목록 불러오는 중...'}</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>

                {/* 진료실 — 라인 담당자와 같은 필수 항목. 고르기 전엔 배정 버튼이 안 눌린다. */}
                <label className="field">
                  <span className="field__label">진료실</span>
                  <select
                    className="field__input"
                    value={examRoom}
                    onChange={(e) => setExamRoom(e.target.value)}
                  >
                    {/* 필수라 되돌아갈 수 없는 자리다 — 초기 표시만 하고 다시 고르지는 못하게. */}
                    <option value="" disabled>선택</option>
                    {EXAM_ROOMS.map((room) => (
                      <option key={room} value={room}>{room}진료실</option>
                    ))}
                  </select>
                </label>

                {/* 이 방문의 특이사항 — 매 방문 받되, 재방문이면 지난 방문 내용이 채워진다(수정 가능). */}
                <label className="field">
                  <span className="field__label">특이사항(기저질환)</span>
                  <textarea
                    className="field__input special-note__input"
                    value={specialNote}
                    onChange={(e) => setSpecialNote(e.target.value)}
                    rows={2}
                    placeholder="기저질환, 약 부작용, 임신 등 특이사항"
                  />
                </label>

                {actionError && <p role="alert" className="field__error">{actionError}</p>}

                <button
                  type="button"
                  className="btn-register"
                  onClick={handleRegister}
                  disabled={offline || !patientName.trim() || !chartNumber.trim() || !lineStaffId || !examRoom}
                >
                  배정
                </button>
              </div>
            ) : isReserved ? (
              <div className="modal__body">
                <div className="bed-detail-summary">
                  <div className="bed-detail-summary__patient">
                    <span className="bed-detail-summary__name">{currentBed.patientName}</span>
                    <span className="bed-detail-summary__chart">차트 {currentBed.chartNumber}</span>
                  </div>
                  <div className="bed-detail-summary__meta">
                    <span className="bed-detail-summary__meta-text">
                      라인 담당 {currentBed.lineStaff} · 배정 {formatHour24(currentBed.assignedAt)}
                    </span>
                  </div>
                </div>

                {currentBed.overdue && (
                  <p role="alert" className="field__error"><Icon name="alert" /> 환자 미도착 — 확인이 필요합니다</p>
                )}

                {examRoomField}

                {/* 처방 작성은 투여 시작과 독립이다 — 예약 상태에서도 먼저 열 수 있다. */}
                <div className="rec-block__actions">
                  <button
                    type="button"
                    className="dm-note-btn dm-note-btn--record"
                    onClick={() => handleOpenRecord(currentBed.sessionId)}
                    disabled={offline}
                  >
                    수액간호기록지
                  </button>
                  <button
                    type="button"
                    className="dm-note-btn"
                    onClick={() => openPrescriptionModal()}
                    disabled={offline}
                  >
                    처방 작성
                  </button>
                </div>

                <label className="field">
                  <span className="field__label">믹스 담당자</span>
                  <select
                    className="field__input"
                    value={mixStaffId}
                    onChange={(e) => setMixStaffId(e.target.value)}
                  >
                    <option value="">{staffList.length ? '선택' : '직원 목록 불러오는 중...'}</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>

                <DurationControls
                  minutes={durationMinutes}
                  onAdjust={adjustDuration}
                />

                {actionError && <p role="alert" className="field__error">{actionError}</p>}

                <button
                  type="button"
                  className="btn-register"
                  onClick={handleStartSession}
                  disabled={offline || !mixStaffId}
                >
                  투여 시작
                </button>

                <button
                  type="button"
                  className="btn-remove-patient-link"
                  onClick={() => setRemovePatientConfirm(true)}
                  disabled={offline}
                >
                  배정 취소
                </button>
              </div>
            ) : (
              <div className={isInProgress ? 'bed-detail-2col' : 'modal__body'}>
                <div className={isInProgress ? 'bed-detail-2col__left' : undefined}>
                <div className="bed-detail-summary">
                  <div className="bed-detail-summary__patient">
                    <span className="bed-detail-summary__name">{currentBed.patientName}</span>
                    <span className="bed-detail-summary__chart">차트 {currentBed.chartNumber}</span>
                    {isInProgress && (
                      <button
                        type="button"
                        className="btn-edit-patient"
                        onClick={openEditPatientModal}
                        disabled={offline}
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
                      <div className="bed-detail-summary__meta-actions">
                        <button
                          type="button"
                          className="btn-move-bed"
                          onClick={openStartEdit}
                          disabled={offline}
                        >
                          시작시간 수정
                        </button>
                        <button
                          type="button"
                          className="btn-move-bed"
                          onClick={handleStartMoveBed}
                          disabled={offline}
                        >
                          베드이동
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isInProgress && editStartOpen && (
                  <div className="start-edit">
                    <div className="start-edit__row">
                      <span className="field__label">시작 시각</span>
                      <input
                        type="time"
                        className="occurred-at__input"
                        value={`${String(new Date(startDraft).getHours()).padStart(2, '0')}:${String(new Date(startDraft).getMinutes()).padStart(2, '0')}`}
                        onChange={(e) => setStartDraftTime(e.target.value)}
                      />
                    </div>
                    {/* 이 폼에 오류 자리가 없어서, 서버가 거절해도 화면에 아무 반응이 없었다
                        ("시작시간 변경이 안 된다"의 원인). 배정 시각보다 앞으로 당기면 거절된다. */}
                    {actionError && <p role="alert" className="field__error">{actionError}</p>}
                    <div className="start-edit__actions">
                      <button type="button" className="dm-note-btn" onClick={() => setEditStartOpen(false)}>
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn-register start-edit__save"
                        onClick={handleSaveStartEdit}
                        disabled={offline}
                      >
                        저장
                      </button>
                    </div>
                  </div>
                )}

                {/* 기록지는 진행중·완료 모두에서 연다. 완료면 종료 시 얼린 스냅샷이 나온다. */}
                <div className="rec-block__actions">
                  <button
                    type="button"
                    className="dm-note-btn dm-note-btn--record"
                    onClick={() => handleOpenRecord(currentBed.sessionId)}
                    disabled={offline}
                  >
                    수액간호기록지
                  </button>
                  <button
                    type="button"
                    className="dm-note-btn"
                    onClick={() => openPrescriptionModal()}
                    disabled={offline}
                  >
                    처방 작성
                  </button>
                </div>

                {isInProgress && examRoomField}

                {/* 진행중이면 특이사항은 오른쪽 기록 패널에서 편집한다. 여기(완료 등)는 읽기 전용. */}
                {!isInProgress && currentBed.specialNote && (
                  <div className="bed-detail-notes">
                    <h3 className="bed-detail-notes__title">특이사항(기저질환)</h3>
                    <p className="special-note__text">{currentBed.specialNote}</p>
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

                {/* 라운딩·증상 기록 버튼은 오른쪽 기록 패널 헤더로 옮겼다. */}

                {isInProgress && (
                  <button
                    type="button"
                    className="btn-register"
                    onClick={requestCleanupFromDetail}
                    disabled={offline}
                  >
                    종료
                  </button>
                )}

                {isInProgress && (
                  <button
                    type="button"
                    className="btn-remove-patient-link"
                    onClick={() => setRemovePatientConfirm(true)}
                    disabled={offline}
                  >
                    환자 등록 취소
                  </button>
                )}

                <button type="button" className="btn-detail-confirm" onClick={closeModal}>
                  확인
                </button>
                </div>

                {/* ── 오른쪽: 이 환자의 기록 (진행중일 때만) ── */}
                {isInProgress && (
                  <div className="bed-detail-2col__right">
                    {/* 직전 방문 증상 상기 — 읽기전용. 없으면 아무것도 안 뜬다. */}
                    {prevVisitSymptoms.length > 0 && (
                      <p className="prev-visit">
                        <span className="prev-visit__label">지난 방문</span>
                        <span className="prev-visit__text">{prevVisitSymptoms.join(' · ')}</span>
                      </p>
                    )}

                    {/* (A) 이 방문의 특이사항 — 자유텍스트 한 칸, 인라인 편집 */}
                    <section className="rec-block">
                      <div className="rec-block__head">
                        <h3 className="rec-block__title">특이사항(기저질환)</h3>
                        {!specialNoteEditing && (
                          <button
                            type="button"
                            className="dm-note-btn"
                            onClick={startSpecialNoteEdit}
                            disabled={offline}
                          >
                            {currentBed.specialNote ? '수정' : '추가'}
                          </button>
                        )}
                      </div>
                      {specialNoteEditing ? (
                        <div className="special-note__edit">
                          <textarea
                            className="field__input special-note__input"
                            value={specialNoteDraft}
                            onChange={(e) => setSpecialNoteDraft(e.target.value)}
                            rows={3}
                            aria-label="특이사항"
                            autoFocus
                          />
                          <div className="rec-item__actions">
                            <button
                              type="button"
                              className="rec-btn"
                              onClick={() => setSpecialNoteEditing(false)}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className="rec-btn rec-btn--primary"
                              onClick={handleSaveSpecialNote}
                              disabled={offline}
                            >
                              저장
                            </button>
                          </div>
                        </div>
                      ) : currentBed.specialNote ? (
                        <p className="special-note__text">{currentBed.specialNote}</p>
                      ) : (
                        <p className="rec-empty">적어둔 특이사항이 없습니다</p>
                      )}
                    </section>

                    {/* (A-2) 당일 메모 — 차트번호에 붙어 다음 방문에도 그대로 따라온다 */}
                    <section className="rec-block">
                      <div className="rec-block__head">
                        <h3 className="rec-block__title">당일 메모</h3>
                        {!dayMemoEditing && (
                          <button
                            type="button"
                            className="dm-note-btn"
                            onClick={startDayMemoEdit}
                            disabled={offline}
                          >
                            {currentBed.dayMemo ? '수정' : '추가'}
                          </button>
                        )}
                      </div>
                      {dayMemoEditing ? (
                        <div className="special-note__edit">
                          <textarea
                            className="field__input special-note__input"
                            value={dayMemoDraft}
                            onChange={(e) => setDayMemoDraft(e.target.value)}
                            rows={2}
                            aria-label="당일 메모"
                            autoFocus
                          />
                          <p className="rec-empty">이 메모는 같은 환자에게 계속 표시됩니다</p>
                          <div className="rec-item__actions">
                            <button
                              type="button"
                              className="rec-btn"
                              onClick={() => setDayMemoEditing(false)}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className="rec-btn rec-btn--primary"
                              onClick={handleSaveDayMemo}
                              disabled={offline}
                            >
                              저장
                            </button>
                          </div>
                        </div>
                      ) : currentBed.dayMemo ? (
                        <p className="special-note__text">{currentBed.dayMemo}</p>
                      ) : (
                        <p className="rec-empty">적어둔 당일 메모가 없습니다</p>
                      )}
                    </section>

                    {/* (B) 금일 특이사항 · 라운딩 — 이번 세션 것만, 시각순 타임라인 */}
                    <section className="rec-block">
                      <div className="rec-block__head">
                        <h3 className="rec-block__title">금일 기록</h3>
                        <div className="rec-block__actions">
                          {/* 처방 작성 버튼은 왼쪽 수액간호기록지 옆으로 옮겼다. */}
                          <button
                            type="button"
                            className="dm-note-btn"
                            onClick={() => openRoundModal()}
                            disabled={offline}
                          >
                            라운딩
                          </button>
                          <button
                            type="button"
                            className="dm-note-btn"
                            onClick={() => openNoteModal()}
                            disabled={offline}
                          >
                            증상
                          </button>
                        </div>
                      </div>
                      {currentBedEvents.length === 0 ? (
                        <p className="rec-empty">오늘 기록이 아직 없습니다</p>
                      ) : (
                        <ul className="rec-list">
                          {currentBedEvents.map((ev) => (
                            <li key={ev.key} className="rec-item">
                              <div className="rec-item__main">
                                <span className="rec-item__time">{xTime(ev.t)}</span>
                                <span className={`rec-kind rec-kind--${ev.vital ? 'vital' : ev.round ? 'round' : 'note'}`}>
                                  {ev.kind}
                                </span>
                                <span className="rec-item__text">{ev.text}</span>
                              </div>
                              <div className="rec-item__foot">
                                <span className="rec-item__sub" />
                                <div className="rec-item__actions">
                                  <button
                                    type="button"
                                    className="rec-btn"
                                    onClick={() => {
                                      if (ev.vital) openVitalsModal(undefined, ev.vital)
                                      else if (ev.round) openRoundModal(undefined, ev.round)
                                      else openNoteModal(ev.note)
                                    }}
                                    disabled={offline}
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    className="rec-btn rec-btn--danger"
                                    onClick={() => handleDeleteRecord(ev)}
                                    disabled={offline}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {removeConfirmHeld && currentBed && (
        <div className={`modal-overlay modal-overlay--top${removeConfirmClosing ? ' modal-overlay--closing' : ''}`}>
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
                  className="btn-confirm btn-confirm--no"
                  onClick={() => setRemovePatientConfirm(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="btn-confirm btn-confirm--yes btn-confirm--danger"
                  onClick={handleRemovePatientConfirm}
                  disabled={offline}
                >
                  등록 취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editPatientHeld && currentBed && (
        <div className={`modal-overlay${editPatientClosing ? ' modal-overlay--closing' : ''}`}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>환자 정보 수정</h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeEditPatientModal}
                aria-label="닫기"
              >
                <Icon name="close" />
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
                  inputMode="numeric" placeholder="차트번호 입력"
                />
              </label>
              <button
                type="button"
                className="btn-register"
                onClick={handleSavePatientEdit}
                disabled={offline || !editPatientName.trim() || !editChartNumber.trim()}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {noteModalHeld && currentBed && (
        <div className={`modal-overlay modal-overlay--top${noteModalClosing ? ' modal-overlay--closing' : ''}`}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>증상 기록</h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeNoteModal}
                aria-label="닫기"
              >
                <Icon name="close" />
              </button>
            </div>

            {(
              <div className="modal__body">
                <OccurredAtPicker valueMs={noteOccurredAt} onChange={setNoteOccurredAt} nowMs={now} />
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
                  disabled={offline || (noteSymptoms.length === 0 && noteActions.length === 0 && !noteMemo.trim())}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 당일 메모 팝업 (배정 중 차트번호 입력 시, 메모가 있을 때만) ── */}
      {/* 특이사항(기저질환) 안내 — 차트 조회 + 라인담당까지 정해져 '환자 조회가 성립'한
          시점에 1회 뜬다. 내용을 여기 다시 보여주지 않는다: 등록 폼의 특이사항 칸에
          정본이 이미 채워져 있고, 이 모달은 '보고 지나가지 말라'는 신호다.
          닫아도 폼은 그대로다 — 아무것도 초기화하지 않는다. */}
      {noteAlert && (
        <div className="modal-overlay modal-overlay--top">
          <div className="modal modal--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__header-title">
                <h2>특이사항 안내</h2>
              </div>
              <button type="button" className="modal__close" onClick={() => setNoteAlert(false)} aria-label="닫기">
                <Icon name="close" />
              </button>
            </div>
            <div className="modal__body">
              <p className="memo-popup__note">특이사항 기록이 있는 환자입니다.</p>
              <button type="button" className="btn-register" onClick={() => setNoteAlert(false)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {chatOpen && (
        <ChatPanel
          account={account}
          onClose={() => setChatOpen(false)}
          onSeen={markChatSeen}
        />
      )}

      {/* ── 처방 작성 (수액 Order 체크 + 내원당시증상) ── */}
      {prescriptionBed && (
        <div className="modal-overlay modal-overlay--top">
          <div className="modal modal--prescription" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__header-title">
                <h2>처방 작성</h2>
                <span className="modal__header-sub">
                  베드 {prescriptionBed.number} · {prescriptionBed.patientName}
                </span>
              </div>
              <button type="button" className="modal__close" onClick={closePrescriptionModal} aria-label="닫기">
                <Icon name="close" />
              </button>
            </div>

            <div className="modal__body">
              {/* 내원당시증상 — 오더를 고르기 전에 읽는 값이라 맨 위다. placeholder·예시 없음. */}
              <label className="field">
                <span className="field__label">내원당시증상</span>
                <textarea
                  className="field__input"
                  value={visitSymptom}
                  onChange={(e) => setVisitSymptom(e.target.value)}
                  rows={2}
                  aria-label="내원당시증상"
                />
              </label>

              {/* 그룹 순서는 GROUP_ORDER, 항목은 전부 DB 응답이다. */}
              {/* 묶음 버튼 — 누르면 현재 체크를 그 묶음으로 '교체'한다(합치기 아님).
                  로컬 상태만 바꾸고 저장은 아래 '저장'이 담당한다.
                  묶음이 0개여도 줄은 그대로 둔다 — 관리자가 등록하는 순간 아래 체크리스트가
                  밀려 내려가면 근무자가 누르던 자리가 바뀐다(자리를 미리 비워둔다). */}
              <div className="order-bundles">
                <span className="order-bundles__label">묶음</span>
                {orderBundles.length > 0 ? (
                  orderBundles.map((bundle) => (
                    <button
                      key={bundle.id}
                      type="button"
                      className="order-bundle-btn"
                      onClick={() => applyOrderBundle(bundle)}
                      /* 버튼에는 EMR 묶음코드를 찍는다 — 원장님·근무자가 이 코드로 부른다.
                         코드가 짧아 7개도 한 줄에 들어간다. 전체 이름은 눌러보기 전에
                         확인할 수 있게 title로 남긴다. */
                      title={bundle.emr_code ? bundle.name : undefined}
                    >
                      {bundle.emr_code || bundle.name}
                    </button>
                  ))
                ) : (
                  <span className="order-bundles__empty">등록된 묶음이 없습니다</span>
                )}
              </div>

              <OrderChecklist
                items={orderItems}
                checks={orderChecks}
                onToggle={toggleOrderItem}
                onDose={selectOrderDose}
                onFreeText={setOrderFreeText}
                onQty={setOrderQty}
                routeChecked={new Set(effectiveRouteCodes())}
                onToggleRoute={toggleRouteItem}
              />

              {actionError && <p role="alert" className="field__error">{actionError}</p>}

              <button
                type="button"
                className="btn-register"
                onClick={handleSavePrescription}
                disabled={offline}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 바이탈 기록 (체온·혈압·맥박) ── */}
      {vitalsModalBed && (
        <div className="modal-overlay modal-overlay--top">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__header-title">
                <h2>{editingVitalsId ? '바이탈 수정' : '바이탈 기록'}</h2>
                <span className="modal__header-sub">베드 {vitalsModalBed.number}</span>
              </div>
              <button type="button" className="modal__close" onClick={closeVitalsModal} aria-label="닫기">
                <Icon name="close" />
              </button>
            </div>

            <div className="modal__body">
              <OccurredAtPicker valueMs={vitalsOccurredAt} onChange={setVitalsOccurredAt} nowMs={now} />

              <label className="field">
                <span className="field__label">체온 (선택)</span>
                <div className="round-temp-input">
                  <span className="round-temp-input__icon" aria-hidden="true"><Icon name="thermometer" /></span>
                  <input
                    type="number" step="0.1" inputMode="decimal"
                    className="round-temp-input__field"
                    value={vitalsTemp}
                    onChange={(e) => setVitalsTemp(e.target.value)}
                    placeholder="--.-"
                  />
                  <span className="round-temp-input__unit">°C</span>
                </div>
              </label>

              <div className="field">
                <span className="field__label">혈압 (선택 · 수축기/이완기 함께)</span>
                <div className="vitals-bp">
                  <input
                    type="number" inputMode="numeric" className="field__input vitals-bp__field"
                    value={vitalsSys} onChange={(e) => setVitalsSys(e.target.value)}
                    aria-label="수축기 혈압"
                  />
                  <span className="vitals-bp__sep">/</span>
                  <input
                    type="number" inputMode="numeric" className="field__input vitals-bp__field"
                    value={vitalsDia} onChange={(e) => setVitalsDia(e.target.value)}
                    aria-label="이완기 혈압"
                  />
                </div>
              </div>

              <label className="field">
                <span className="field__label">맥박 (선택)</span>
                <input
                  type="number" inputMode="numeric" className="field__input"
                  value={vitalsPulse} onChange={(e) => setVitalsPulse(e.target.value)}
                />
              </label>

              {actionError && <p role="alert" className="field__error">{actionError}</p>}

              <button
                type="button"
                className="btn-register"
                onClick={handleSaveVitals}
                disabled={offline || (!vitalsTemp.trim() && !vitalsSys.trim() && !vitalsDia.trim() && !vitalsPulse.trim())}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {roundModalHeld && roundModalBed && (
        <div className={`modal-overlay modal-overlay--top${roundModalClosing ? ' modal-overlay--closing' : ''}`}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="round-header">
                <h2>라운딩</h2>
                <p className="round-header__sub">
                  {roundModalBed.number}번 · {roundModalBed.patientName}
                  {roundModalBed.startTime
                    ? ` · 시작 후 ${Math.max(0, Math.round((now - roundModalBed.startTime) / 60000))}분`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="modal__close"
                onClick={closeRoundModal}
                aria-label="닫기"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="modal__body">
              <div className="round-history">
                <h3 className="round-history__title">지난 라운딩 이력</h3>
                {(() => {
                  const list = getRoundsByChartNumber(rounds, roundModalBed.chartNumber)
                  if (list.length === 0) {
                    return <p className="round-history__empty">아직 라운딩 기록이 없습니다</p>
                  }
                  return (
                    <ul className="round-history__list">
                      {list.map((r) => {
                        // 상태·체온은 각각 제거·바이탈 분리됐다. 라운딩은 시각 + 메모만.
                        return (
                          <li key={r.id} className="round-history__item">
                            <span className="round-history__time">{formatHour24(r.occurredAt)}</span>
                            <span className="round-history__detail">{r.memo || '확인함'}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )
                })()}
              </div>

              <div className="round-input">
                <h3 className="round-input__title">새 라운딩 기록</h3>

                <OccurredAtPicker valueMs={roundOccurredAt} onChange={setRoundOccurredAt} nowMs={now} />

                <label className="field">
                  <span className="field__label">증상 기록 (선택)</span>
                  <input
                    type="text"
                    className="field__input"
                    value={roundMemo}
                    onChange={(e) => setRoundMemo(e.target.value)}
                    placeholder="발열, 혈관통 등 관찰한 증상"
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
                    disabled={offline}
                  >
                    <Icon name="check" /> 라운딩 완료
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


      {/* ── 받은 쪽지 카드 (누적·드래그) ── */}
      {inboxMessages.length > 0 && (
        <div className="msg-cards">
          {inboxMessages.map((m, i) => (
            <MessageCard
              key={m.id}
              message={m}
              index={i}
              onClose={closeMessageCard}
              onMove={moveMessageCard}
            />
          ))}
        </div>
      )}

      {/* ── 쪽지 쓰기 ── */}
      {composeHeld && (
        <ComposeMessageModal onClose={() => setComposeOpen(false)} closing={composeClosing} />
      )}
    </div>
  )
}

export default App
