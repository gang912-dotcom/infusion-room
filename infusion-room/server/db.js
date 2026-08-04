import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DB_PATH || path.join(dataDir, 'infusion.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

// schema.sql은 CREATE TABLE IF NOT EXISTS라 이미 만들어진 DB엔 새 컬럼이 안 생긴다 — 직접 보강.
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name)
if (!sessionColumns.includes('deleted')) {
  db.exec('ALTER TABLE sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
}
if (!sessionColumns.includes('special_note')) {
  db.exec('ALTER TABLE sessions ADD COLUMN special_note TEXT')
}
if (!sessionColumns.includes('exam_room')) {
  db.exec('ALTER TABLE sessions ADD COLUMN exam_room TEXT')
}
if (!sessionColumns.includes('visit_symptom')) {
  db.exec('ALTER TABLE sessions ADD COLUMN visit_symptom TEXT')
}

// 라인 제거 담당자 — 종료 시 라인을 뽑은 직원을 기록한다. 라인·믹스 담당과 같은 staff 참조.
if (!sessionColumns.includes('end_staff_id')) {
  db.exec('ALTER TABLE sessions ADD COLUMN end_staff_id INTEGER REFERENCES staff(id)')
}

// 종료 시 얼린 기록지 데이터(JSON). 종료 후 원본을 고쳐도 공식본은 이 값이 남는다.
if (!sessionColumns.includes('record_snapshot')) {
  db.exec('ALTER TABLE sessions ADD COLUMN record_snapshot TEXT')
}

// 직원 자필 서명 — base64 dataURL을 컬럼에 넣는다. 파일시스템에 두지 않는 이유는
// 기존 DB 백업(backup.bat)에 그대로 딸려가고 경로 관리·정적 서빙이 필요 없어서다.
const staffColumns = db.prepare('PRAGMA table_info(staff)').all().map((c) => c.name)
if (!staffColumns.includes('signature')) {
  db.exec('ALTER TABLE staff ADD COLUMN signature TEXT')
}

// ─── 투여경로·수량 (2026-08-04) ───────────────────────────────────────
// schema.sql은 CREATE ... IF NOT EXISTS라 이미 만들어진 DB엔 안 먹는다 — 직접 보강.
const orderItemColumns = db.prepare('PRAGMA table_info(order_items)').all().map((c) => c.name)
if (!orderItemColumns.includes('route')) {
  db.exec('ALTER TABLE order_items ADD COLUMN route TEXT')
}
const bundleColumns = db.prepare('PRAGMA table_info(order_bundles)').all().map((c) => c.name)
if (!bundleColumns.includes('emr_code')) {
  db.exec('ALTER TABLE order_bundles ADD COLUMN emr_code TEXT')
}

// session_orders·order_bundle_items는 PK가 바뀐다 — 같은 항목을 dose만 달리해 2행 담아야
// 하기 때문이다(NS 180 + NS 110 두 백을 함께 투약하는 처방이 있다).
// SQLite에는 PK를 바꾸는 ALTER가 없어 테이블을 새로 만들어 옮기는 수밖에 없다.
// dose는 NOT NULL DEFAULT '' — PK 컬럼에 NULL이 들어가면 SQLite가 유니크로 세지 않아
// 중복 행이 조용히 쌓인다(기존 NULL은 ''로 옮긴다).
// qty 컬럼 존재 여부를 이 마이그레이션의 표시로 쓴다.
function rebuildWithDoseKey(table, createSql, keyColumn) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'qty')) return
  // 외래키를 끈 상태에서 해야 한다(SQLite 권장 절차) — pragma는 트랜잭션 안에서 무시된다.
  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    db.exec(createSql)
    db.exec(`INSERT INTO ${table}_new (${keyColumn}, item_code, dose, qty)
             SELECT ${keyColumn}, item_code, COALESCE(dose, ''), 1 FROM ${table}`)
    db.exec(`DROP TABLE ${table}`)
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`)
  })()
  db.pragma('foreign_keys = ON')
}

rebuildWithDoseKey('session_orders', `
  CREATE TABLE session_orders_new (
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    item_code  TEXT    NOT NULL,
    dose       TEXT    NOT NULL DEFAULT '',
    qty        INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (session_id, item_code, dose)
  )`, 'session_id')

rebuildWithDoseKey('order_bundle_items', `
  CREATE TABLE order_bundle_items_new (
    bundle_id INTEGER NOT NULL REFERENCES order_bundles(id),
    item_code TEXT    NOT NULL,
    dose      TEXT    NOT NULL DEFAULT '',
    qty       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (bundle_id, item_code, dose)
  )`, 'bundle_id')

// ─── 수액 Order 항목 시드 ─────────────────────────────────────────────
// 라벨은 원내 표기 그대로. code는 유일해야 한다 — ORD·MPC FILTER SET이 두 그룹에
// 중복 등장하므로 접미(_basic/_imsc, _basic/_flu)로 갈랐다.
// 배열 순서가 곧 sort_order다.
const ORDER_SEED = [
  { code: 'ns', label: 'n/s', group: '기본', doses: '110,180,100' },
  { code: 'nac', label: '엔에이씨', group: '기본' },
  { code: 'licorice', label: '감초', group: '기본' },
  { code: 'merit', label: '메리트씨', group: '기본', doses: '5g,10g' },
  { code: 'meganesium', label: '메가네슘', group: '기본' },
  { code: 'panbicomp', label: '판비콤프', group: '기본' },
  { code: 'b5', label: 'B5', group: '기본' },
  { code: 'b6', label: 'B6', group: '기본' },
  { code: 'b12', label: 'B12', group: '기본' },
  { code: 'gcbbon', label: '지씨비본', group: '기본' },
  { code: 'furiamin', label: '후리아민/페디아민', group: '기본' },
  { code: 'lainec', label: '라이넥', group: '기본' },
  { code: 'mpc_basic', label: 'MPC FILTER SET', group: '기본' },
  { code: 'denogan', label: '데노간', group: '기본' },
  { code: 'ord_basic', label: 'ORD', group: '기본' },
  { code: 'ns100_ins', label: '(급여) n/s 100', group: '기본' },

  { code: 'multi5', label: '멀티 5주', group: '치료제' },
  { code: 'dipeptiven', label: '디펩티벤', group: '치료제' },
  { code: 'ns10_tathion', label: 'NS10+타치온', group: '치료제' },
  { code: 'macperan', label: '맥페란', group: '치료제' },
  { code: 'tiropa', label: '티로파', group: '치료제' },
  { code: 'peniramin', label: '페니라민', group: '치료제' },
  { code: 'cepha_ns100', label: '세파+NS100', group: '치료제' },
  { code: 'dw110', label: 'DW110', group: '치료제' },
  { code: 'thioctacid', label: '치옥트산', group: '치료제' },
  { code: 'omegaven', label: '오메가벤', group: '치료제' },
  { code: 'calkilate', label: '칼킬레이트', group: '치료제' },
  { code: 'ginko', label: '징코', group: '치료제' },
  { code: 'cartin', label: '카르틴', group: '치료제' },
  { code: 'vitri', label: '브이트리', group: '치료제' },
  { code: 'ferry', label: '페리', group: '치료제' },

  { code: 'immune', label: '면역주사', group: 'IM,SC' },
  { code: 'vitd', label: '비타D', group: 'IM,SC' },
  { code: 'histobulin', label: '히스토블린', group: 'IM,SC' },
  { code: 'dp', label: 'DP', group: 'IM,SC' },
  { code: 'tr', label: 'TR', group: 'IM,SC' },
  { code: 'ord_imsc', label: 'ORD', group: 'IM,SC' },

  { code: 'ns50', label: 'n/s 50', group: '독감' },
  { code: 'peramiflu', label: '페라미플루', group: '독감' },
  { code: 'peravit', label: '페라비트주', group: '독감' },
  { code: 'mpc_flu', label: 'MPC FILTER SET', group: '독감' },

  { code: 'distilled', label: '증류수', group: '증류수', freeText: true },
]

// 빈 테이블일 때 1회만 — INSERT OR IGNORE를 매번 돌리면 관리자가 지운 항목이
// 재부팅 때마다 되살아난다(3b에서 CRUD가 붙으므로 지금부터 지켜야 한다).
if (db.prepare('SELECT COUNT(*) c FROM order_items').get().c === 0) {
  const ins = db.prepare(
    'INSERT INTO order_items (code, label, group_key, dose_options, free_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  )
  db.transaction(() => {
    ORDER_SEED.forEach((r, i) => ins.run(r.code, r.label, r.group, r.doses ?? null, r.freeText ? 1 : 0, i))
  })()
}

// ─── 투여경로(IV/IM/SC) ──────────────────────────────────────────────
// 위 시드보다 나중에 생긴 항목이라 이미 시드된 운영 DB에는 없다 → 따로 넣는다.
// sort_order를 음수로 두는 이유: 기존 항목이 0..41을 쓰고 있어 그룹 안 맨 앞에 오게 하려면
// 재번호 없이 앞으로 밀어야 한다.
// settings 플래그로 1회만 — 존재 여부로 판단하면 관리자가 지운 항목이 재부팅마다 되살아난다.
const ROUTE_SEED = [
  { code: 'route_iv', label: 'IV' },
  { code: 'route_im', label: 'IM' },
  { code: 'route_sc', label: 'SC' },
]
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'order_route_seeded'").get()) {
  const insRoute = db.prepare(
    'INSERT OR IGNORE INTO order_items (code, label, group_key, sort_order) VALUES (?, ?, ?, ?)',
  )
  const insFlag = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  db.transaction(() => {
    ROUTE_SEED.forEach((r, i) => insRoute.run(r.code, r.label, '투여경로', i - ROUTE_SEED.length))
    insFlag.run('order_route_seeded', '1', Date.now())
  })()
}

export default db
