import bcrypt from 'bcryptjs'
import db from './db.js'

const now = Date.now()

// ─── beds 40개 (기존 createDefaultBeds() 순서 그대로 + 기타 10개) ──────
// room 키는 화면 라벨이 아니라 DB·베드코드 값이다 — 라벨은 src/api.js의 ROOM_LABELS 한 곳.
const beds = [
  ...Array.from({ length: 6 }, (_, i) => ({ code: `room2-${22 + i}`, room: 'room2', number: String(22 + i) })),
  ...Array.from({ length: 13 }, (_, i) => ({ code: `room3-${1 + i}`, room: 'room3', number: String(1 + i) })),
  ...Array.from({ length: 11 }, (_, i) => ({ code: `floor2-${i + 1}`, room: 'floor2', number: `2F-${i + 1}` })),
  ...Array.from({ length: 10 }, (_, i) => ({ code: `etc-${i + 1}`, room: 'etc', number: String(i + 1) })),
]

const insertBed = db.prepare(
  'INSERT OR IGNORE INTO beds (code, room, number, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
)
beds.forEach((bed, i) => insertBed.run(bed.code, bed.room, bed.number, i))

// ─── settings 8개 (v4 §4) ──────────────────────────────────────────
const settings = {
  round_interval_min: '30',
  round_soon_lead_min: '10',
  fever_mild_min: '37.5',
  fever_high_min: '38.0',
  default_duration_min: '120',
  min_duration_min: '10',
  chart_no_max: '999999',
  assign_timeout_min: '15',
}

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
)
Object.entries(settings).forEach(([key, value]) => insertSetting.run(key, value, now))

// ─── 표준 어휘 코드 5종 (v4 §13) ────────────────────────────────────
const symptomCodes = [
  ['vein_pain', '혈관통'], ['palpitation', '두근거림'], ['chest_tightness', '답답함'],
  ['nausea', '매스꺼움'], ['vomiting', '구토'], ['dizziness', '어지럼'],
  ['feverish', '발열감'], ['swelling', '붓기'], ['leakage', '누출'],
]
const actionCodes = [
  ['warm_pack', '찜질팩'], ['rate_adjust', '속도조절'], ['stop', '중단'],
  ['improved', '호전'], ['observe', '경과관찰'],
]
const roundStates = [
  ['good', '양호'], ['sleeping', '수면 중'], ['discomfort', '불편감 호소'], ['fever', '발열'],
]
const noteCategories = [
  ['warning', '경고'], ['caution', '주의'], ['info', '참고'],
]
const noteSources = [
  ['patient_report', '환자 진술'], ['clinic_relay', '진료실 전달'], ['direct_obs', '직접 관찰'],
]

function seedVocab(table, rows) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ${table} (code, label, sort_order, is_active) VALUES (?, ?, ?, 1)`,
  )
  rows.forEach(([code, label], i) => insert.run(code, label, i))
}

seedVocab('symptom_codes', symptomCodes)
seedVocab('action_codes', actionCodes)
seedVocab('round_states', roundStates)
seedVocab('note_categories', noteCategories)
seedVocab('note_sources', noteSources)

// ─── accounts — admin 1개 ──────────────────────────────────────────
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD
if (!adminPassword) {
  throw new Error('ADMIN_INITIAL_PASSWORD 환경변수가 필요합니다')
}
db.prepare(
  `INSERT OR IGNORE INTO accounts (username, display_name, password_hash, role, is_active, created_at, updated_at)
   VALUES ('admin', '관리자', ?, 'admin', 1, ?, ?)`,
).run(bcrypt.hashSync(adminPassword, 10), now, now)

// ─── staff — 사용자 제공 8명 (name에 unique 제약이 없어 count로 직접 가드) ──
if (db.prepare('SELECT COUNT(*) c FROM staff').get().c === 0) {
  const staffNames = ['이현숙', '박민순', '박소연', '최유진', '신현지', '최지우', '신예슬', '김지윤']
  const insertStaff = db.prepare(
    'INSERT INTO staff (name, is_active, sort_order, created_at) VALUES (?, 1, ?, ?)',
  )
  staffNames.forEach((name, i) => insertStaff.run(name, i, now))
}

console.log('시드 완료:', {
  beds: db.prepare('SELECT COUNT(*) c FROM beds').get().c,
  settings: db.prepare('SELECT COUNT(*) c FROM settings').get().c,
  symptom_codes: db.prepare('SELECT COUNT(*) c FROM symptom_codes').get().c,
  action_codes: db.prepare('SELECT COUNT(*) c FROM action_codes').get().c,
  round_states: db.prepare('SELECT COUNT(*) c FROM round_states').get().c,
  note_categories: db.prepare('SELECT COUNT(*) c FROM note_categories').get().c,
  note_sources: db.prepare('SELECT COUNT(*) c FROM note_sources').get().c,
  accounts: db.prepare('SELECT COUNT(*) c FROM accounts').get().c,
  staff: db.prepare('SELECT COUNT(*) c FROM staff').get().c,
})
