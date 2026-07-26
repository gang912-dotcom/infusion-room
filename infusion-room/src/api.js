// ─── 데이터 접근 레이어 ──────────────────────────────────────────
// beds는 서버(session 액션 모델) 기준. history/session_notes/patient_notes/rounds는
// 아직 localStorage 그대로 — 4단계 나머지 작업(폴링, server_now 전환)에서 함께 정리한다.

const HISTORY_STORAGE_KEY = 'infusion-room-history'
const SESSION_NOTES_STORAGE_KEY = 'infusion-room-session-notes'
const PATIENT_NOTES_STORAGE_KEY = 'infusion-room-patient-notes'
const ROUNDS_STORAGE_KEY = 'infusion-room-rounds'

function loadArrayFromStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

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

// 서버 board 응답 -> 기존 App.jsx가 쓰던 flat bed 배열 형태로 변환.
// status는 vacant/reserved/in-progress까지만 서버 기준으로 정하고, in-progress -> completed
// 승격은 기존처럼 App.jsx의 markCompletedIfNeeded(now 기준)가 그대로 담당한다.
function mapBoardToBeds(board) {
  const assignTimeoutMs = (board.settings?.assign_timeout_min ?? 15) * 60000
  const now = Date.now()
  return board.beds.map((b) => {
    const s = b.session
    if (!s) {
      return {
        id: b.code, number: b.number, room: b.room,
        status: 'vacant', patientName: '', chartNumber: '',
        startTime: null, durationMinutes: null, sessionId: null,
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
      startTime: s.started_at,
      durationMinutes: s.duration_minutes,
      sessionId: s.id,
      assignedAt: s.assigned_at,
      lineStaff: s.line_staff,
      mixStaff: s.mix_staff,
      overdue: status === 'reserved' && now - s.assigned_at > assignTimeoutMs,
    }
  })
}

export async function loadBeds() {
  const board = await apiFetch('/board')
  return mapBoardToBeds(board)
}

// beds를 통째로 저장하는 함수는 없다 — 서버는 세션 액션(assignBed/startSession/...)
// 단위로만 상태를 바꾸고, 읽기는 항상 loadBeds()로 다시 받아온다.

export async function getStaffList() {
  return apiFetch('/staff')
}

export async function lookupPatient(chartNo) {
  return apiFetch(`/patients/lookup?chart_no=${encodeURIComponent(chartNo)}`)
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

export function loadHistory() {
  return loadArrayFromStorage(HISTORY_STORAGE_KEY)
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
}

export function loadSessionNotes() {
  return loadArrayFromStorage(SESSION_NOTES_STORAGE_KEY)
}

export function saveSessionNotes(sessionNotes) {
  localStorage.setItem(SESSION_NOTES_STORAGE_KEY, JSON.stringify(sessionNotes))
}

export function loadPatientNotes() {
  return loadArrayFromStorage(PATIENT_NOTES_STORAGE_KEY)
}

export function savePatientNotes(patientNotes) {
  localStorage.setItem(PATIENT_NOTES_STORAGE_KEY, JSON.stringify(patientNotes))
}

export function loadRounds() {
  return loadArrayFromStorage(ROUNDS_STORAGE_KEY)
}

export function saveRounds(rounds) {
  localStorage.setItem(ROUNDS_STORAGE_KEY, JSON.stringify(rounds))
}
