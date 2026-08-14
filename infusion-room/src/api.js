// ─── 데이터 접근 레이어 ──────────────────────────────────────────
// beds, history, rounds, session_notes, patient_notes 전부 서버 기준.
// localStorage는 더 이상 쓰지 않는다.

// 방 라벨은 여기 한 벌만 둔다 — App.jsx의 탭도 이걸로 만든다.
// 두 벌로 두면 이름을 바꿀 때 한쪽만 바뀌고, 통계는 라벨을 집계 키로 쓰기 때문에
// 그 방 막대가 조용히 0이 된다. id(room3)는 DB·베드코드라 바꾸지 않는다.
// 순서가 곧 탭 순서이자 통계 막대 순서다(stats.js가 이 객체의 키 순서를 쓴다).
export const ROOM_LABELS = {
  room2: '2수액실', room3: '수액센터', floor2: '2층수액실', etc: '기타',
}

// 물리적으로 베드가 있는 방이 아닌 것. '기타'는 진료실·로비처럼 수액실 밖에서 맞는 경우를
// 배정하려고 둔 자리라, 빈 자리를 정원으로 세면 없는 베드가 있는 것처럼 보인다.
// 사람이 실제로 앉아 있으면 그건 센다 — 환자는 실재한다.
export const NON_BED_ROOMS = new Set(['etc'])

// 진료실 번호 — 연속이 아니다(4·5진료실은 없음). 서버(sessions.js EXAM_ROOMS)와 같은 목록.
// 등록 폼과 통계가 같은 목록을 봐야 한다. 두 벌로 두면 번호가 하나 늘 때 한쪽만 바뀌고
// 통계에서 그 진료실이 조용히 빠진다(방 라벨에서 이미 겪은 일이다).
export const EXAM_ROOMS = ['1', '2', '3', '6', '7']

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error ?? `요청 실패 (${res.status})`)
    // 응답 본문을 그대로 달아 둔다 — 문구 말고 값이 필요한 곳이 있다.
    // (배정 409의 active_bed로 '이미 수액센터 3번에 있습니다'를 만든다.)
    err.data = data
    throw err
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
      gender: s.patient.gender ?? null,
      patientId: s.patient_id,
      startTime: s.started_at,
      durationMinutes: s.duration_minutes,
      sessionId: s.id,
      assignedAt: s.assigned_at,
      specialNote: s.special_note ?? null,
      // 환자 메모 — 차트번호 기준이라 방문을 넘어 따라온다(특이사항은 방문 단위).
      dayMemo: s.day_memo ?? null,
      hasPrescription: !!s.has_prescription,
      examRoom: s.exam_room ?? null,
      visitSymptom: s.visit_symptom ?? null,
      // 카드 우상단 바이탈 — 서버가 '필드별 최신'으로 골라 보낸다
      latestTemp: s.latest_temp ?? null,
      latestBp: s.latest_bp ?? null,
      latestPulse: s.latest_pulse ?? null,
      lineStaff: s.line_staff,
      lineStaffId: s.line_staff_id ?? null,
      mixStaff: s.mix_staff,
      mixStaffId: s.mix_staff_id ?? null,
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
    return {
      unchanged: true, revision: board.revision, serverNow: board.server_now,
      chatLatestId: board.chat_latest_id ?? 0,
    }
  }
  const beds = mapBoardToBeds(board)
  writeBoardCache(beds)
  touchBoardCacheTime(board.server_now)
  return {
    unchanged: false,
    revision: board.revision,
    serverNow: board.server_now,
    beds,
    // 마스터 설정에서 고칠 수 있는 값들(미열·고열 기준 등). 카드가 이걸 읽어야
    // 설정 화면이 실제로 뭔가를 바꾸는 칸이 된다 — 안 읽으면 "바꿨는데 왜 그대로냐"가 된다.
    settings: board.settings ?? null,
    chatLatestId: board.chat_latest_id ?? 0,
  }
}

