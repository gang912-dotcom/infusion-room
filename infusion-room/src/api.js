// ─── 데이터 접근 레이어 ──────────────────────────────────────────
// beds, history, rounds, session_notes, patient_notes 전부 서버 기준.
// localStorage는 더 이상 쓰지 않는다.

const ROOM_LABELS = { room2: '2수액실', room3: '3수액실', floor2: '2층수액실' }

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? `요청 실패 (${res.status})`)
  }
  return data
}

// 등록 잠금(bed_locks)의 "누가 쥐고 있나"는 계정이 아니라 이 브라우저 탭 단위여야 한다.
// 같은 계정(예: 공용 로그인)으로 창을 두 개 켜도 서로 다른 소유자로 구분돼야
// 중복 등록·잠금 꼬임이 안 생긴다. 탭이 살아있는 동안 고정되는 임의 ID.
const CLIENT_ID =
  (globalThis.crypto?.randomUUID?.() ??
    `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

function mapAccount(account) {
  if (!account) return null
  return {
    id: account.id,
    username: account.username,
    displayName: account.display_name,
    role: account.role,
  }
}

export async function login(username, password) {
  const result = await apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return mapAccount(result.account)
}

export async function logout() {
  return apiFetch('/logout', { method: 'POST' })
}

// 쿠키가 이미 유효하면 계정 정보를 반환, 아니면 401 -> apiFetch가 throw
export async function getCurrentAccount() {
  const result = await apiFetch('/me')
  return mapAccount(result.account)
}

// 서버 board 응답 -> 기존 App.jsx가 쓰던 flat bed 배열 형태로 변환.
// status는 vacant/reserved/in-progress까지만 서버 기준으로 정하고, in-progress -> completed
// 승격은 기존처럼 App.jsx의 markCompletedIfNeeded(now 기준)가 그대로 담당한다.
// overdue 판정도 server_now 기준 — 클라이언트 시계가 틀려도 정확하다.
function mapBoardToBeds(board) {
  const assignTimeoutMs = (board.settings?.assign_timeout_min ?? 15) * 60000
  const serverNow = board.server_now
  return board.beds.map((b) => {
    const s = b.session
    if (!s) {
      return {
        id: b.code, number: b.number, room: b.room,
        status: 'vacant', patientName: '', chartNumber: '',
        startTime: null, durationMinutes: null, sessionId: null,
        // 누가 등록 중이면 { accountId, name }. 카드가 "환자 등록중"으로 잠긴다.
        lockedBy: b.lock ? { accountId: b.lock.account_id, name: b.lock.name } : null,
      }
    }
    const status = s.started_at ? 'in-progress' : 'reserved'
    return {
      id: b.code,
      number: b.number,
      room: b.room,
      status,
      patientName: s.patient.name,
      chartNumber: s.patient.chart_no,
      patientId: s.patient_id,
      startTime: s.started_at,
      durationMinutes: s.duration_minutes,
      sessionId: s.id,
      assignedAt: s.assigned_at,
      lineStaff: s.line_staff,
      mixStaff: s.mix_staff,
      overdue: status === 'reserved' && serverNow - s.assigned_at > assignTimeoutMs,
    }
  })
}

// ─── board 오프라인 캐시 ────────────────────────────────────────────
// 2층 무선 단말은 연결이 끊기는 일이 있다. 마지막으로 성공한 board를 localStorage에 넣어두고
// 서버가 죽었을 때 읽기 전용으로 그 화면을 계속 보여준다.
// 이건 예전의 "localStorage가 원본" 구조로 되돌아가는 게 아니다 — 어디까지나 읽기 전용 캐시고,
// 쓰기는 여전히 전부 서버 액션으로만 나간다. 오프라인 중에는 쓰기 자체를 막는다(App.jsx).
const BOARD_CACHE_KEY = 'infusion-room-board-cache'
const BOARD_CACHE_AT_KEY = 'infusion-room-board-cached-at'

// beds 본문과 시각을 키를 나눠 저장한다 — 변경 없는 폴링(3초마다)에서 30개 베드 JSON을
// 통째로 다시 쓰지 않고 숫자 하나만 갱신하려고.
function writeBoardCache(beds) {
  try {
    localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(beds))
  } catch {
    // 용량 초과 등 — 캐시 실패가 앱을 멈추면 안 된다
  }
}

function touchBoardCacheTime(serverNow) {
  try {
    localStorage.setItem(BOARD_CACHE_AT_KEY, String(serverNow))
  } catch {
    // 위와 동일
  }
}

// 서버가 안 뜬 채로 새로고침했을 때 쓰는 진입점. 캐시가 없거나 깨졌으면 null.
export function readBoardCache() {
  try {
    const raw = localStorage.getItem(BOARD_CACHE_KEY)
    if (!raw) return null
    const beds = JSON.parse(raw)
    if (!Array.isArray(beds)) return null
    const cachedAt = Number(localStorage.getItem(BOARD_CACHE_AT_KEY))
    return { beds, cachedAt: Number.isFinite(cachedAt) && cachedAt > 0 ? cachedAt : null }
  } catch {
    return null
  }
}

// since를 넘기면 서버가 변경 없을 때 { unchanged: true }만 응답 -> 그대로 전달해서
// 호출 쪽(App.jsx)이 불필요한 리렌더를 건너뛸 수 있게 한다.
export async function getBoard(sinceRevision) {
  const query = sinceRevision != null ? `?since=${sinceRevision}` : ''
  const board = await apiFetch(`/board${query}`)
  if (board.unchanged) {
    // 변경이 없다는 건 "이 시점 기준으로 캐시가 최신"이라는 뜻 — 시각만 갱신한다.
    touchBoardCacheTime(board.server_now)
    return { unchanged: true, revision: board.revision, serverNow: board.server_now }
  }
  const beds = mapBoardToBeds(board)
  writeBoardCache(beds)
  touchBoardCacheTime(board.server_now)
  return {
    unchanged: false,
    revision: board.revision,
    serverNow: board.server_now,
    beds,
  }
}

// beds를 통째로 저장하는 함수는 없다 — 서버는 세션 액션(assignBed/startSession/...)
// 단위로만 상태를 바꾸고, 읽기는 항상 getBoard()로 다시 받아온다.

export async function getStaffList() {
  return apiFetch('/staff')
}

export async function lookupPatient(chartNo) {
  return apiFetch(`/patients/lookup?chart_no=${encodeURIComponent(chartNo)}`)
}

// 환자 상세를 연 사실만 서버에 남긴다(접근 로그). 화면 렌더는 이 호출과 무관하므로
// 실패해도 조용히 넘어간다 — 로그 때문에 조회가 막히면 안 된다.
export function logPatientDetailView(chartNo) {
  return apiFetch(`/patients/${encodeURIComponent(chartNo)}/detail-view`, { method: 'POST' })
    .catch((err) => console.error('환자 조회 로그 기록 실패', err))
}

export async function assignBed({ bedCode, chartNo, patientName, lineStaffId }) {
  return apiFetch('/sessions/assign', {
    method: 'POST',
    body: JSON.stringify({
      bed_code: bedCode, chart_no: chartNo, patient_name: patientName, line_staff_id: lineStaffId,
    }),
  })
}

export async function startSession(sessionId, { mixStaffId, durationMinutes, startedAt }) {
  return apiFetch(`/sessions/${sessionId}/start`, {
    method: 'POST',
    body: JSON.stringify({
      mix_staff_id: mixStaffId, duration_minutes: durationMinutes, started_at: startedAt,
    }),
  })
}

export async function cancelSession(sessionId, reason) {
  return apiFetch(`/sessions/${sessionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function moveBedSession(sessionId, bedCode) {
  return apiFetch(`/sessions/${sessionId}/bed`, {
    method: 'PATCH',
    body: JSON.stringify({ bed_code: bedCode }),
  })
}

export async function adjustSessionDuration(sessionId, durationMinutes) {
  return apiFetch(`/sessions/${sessionId}/duration`, {
    method: 'PATCH',
    body: JSON.stringify({ duration_minutes: durationMinutes }),
  })
}

export async function updateSessionStartedAt(sessionId, startedAt) {
  return apiFetch(`/sessions/${sessionId}/started-at`, {
    method: 'PATCH',
    body: JSON.stringify({ started_at: startedAt }),
  })
}

// 등록 잠금 — 획득/하트비트. 남이 등록 중이면 409를 throw한다.
export async function acquireBedLock(bedCode) {
  return apiFetch(`/bed-locks/${encodeURIComponent(bedCode)}`, {
    method: 'POST',
    body: JSON.stringify({ clientId: CLIENT_ID }),
  })
}

// 등록 잠금 해제. 실패해도 조용히 넘어간다(모달 닫기·언마운트 정리용).
export function releaseBedLock(bedCode) {
  return apiFetch(`/bed-locks/${encodeURIComponent(bedCode)}`, {
    method: 'DELETE',
    body: JSON.stringify({ clientId: CLIENT_ID }),
  })
    .catch((err) => console.error('등록 잠금 해제 실패', err))
}

export async function endSession(sessionId, endedAt) {
  return apiFetch(`/sessions/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify(endedAt !== undefined ? { ended_at: endedAt } : {}),
  })
}

export async function updateSessionPatient(sessionId, { patientName, chartNo }) {
  return apiFetch(`/sessions/${sessionId}/patient`, {
    method: 'PATCH',
    body: JSON.stringify({ patient_name: patientName, chart_no: chartNo }),
  })
}

// ─── history — 종료된 세션(이용기록). 서버가 원본, usedMinutes도 매번 계산 ──
function mapHistoryRow(row) {
  return {
    id: row.id,
    sessionId: row.id,
    date: new Date(row.ended_at).toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }),
    room: ROOM_LABELS[row.room] ?? row.room,
    bedNumber: row.bed_number,
    patientName: row.patient_name,
    chartNumber: row.chart_no,
    startTime: new Date(row.started_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(row.ended_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    usedMinutes: Math.round((row.ended_at - row.started_at) / 60000),
    deleted: !!row.deleted,
  }
}

export async function loadHistory() {
  const rows = await apiFetch('/history')
  return rows.map(mapHistoryRow)
}

export async function toggleHistoryDeleted(sessionId, deleted) {
  return apiFetch(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ deleted }) })
}

// ─── rounds ─────────────────────────────────────────────────────────
function mapRoundRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    chartNumber: row.chart_no,
    occurredAt: new Date(row.occurred_at).toISOString(),
    temperature: row.temperature,
    state: row.state,
    memo: row.memo,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: null,
    deleted: !!row.deleted,
  }
}

export async function loadRounds() {
  const rows = await apiFetch('/rounds')
  return rows.map(mapRoundRow)
}

export async function createRound({ sessionId, occurredAt, temperature, state, memo }) {
  return apiFetch(`/sessions/${sessionId}/rounds`, {
    method: 'POST',
    body: JSON.stringify({ occurred_at: occurredAt, temperature, state, memo }),
  })
}

// ─── session_notes — 금일 특이사항 ──────────────────────────────────
function mapSessionNoteRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    chartNumber: row.chart_no,
    occurredAt: new Date(row.occurred_at).toISOString(),
    elapsedMin: row.elapsed_min,
    symptoms: row.symptoms,
    actions: row.actions,
    memo: row.memo,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: null,
    deleted: !!row.deleted,
  }
}

export async function loadSessionNotes() {
  const rows = await apiFetch('/session-notes')
  return rows.map(mapSessionNoteRow)
}

export async function createSessionNote({ sessionId, occurredAt, symptoms, actions, memo }) {
  return apiFetch(`/sessions/${sessionId}/session-notes`, {
    method: 'POST',
    body: JSON.stringify({ occurred_at: occurredAt, symptoms, actions, memo }),
  })
}

export async function toggleSessionNoteDeleted(id, deleted) {
  return apiFetch(`/session-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ deleted }) })
}

