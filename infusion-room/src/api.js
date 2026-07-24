// ─── 데이터 접근 레이어 ──────────────────────────────────────────
// 지금은 localStorage 그대로. 서버 전환(4단계) 시 이 파일 내부만 fetch로 교체한다.

const STORAGE_KEY = 'infusion-room-beds'
const HISTORY_STORAGE_KEY = 'infusion-room-history'
const SESSION_NOTES_STORAGE_KEY = 'infusion-room-session-notes'
const PATIENT_NOTES_STORAGE_KEY = 'infusion-room-patient-notes'
const ROUNDS_STORAGE_KEY = 'infusion-room-rounds'

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

export function loadBeds() {
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

export function saveBeds(beds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(beds))
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
