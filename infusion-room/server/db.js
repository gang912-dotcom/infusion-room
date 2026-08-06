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

// ─── 채팅 소프트 삭제 (2026-08-04) ────────────────────────────────────
// schema.sql은 CREATE ... IF NOT EXISTS라 이미 만들어진 DB엔 새 컬럼이 안 생긴다.
const chatColumns = db.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name)
if (chatColumns.length && !chatColumns.includes('deleted')) {
  db.exec('ALTER TABLE chat_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
}

// ─── 당일 메모 · 특이사항(기저질환) 정본 (2026-08-04) ─────────────────
// 두 기능의 지속성이 맞바뀌었다.
//   구 '환자 메모'(patient_memos, 차트 영구) → '당일 메모'(sessions.day_memo, 이 방문만)
//   구 '특이사항'(sessions.special_note, 방문 1회성) → '특이사항(기저질환)' 영구
// 특이사항의 영구성을 세션에서 '최신 non-null 찾기'로 흉내내면 **비워도 옛 값이 되살아나
// 삭제가 불가능하다** → patients.baseline_note를 정본으로 둔다. 세션 special_note는
// 그 방문 스냅샷으로 남아 기록지·CSV가 그대로 읽는다.
if (!sessionColumns.includes('day_memo')) {
  db.exec('ALTER TABLE sessions ADD COLUMN day_memo TEXT')
}
const patientColumns = db.prepare('PRAGMA table_info(patients)').all().map((c) => c.name)
if (!patientColumns.includes('baseline_note')) {
  db.exec('ALTER TABLE patients ADD COLUMN baseline_note TEXT')
}

// 구 환자 메모는 성격상 기저질환 정본에 가깝다(차트별 영구) → 1회 이관한다.
// patient_memos는 지우지 않는다 — 이관이 잘못됐을 때 돌아갈 원본이다.
// 이미 값이 있는 정본은 건드리지 않는다(COALESCE 아니라 IS NULL 조건).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'baseline_note_migrated'").get()) {
  db.transaction(() => {
    const moved = db.prepare(`
      UPDATE patients SET baseline_note = (
        SELECT note FROM patient_memos WHERE patient_memos.chart_no = patients.chart_no
      )
      WHERE baseline_note IS NULL
        AND EXISTS (
          SELECT 1 FROM patient_memos
          WHERE patient_memos.chart_no = patients.chart_no AND TRIM(note) <> ''
        )
    `).run().changes
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('baseline_note_migrated', String(moved), Date.now())
  })()
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
  // 종이 기록지의 '후리아민/페디아민'은 둘 중 하나에 동그라미를 치는 칸이었다.
  // 앱에서는 각각 체크해야 하므로 별개 항목이다.
  { code: 'furiamin', label: '후리아민', group: '기본' },
  { code: 'pediamin', label: '페디아민', group: '기본' },
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

// ─── 투여경로 값·멜스몬·묶음처방 7종 (원장님 EMR 묶음코드 2026-08-04) ──
// 전부 settings 플래그로 '1회만'이다. 무조건 UPDATE하면 관리자가 라벨·경로를 고쳐도
// 재부팅마다 되돌아가고, INSERT OR IGNORE로 두면 지운 항목이 매번 부활한다.
// ⚠️ qty는 EMR 사진 판독값이다 — 원본 대조 전에는 확정이 아니다.
const ROUTE_BY_CODE = {
  immune: 'SC', histobulin: 'SC', melsmon: 'SC',
  vitd: 'IM', dp: 'IM', tr: 'IM',
  // ORD은 용법에 따라 IV/IM이 갈린다 → NULL. 자동 체크에 기여하지 않고 사람이 직접 켠다.
  ord_basic: null, ord_imsc: null,
}

// 묶음 항목: { code, dose?, qty }. dose는 선택형 항목만, qty는 주사제 개수.
const BUNDLE_SEED = [
  { name: '기본수액 (iv200)', emr: '200', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b5' }, { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'mpc_basic' },
  ] },
  { name: '부신기능저하증 (200)', emr: '200-10', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'furiamin' }, { code: 'lainec', qty: 4 }, { code: 'mpc_basic', qty: 2 },
  ] },
  { name: '부신기능저하증 (110)', emr: '110-10', items: [
    { code: 'ns', dose: '110' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'furiamin' }, { code: 'lainec', qty: 4 }, { code: 'mpc_basic', qty: 2 },
  ] },
  { name: '0번 (200+TO+글루타치온+싸이모신)', emr: '0', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b5' }, { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'mpc_basic' }, { code: 'furiamin' }, { code: 'ns10_tathion' },
    // EMR ima7(이뮤알파=싸이모신알파1) = 면역주사 항목. SC.
    { code: 'immune' }, { code: 'denogan', qty: 2 },
  ] },
  { name: '1번 (110-3+De2)', emr: '1', items: [
    // 같은 NS110 두 백 → 행이 아니라 qty로 센다.
    { code: 'ns', dose: '110', qty: 2 },
    { code: 'nac' }, { code: 'licorice' }, { code: 'merit', dose: '5g' },
    { code: 'meganesium' }, { code: 'panbicomp' }, { code: 'b6', qty: 3 },
    { code: 'b12' }, { code: 'gcbbon' }, { code: 'lainec', qty: 4 },
    { code: 'dipeptiven' }, { code: 'multi5' }, { code: 'mpc_basic', qty: 2 },
    { code: 'denogan', qty: 2 },
  ] },
  { name: '2번 (200+De2+글루타치온)', emr: '2', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b5' }, { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'furiamin' }, { code: 'lainec', qty: 4 }, { code: 'mpc_basic', qty: 2 },
    { code: 'denogan' }, { code: 'ns10_tathion' },
  ] },
  { name: '3번 (200+치옥트산)', emr: '3', items: [
    // NS180과 NS110을 둘 다 투약한다 — dose가 다르므로 2행. PK에 dose를 넣은 이유가 이것.
    { code: 'ns', dose: '180' }, { code: 'ns', dose: '110' },
    { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b5' }, { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'lainec', qty: 4 }, { code: 'mpc_basic', qty: 2 }, { code: 'denogan' },
    { code: 'thioctacid', qty: 4 },
  ] },
]

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'order_route_qty_seeded'").get()) {
  db.transaction(() => {
    // 라벨 확정: 면역주사 = 싸이모신알파1(EMR ima7).
    db.prepare("UPDATE order_items SET label = ? WHERE code = 'immune'")
      .run('면역주사(싸이모신알파1)')
    // 멜스몬(SC) 누락분 추가. 그룹 안 맨 뒤로.
    db.prepare(`INSERT OR IGNORE INTO order_items (code, label, group_key, sort_order, route)
                VALUES ('melsmon', '멜스몬', 'IM,SC', ?, 'SC')`)
      .run(db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 m FROM order_items').get().m)
    // 경로 일괄: IM,SC 그룹 밖은 전부 IV. 어제 만든 '투여경로' 3개 항목은 경로를 고르는
    // 체크박스 자체라 대상이 아니다 — 여기에 route가 박히면 자기 자신을 OR 해버린다.
    db.prepare("UPDATE order_items SET route = 'IV' WHERE group_key NOT IN ('IM,SC', '투여경로')").run()
    const setRoute = db.prepare('UPDATE order_items SET route = ? WHERE code = ?')
    for (const [code, route] of Object.entries(ROUTE_BY_CODE)) setRoute.run(route, code)

    // 묶음은 비어 있을 때만 — 관리자가 지운 묶음이 되살아나면 안 된다.
    if (db.prepare('SELECT COUNT(*) c FROM order_bundles').get().c === 0) {
      const insBundle = db.prepare('INSERT INTO order_bundles (name, emr_code, sort_order) VALUES (?, ?, ?)')
      const insItem = db.prepare(
        'INSERT INTO order_bundle_items (bundle_id, item_code, dose, qty) VALUES (?, ?, ?, ?)',
      )
      BUNDLE_SEED.forEach((bundle, i) => {
        const { lastInsertRowid } = insBundle.run(bundle.name, bundle.emr, i)
        bundle.items.forEach((it) => insItem.run(lastInsertRowid, it.code, it.dose ?? '', it.qty ?? 1))
      })
    }
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('order_route_qty_seeded', '1', Date.now())
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

// ─── 후리아민 / 페디아민 분리 (2026-08-04) ────────────────────────────
// 종이 기록지에는 '후리아민/페디아민' 한 칸에 동그라미로 골랐다. 앱에서는 각각 체크해야
// 하므로 별개 항목으로 나눈다. furiamin code는 묶음 4개가 참조하므로 유지하고 라벨만 바꾼다
// (code를 바꾸면 과거 기록·묶음 참조가 끊긴다).
// sort_order를 x.5로 두는 이유: 후리아민 바로 뒤에 놓으면서 뒤 항목을 재번호하지 않기 위해서다.
// SQLite는 INTEGER 선언 컬럼에도 10.5를 real로 보존한다(qty와 같은 성질).
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'furiamin_split'").get()) {
  db.transaction(() => {
    db.prepare("UPDATE order_items SET label = '후리아민' WHERE code = 'furiamin'").run()
    const after = db.prepare("SELECT group_key, sort_order, route FROM order_items WHERE code = 'furiamin'").get()
    if (after) {
      db.prepare(`INSERT OR IGNORE INTO order_items (code, label, group_key, sort_order, route)
                  VALUES ('pediamin', '페디아민', ?, ?, ?)`)
        .run(after.group_key, after.sort_order + 0.5, after.route)
    }
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('furiamin_split', '1', Date.now())
  })()
}

// ─── 묶음처방 15종 추가 (2026-08-06) ──────────────────────────────────
// 원장님 EMR '묶음코드 등록 및 수정' 화면 사진 15장을 옮긴 것이다.
// EMR 등록코드 → 우리 항목코드 매핑(사진에 이미 있던 200-10을 기존 DB와 대조해 확정):
//   NS110/NS180→ns(dose)  nac2/nac3→nac  Gly5→licorice  Vc→merit 10g  Vc1→merit 5g
//   Mgi→meganesium  MVC→panbicomp  bibon→gcbbon  TO→furiamin  to→pediamin
//   La(태반)→lainec  dipep→dipeptiven  s4→vitd  ima3→immune  De→denogan
//   ord→ord_basic  perami1→peramiflu  ivset→mpc_basic  ns10+gluta 두 줄→ns10_tathion 한 항목
//   Mineral→mineral(미량원소) — 카탈로그에 없어 이 마이그레이션에서 함께 만든다
// 사진의 '용량' 칸이 수량이다. EMR은 소수점을 쉼표로 쓴다(0,5 = 0.5) — 반 앰플이라
// qty 소수 지원이 여기서 쓰인다. '연결=병명'인 줄은 진단코드라 처방이 아니다.
// Mgi-1·B5-1 같은 -1 접미사는 청구코드가 같은 동일 제품의 반 앰플이라 같은 항목에 qty로 넣는다.
const BUNDLE_ADD = [
  // NS110 줄이 두 개다(같은 코드·같은 용량). PK가 (묶음, 항목, dose)라 두 행이 될 수 없고,
  // 될 필요도 없다 — 백 두 개는 qty 2다(기존 '1'번 묶음도 같은 방식이다).
  // 3번 묶음의 NS180+NS110만 dose가 달라서 2행이 된다.
  { emr: '110-3', name: '실버 수액 (ima 없는거)', items: [
    { code: 'ns', dose: '110', qty: 2 }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'lainec', qty: 4 }, { code: 'dipeptiven' }, { code: 'mineral' },
    { code: 'mpc_basic', qty: 2 },
  ] },
  { emr: '110-31', name: '실버 수액', items: [
    { code: 'ns', dose: '110', qty: 2 }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'lainec', qty: 4 }, { code: 'dipeptiven' }, { code: 'mineral' },
    { code: 'immune' }, { code: 'mpc_basic', qty: 2 },
  ] },
  { emr: '110-101', name: '부신기능저하증+비타민D', items: [
    { code: 'ns', dose: '110' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'furiamin' },
    { code: 'lainec', qty: 4 }, { code: 'vitd' }, { code: 'mpc_basic', qty: 2 },
  ] },
  { emr: '110-102', name: '부신기능저하증+싸이모신알파', items: [
    { code: 'ns', dose: '110' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'furiamin' },
    { code: 'lainec', qty: 4 }, { code: 'immune' }, { code: 'mpc_basic', qty: 2 },
  ] },
  // EMR 이름이 110-10과 똑같은 '부신기능저하증'이다. 관리자 표에서 구분이 안 되므로
  // 차이나는 부분을 이름에 붙였다(코드는 EMR 그대로다).
  { emr: '110-104', name: '부신기능저하증 (+NS10 타치온)', items: [
    { code: 'ns', dose: '110' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'furiamin' },
    { code: 'lainec', qty: 4 }, { code: 'mpc_basic', qty: 2 }, { code: 'ns10_tathion' },
  ] },
  { emr: '200-202', name: '부신기능저하증(B6-3개) + 이뮤알파주', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice', qty: 2 },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'furiamin' },
    { code: 'lainec', qty: 4 }, { code: 'immune' }, { code: 'mpc_basic', qty: 2 },
  ] },
  { emr: '200-23', name: '부신기능저하증(200-2+데노간 or ord)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice', qty: 2 },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b5' }, { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'furiamin' }, { code: 'lainec', qty: 4 }, { code: 'denogan', qty: 2 },
    { code: 'ord_basic', qty: 0.5 }, { code: 'mpc_basic', qty: 2 },
  ] },
  // 이 묶음만 MVC(판비콤프)가 없다 — 사진에 줄 자체가 없다.
  { emr: '200-004', name: '부신기능저하증(B6-3개)+글루타치온', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' }, { code: 'furiamin' },
    { code: 'lainec', qty: 4 }, { code: 'ns10_tathion' }, { code: 'mpc_basic', qty: 2 },
  ] },
  // corti1/corti2는 EMR 이름이 둘 다 '교감신경항진증'이라 수액백으로 구분해 붙였다.
  { emr: 'corti1', name: '교감신경항진증 (110)', items: [
    { code: 'ns', dose: '110' }, { code: 'nac' }, { code: 'merit', dose: '5g' },
    { code: 'meganesium', qty: 2 }, { code: 'b6', qty: 3 }, { code: 'b12' },
    { code: 'lainec', qty: 4 }, { code: 'mpc_basic' }, { code: 'denogan', qty: 2 },
  ] },
  { emr: 'corti2', name: '교감신경항진증 (180)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'merit', dose: '10g' },
    { code: 'meganesium', qty: 2 }, { code: 'b6', qty: 3 }, { code: 'b12' },
    { code: 'lainec', qty: 4 }, { code: 'mpc_basic' }, { code: 'denogan', qty: 2 },
  ] },
  { emr: 'iv20', name: '소아수액 (편도선염, 고열증)-(고함량비타민)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6' }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'denogan', qty: 1.5 }, { code: 'ord_basic', qty: 0.5 }, { code: 'mpc_basic' },
  ] },
  { emr: 'iv20-1', name: '소아수액 (편도선염, 고열증)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium', qty: 0.5 }, { code: 'panbicomp' },
    { code: 'b5', qty: 0.5 }, { code: 'b6', qty: 0.5 }, { code: 'b12', qty: 0.5 },
    { code: 'gcbbon' }, { code: 'denogan', qty: 1.5 }, { code: 'ord_basic', qty: 0.5 },
    { code: 'mpc_basic' },
  ] },
  { emr: 'iv20-11', name: '소아수액 (편도선염, 고열증)+저영양증(페디아민)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '5g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'gcbbon' }, { code: 'denogan', qty: 1.5 }, { code: 'ord_basic', qty: 0.5 },
    { code: 'pediamin' }, { code: 'mpc_basic', qty: 2 },
  ] },
  // 페라미플루의 EMR 용법이 '1+ns50'이지만 n/s 50은 등록코드 줄이 아니라 희석액 표기라
  // 항목으로 넣지 않았다 — 사진에 없는 것을 만들지 않는다.
  { emr: 'iv20-3', name: '소아수액 (독감)', items: [
    { code: 'ns', dose: '180' }, { code: 'licorice' }, { code: 'nac' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'b6' }, { code: 'b12' },
    { code: 'panbicomp' }, { code: 'gcbbon' }, { code: 'denogan', qty: 1.5 },
    { code: 'ord_basic', qty: 0.5 }, { code: 'peramiflu' }, { code: 'mpc_basic', qty: 2 },
  ] },
  { emr: '180', name: 'iv180(B6:3개 데노간2)', items: [
    { code: 'ns', dose: '180' }, { code: 'nac' }, { code: 'licorice' },
    { code: 'merit', dose: '10g' }, { code: 'meganesium' }, { code: 'panbicomp' },
    { code: 'b6', qty: 3 }, { code: 'b12' }, { code: 'gcbbon' },
    { code: 'mpc_basic' }, { code: 'denogan', qty: 2 },
  ] },
]

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'bundle_add_260806'").get()) {
  db.transaction(() => {
    // 미량원소(EMR Mineral, 청구코드 681100281)는 카탈로그에 없던 항목이다.
    // 실버 수액 두 종에만 쓰인다. 영양 첨가제라 디펩티벤 옆(치료제)에 두고,
    // sort_order를 x.5로 잡아 뒤 항목을 재번호하지 않는다(페디아민과 같은 방식).
    const beside = db.prepare("SELECT group_key, sort_order, route FROM order_items WHERE code = 'dipeptiven'").get()
    if (beside) {
      db.prepare(`INSERT OR IGNORE INTO order_items (code, label, group_key, sort_order, route)
                  VALUES ('mineral', '미량원소', ?, ?, ?)`)
        .run(beside.group_key, beside.sort_order + 0.5, beside.route)
    }

    const exists = db.prepare('SELECT 1 FROM order_bundles WHERE emr_code = ?')
    const insBundle = db.prepare('INSERT INTO order_bundles (name, emr_code, sort_order) VALUES (?, ?, ?)')
    const insItem = db.prepare(
      'INSERT INTO order_bundle_items (bundle_id, item_code, dose, qty) VALUES (?, ?, ?, ?)',
    )
    // 항목코드가 카탈로그에 없으면 조용히 빈 묶음이 된다 — 먼저 막는다.
    const known = new Set(db.prepare('SELECT code FROM order_items').all().map((r) => r.code))
    for (const b of BUNDLE_ADD) {
      for (const it of b.items) {
        if (!known.has(it.code)) throw new Error(`묶음 ${b.emr}: 없는 항목코드 ${it.code}`)
      }
    }
    let next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 m FROM order_bundles').get().m
    for (const b of BUNDLE_ADD) {
      // 이미 있는 코드는 건너뛴다 — 관리자가 손으로 만들어 뒀을 수 있고, 덮으면 편집이 날아간다.
      if (exists.get(b.emr)) continue
      const { lastInsertRowid } = insBundle.run(b.name, b.emr, next++)
      for (const it of b.items) {
        insItem.run(lastInsertRowid, it.code, it.dose ?? '', it.qty ?? 1)
      }
    }
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('bundle_add_260806', '1', Date.now())
  })()
}

export default db