// beds를 통째로 저장하는 함수는 없다 — 서버는 세션 액션(assignBed/startSession/...)
// 단위로만 상태를 바꾸고, 읽기는 항상 getBoard()로 다시 받아온다.

export async function getStaffList() {
  return apiFetch('/staff')
}

// 이름·차트번호로 환자를 찾는다(배정 화면 검색칸). lookup과 달리 이름 부분 일치를 지원한다.
// 응답에 baseline_note와 현재 베드가 함께 와서 배정 모달을 여는 데 추가 왕복이 없다.
export async function searchPatients(q) {
  const trimmed = String(q ?? '').trim()
  if (!trimmed) return []
  return apiFetch(`/patients/search?q=${encodeURIComponent(trimmed)}`)
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

export async function assignBed({ bedCode, chartNo, patientName, lineStaffId, specialNote, examRoom, gender }) {
  return apiFetch('/sessions/assign', {
    method: 'POST',
    body: JSON.stringify({
      bed_code: bedCode, chart_no: chartNo, patient_name: patientName, line_staff_id: lineStaffId,
      // 미지정('')은 서버가 null로 본다. null이면 기존 성별을 덮지 않는다.
      special_note: specialNote, exam_room: examRoom, gender,
    }),
  })
}

// 담당자 변경(교대·오등록 정정) — 상세에서 고르는 즉시 호출한다.
// 라인·믹스 중 바꾸는 쪽만 보낸다. 안 보낸 필드는 서버가 건드리지 않는다.
export async function editSessionStaff(sessionId, patch) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// 진료실 변경(오등록 정정) — 상세에서 호출.
export async function editSessionExamRoom(sessionId, examRoom) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ exam_room: examRoom }),
  })
}

// ─── 수액 Order / 처방 확인 ─────────────────────────────────────────
// 체크리스트 항목은 DB가 원본이다. 화면에 하드코딩된 목록은 없다.
export async function getOrderItems() {
  return apiFetch('/order-items')
}

export async function getPrescription(sessionId) {
  return apiFetch(`/sessions/${sessionId}/prescription`)
}

// 오더 체크와 내원당시증상을 한 번에 저장한다(세션 단위 전체 재작성).
// bundleId는 처방 내용이 아니라 '어느 묶음에서 시작했나'라는 대조 기준이다 — 다시 열었을 때
// '고른 처방' 칸이 묶음에서 뭘 바꿨는지 보여주는 데 쓴다. 묶음 없이 골랐으면 null.
export async function savePrescription(sessionId, { items, visitSymptom, bundleId = null }) {
  return apiFetch(`/sessions/${sessionId}/prescription`, {
    method: 'PUT',
    body: JSON.stringify({ items, visit_symptom: visitSymptom, bundle_id: bundleId }),
  })
}

// 묶음처방 — 처방 확인 모달의 묶음 버튼용(활성 묶음만).
export async function getOrderBundles() {
  return apiFetch('/order-bundles')
}

// ─── 관리자 전용 (서버도 requireAdmin으로 이중 방어) ─────────────────
// 관리자 목록은 비활성까지 다 준다 — 다시 켜려면 화면에 보여야 한다.
export async function listOrderItemsAdmin() {
  return apiFetch('/admin/order-items')
}

export async function createOrderItem(body) {
  return apiFetch('/admin/order-items', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateOrderItem(id, body) {
  return apiFetch(`/admin/order-items/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// 참조가 있으면 서버가 409를 준다 — 화면은 그때 비활성 전환을 권한다.
export async function deleteOrderItem(id) {
  return apiFetch(`/admin/order-items/${id}`, { method: 'DELETE' })
}

export async function listOrderBundlesAdmin() {
  return apiFetch('/admin/order-bundles')
}

export async function createOrderBundle(body) {
  return apiFetch('/admin/order-bundles', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateOrderBundle(id, body) {
  return apiFetch(`/admin/order-bundles/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function deleteOrderBundle(id) {
  return apiFetch(`/admin/order-bundles/${id}`, { method: 'DELETE' })
}

// 특이사항(기저질환) 편집. 서버가 이 방문 스냅샷과 환자 정본(baseline_note)을 함께 쓴다.
export async function editSessionSpecialNote(sessionId, specialNote) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ special_note: specialNote }),
  })
}