// ─── patient_notes — 환자 주의사항 ──────────────────────────────────
function mapPatientNoteRow(row) {
  return {
    id: row.id,
    chartNumber: row.chart_no,
    patientName: row.patient_name,
    category: row.category,
    content: row.content,
    source: row.source,
    active: !!row.active,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    createdBy: null,
    deleted: !!row.deleted,
  }
}

export async function loadPatientNotes() {
  const rows = await apiFetch('/patient-notes')
  return rows.map(mapPatientNoteRow)
}

export async function createPatientNote({ patientId, category, source, content }) {
  return apiFetch(`/patients/${patientId}/patient-notes`, {
    method: 'POST',
    body: JSON.stringify({ category, source, content }),
  })
}

export async function togglePatientNoteDeleted(id, { deleted, active } = {}) {
  const body = {}
  if (deleted !== undefined) body.deleted = deleted
  if (active !== undefined) body.active = active
  return apiFetch(`/patient-notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// ─── admin — 계정·직원·설정 관리 (admin 롤 전용, 물리삭제 없음) ────────
function mapAdminAccount(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: !!row.is_active,
  }
}

export async function listAccounts() {
  const rows = await apiFetch('/admin/accounts')
  return rows.map(mapAdminAccount)
}

export async function createAccount({ username, displayName, password, role }) {
  return apiFetch('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ username, display_name: displayName, password, role }),
  })
}

export async function updateAccount(id, { displayName, password, role, isActive } = {}) {
  const body = {}
  if (displayName !== undefined) body.display_name = displayName
  if (password) body.password = password
  if (role !== undefined) body.role = role
  if (isActive !== undefined) body.is_active = isActive
  return apiFetch(`/admin/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

function mapAdminStaff(row) {
  return { id: row.id, name: row.name, isActive: !!row.is_active, sortOrder: row.sort_order }
}

export async function listStaffAdmin() {
  const rows = await apiFetch('/admin/staff')
  return rows.map(mapAdminStaff)
}

export async function createStaffMember(name) {
  return apiFetch('/admin/staff', { method: 'POST', body: JSON.stringify({ name }) })
}

export async function updateStaffMember(id, { name, isActive, sortOrder } = {}) {
  const body = {}
  if (name !== undefined) body.name = name
  if (isActive !== undefined) body.is_active = isActive
  if (sortOrder !== undefined) body.sort_order = sortOrder
  return apiFetch(`/admin/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function listSettings() {
  return apiFetch('/admin/settings')
}

export async function updateSetting(key, value) {
  return apiFetch(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) })
}

// ─── 쪽지 메신저 ────────────────────────────────────────────────────
// 직원 화면에서 쪽지가 살아있는 시간. 서버(routes/messages.js)와 같은 값이어야 한다.
export const MESSAGE_TTL_MS = 10 * 60 * 1000

export async function getInbox() {
  return apiFetch('/messages')
}

export async function sendMessage({ to, content, inReplyTo }) {
  return apiFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({ to, content, in_reply_to: inReplyTo }),
  })
}

// 읽음처리가 실패해도 카드는 닫는다(사용자 입장에선 이미 확인한 쪽지).
// 서버에 안 닿았으면 다음 폴링에 다시 뜨는데, 그게 조용히 사라지는 것보다 낫다.
export async function markMessageRead(id) {
  return apiFetch(`/messages/${id}/read`, { method: 'POST' })
    .catch((err) => console.error('쪽지 읽음처리 실패', err))
}

export async function getRecipients() {
  return apiFetch('/messages/recipients')
}

export async function getAdminMessages(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  const q = new URLSearchParams(clean).toString()
  return apiFetch(`/admin/messages${q ? `?${q}` : ''}`)
}
