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

// since를 넘기면 서버가 변경 없을 때 { unchanged: true }만 응답 -> 그대로 전달해서
// 호출 쪽(App.jsx)이 불필요한 리렌더를 건너뛸 수 있게 한다.
export async function getBoard(sinceRevision) {
  const query = sinceRevision != null ? `?since=${sinceRevision}` : ''
  const board = await apiFetch(`/board${query}`)
  if (board.unchanged) {
    return { unchanged: true, revision: board.revision, serverNow: board.server_now }
  }
  return {
    unchanged: false,
    revision: board.revision,
    serverNow: board.server_now,
    beds: mapBoardToBeds(board),
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