// 내원당시증상은 3a단계에서 '처방 확인'(savePrescription)으로 옮겼다 — 여기선 안 보낸다.
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

// 라인 제거 담당자(endStaffId)은 필수다 — 서버가 없으면 400을 준다.
export async function endSession(sessionId, endedAt, endStaffId) {
  return apiFetch(`/sessions/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({
      ...(endedAt !== undefined ? { ended_at: endedAt } : {}),
      end_staff_id: endStaffId,
    }),
  })
}

// 실수로 종료한 세션을 다시 이용 중으로. 그 사이 베드가 찼으면 서버가 400을 준다.
export async function restoreSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}/restore`, { method: 'POST' })
}

// gender를 넘기지 않으면 서버가 성별을 건드리지 않는다. ''를 넘기면 미지정으로 지운다.
export async function updateSessionPatient(sessionId, { patientName, chartNo, gender }) {
  return apiFetch(`/sessions/${sessionId}/patient`, {
    method: 'PATCH',
    body: JSON.stringify({ patient_name: patientName, chart_no: chartNo, gender }),
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
    // 위 date/startTime/endTime은 표에 그대로 찍는 로캘 문자열이라 되돌려 계산할 수가 없다
    // ('2026. 08. 10.' · '오전 09:00'). 통계는 시간대·요일로 묶어야 해서 원본 ms가 필요하고,
    // 수액실도 라벨이 아니라 키로 세야 한다(room은 이미 라벨로 바뀐 값이다).
    roomKey: row.room,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    bedNumber: row.bed_number,
    patientName: row.patient_name,
    chartNumber: row.chart_no,
    startTime: new Date(row.started_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(row.ended_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    usedMinutes: Math.round((row.ended_at - row.started_at) / 60000),
    specialNote: row.special_note ?? null,
    // 4c — 기록지 필드. CSV 추출과 통계(진료실별 이용건수)가 쓴다. 표 화면은 안 쓴다.
    examRoom: row.exam_room ?? null,
    visitSymptom: row.visit_symptom ?? null,
    lineStaff: row.line_staff_name ?? null,
    mixStaff: row.mix_staff_name ?? null,
    endStaff: row.end_staff_name ?? null,
    dayMemo: row.day_memo ?? null,
    orders: row.orders ?? [],
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

// 휴지통 완전삭제 — 관리자 전용. 되돌릴 수 없다. 서버가 deleted=1인 것만 지운다.
export async function purgeSessions(ids) {
  return apiFetch('/admin/sessions/purge', { method: 'POST', body: JSON.stringify({ ids }) })
}

// ─── 취소된 배정 (마스터 전용) ───────────────────────────────────────
// 취소는 삭제가 아니라 표시라 되살릴 수 있다. 종료를 누르려다 등록 취소를 누른 경우.
export async function listCancelledSessions(days = 7) {
  return apiFetch(`/admin/cancelled?days=${days}`)
}

// endedAt(ms)을 주면 카드로 돌리지 않고 곧장 이용기록으로 보낸다 — 그 베드에 이미
// 다른 환자가 있어 자리가 없을 때. 자리가 있으면 안 주는 쪽이 낫다(정상 종료 절차를 탄다).
export async function uncancelSession(sessionId, endedAt = null) {
  return apiFetch(`/admin/sessions/${sessionId}/uncancel`, {
    method: 'POST',
    body: JSON.stringify(endedAt == null ? {} : { ended_at: endedAt }),
  })
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

export async function createRound({ sessionId, occurredAt, memo }) {
  return apiFetch(`/sessions/${sessionId}/rounds`, {
    method: 'POST',
    body: JSON.stringify({ occurred_at: occurredAt, memo }),
  })
}

export async function toggleRoundDeleted(id, deleted) {
  return apiFetch(`/rounds/${id}`, { method: 'PATCH', body: JSON.stringify({ deleted }) })
}

// 기록 편집(베드 상세 오른쪽 패널). 서버는 전달된 필드만 반영한다.
export async function editRound(id, { occurredAt, memo }) {
  return apiFetch(`/rounds/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ occurred_at: occurredAt, memo }),
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

export async function editSessionNote(id, { occurredAt, symptoms, actions, memo }) {
  return apiFetch(`/session-notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ occurred_at: occurredAt, symptoms, actions, memo }),
  })
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

export async function editPatientNote(id, { content, category, source }) {
  return apiFetch(`/patient-notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content, category, source }),
  })
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
  return {
    id: row.id,
    name: row.name,
    isActive: !!row.is_active,
    sortOrder: row.sort_order,
    // 서명 원본은 목록에 안 실린다 — 등록 여부만 오고 원본은 getStaffSignature로.
    hasSignature: !!row.has_signature,
  }
}

// ─── 당일 메모 (이 방문에만 유효) ────────────────────────────────────
// 구 '환자 메모'는 차트 기준 영구였고 전용 라우트를 썼다. 이제 세션 컬럼이라
// 특이사항·진료실과 같은 PATCH를 탄다. 조회는 보드 payload에 이미 실려 온다.
export async function saveDayMemo(sessionId, dayMemo) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ day_memo: dayMemo }),
  })
}

// 기록지 — 종료됐으면 얼린 스냅샷, 아니면 즉석 조립본. 담당자 서명이 함께 온다.
export async function getSessionRecord(sessionId) {
  return apiFetch(`/sessions/${sessionId}/record`)
}

// 직원 자필 서명 — 원본 dataURL. 관리자 미리보기와 4b 기록지가 쓴다.
export async function getStaffSignature(id) {
  return apiFetch(`/staff/${id}/signature`)
}

// dataURL을 주면 저장, null을 주면 삭제.
export async function setStaffSignature(id, signature) {
  return apiFetch(`/admin/staff/${id}/signature`, {
    method: 'PUT',
    body: JSON.stringify({ signature }),
  })
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

// ─── 환자 수동 삭제 (관리자) ─────────────────────────────────────────
// 검색(searchPatients)으로 찾은 환자를 고른 뒤, 지우기 전에 흔적을 받아 확인시키고 지운다.
export async function getPatientFootprint(chartNo) {
  return apiFetch(`/admin/patients/${encodeURIComponent(chartNo)}/footprint`)
}

export async function deletePatient(chartNo) {
  return apiFetch(`/admin/patients/${encodeURIComponent(chartNo)}`, { method: 'DELETE' })
}

// ─── 통계 화면 잠금 ──────────────────────────────────────────────────
// 암호는 서버에만 해시로 있다. 화면은 맞다/아니다만 받는다 — 내려받아 비교하면 잠근 의미가 없다.
export async function unlockStats(password) {
  return apiFetch('/stats/unlock', { method: 'POST', body: JSON.stringify({ password }) })
}

// 재설정은 관리자만. 현재 암호는 어디서도 읽을 수 없다(해시라 되돌릴 수 없다) —
// 잊어버리면 여기서 새로 정하는 것이 유일한 길이다.
export async function setStatsPassword(password) {
  return apiFetch('/admin/stats-password', { method: 'PUT', body: JSON.stringify({ password }) })
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

// 쪽지 로그 삭제 — 소프트 삭제가 아니라 완전 삭제라 되돌릴 수 없다.
export async function deleteAdminMessage(id) {
  return apiFetch(`/admin/messages/${id}`, { method: 'DELETE' })
}

// 전체발송은 수신자마다 row가 있어 묶음 단위로 지운다(화면도 한 건으로 보여준다).
export async function deleteAdminBroadcast(broadcastId) {
  return apiFetch(`/admin/messages/broadcast/${encodeURIComponent(broadcastId)}`, { method: 'DELETE' })
}

// ─── 바이탈(체온·혈압·맥박) ─────────────────────────────────────────
// 라운딩과 별개로 자유 빈도 기록. 한 번에 잰 항목만 담기고 나머지는 NULL.
function mapVitalsRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    temperature: row.temperature,
    bpSystolic: row.bp_systolic,
    bpDiastolic: row.bp_diastolic,
    pulse: row.pulse,
    createdAt: new Date(row.created_at).toISOString(),
    deleted: !!row.deleted,
  }
}

export async function loadVitals() {
  const rows = await apiFetch('/vitals')
  return rows.map(mapVitalsRow)
}

export async function createVitals(sessionId, { occurredAt, temperature, bpSystolic, bpDiastolic, pulse }) {
  return apiFetch(`/sessions/${sessionId}/vitals`, {
    method: 'POST',
    body: JSON.stringify({
      occurred_at: occurredAt,
      temperature,
      bp_systolic: bpSystolic,
      bp_diastolic: bpDiastolic,
      pulse,
    }),
  })
}

export async function editVitals(id, patch) {
  const body = {}
  if (patch.occurredAt !== undefined) body.occurred_at = patch.occurredAt
  if (patch.temperature !== undefined) body.temperature = patch.temperature
  if (patch.bpSystolic !== undefined) body.bp_systolic = patch.bpSystolic
  if (patch.bpDiastolic !== undefined) body.bp_diastolic = patch.bpDiastolic
  if (patch.pulse !== undefined) body.pulse = patch.pulse
  if (patch.deleted !== undefined) body.deleted = patch.deleted
  return apiFetch(`/vitals/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

// 직전 방문 증상 상기(3단계) — 이 환자의 전 세션 노트를 그대로 받아 클라에서 직전 세션만 추린다.
// 전용 엔드포인트를 새로 만들지 않고 기존 조회를 재사용한다(노트가 많아지면 그때 서버로 옮겨도 됨).
export async function getPatientSessionNotes(patientId) {
  return apiFetch(`/patients/${patientId}/session-notes`)
}

// ─── 전체 채팅방 ─────────────────────────────────────────────────────
// 방이 하나뿐이라 id가 없다. since를 주면 그 이후만 받는다(창이 열려 있을 때 2초 폴링).
export async function getChat(sinceId) {
  const q = sinceId ? `?since=${sinceId}` : ''
  return apiFetch(`/chat${q}`)
}

export async function sendChat(content) {
  return apiFetch('/chat', { method: 'POST', body: JSON.stringify({ content }) })
}

// 공지는 관리자만. 빈 문자열을 보내면 공지를 내린다.
export async function saveChatNotice(text) {
  return apiFetch('/admin/chat/notice', { method: 'PUT', body: JSON.stringify({ text }) })
}

// ─── 채팅 내역 (관리자) ──────────────────────────────────────────────
// 채팅창은 당일 것만 보여준다. 지난 대화는 여기서 날짜별로 본다.
export async function listChatDates() {
  return apiFetch('/admin/chat/dates')
}

// date는 'YYYY-MM-DD'. 지운 것도 함께 온다(deleted 플래그로 구분).
export async function listChatByDate(date) {
  return apiFetch(`/admin/chat?date=${encodeURIComponent(date)}`)
}

// 선택 삭제/복구 — 소프트다. 지워도 내역에는 '삭제됨'으로 남는다.
export async function setChatDeleted(ids, deleted) {
  return apiFetch('/admin/chat/deleted', {
    method: 'POST',
    body: JSON.stringify({ ids, deleted }),
  })
}
