-- 수액실 앱 서버 전환 — DB 스키마 (DB스키마_v4.md 기준)
-- 모든 시각 컬럼은 INTEGER — Unix epoch 밀리초(UTC)

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  -- 권한 4단계: viewer(열람) < staff(실무자) < manager(관리자) < admin(마스터).
  -- 기존 DB는 db.js가 이 CHECK로 accounts를 1회 재작성한다(SQLite는 CHECK를 ALTER로 못 바꾼다).
  role          TEXT    NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('viewer','staff','manager','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  signature  TEXT     -- 자필 서명 base64 dataURL. 기록지 담당자 칸에 삽입. 없으면 NULL.
);

CREATE TABLE IF NOT EXISTS patients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chart_no   TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  -- 특이사항(기저질환) 정본. 환자에게 계속 따라다니는 값이고, 등록 시 이 값이 칸에 채워진다.
  -- sessions.special_note는 그 방문의 스냅샷으로 남는다(기록지·CSV가 그걸 읽는다).
  -- 비우면 진짜로 지워진다 — 세션에서 최신 non-null을 찾던 옛 방식은 삭제가 불가능했다.
  baseline_note TEXT,
  -- 성별. 'M' | 'F' | NULL(미지정). 환자에게 계속 따라다니는 값이라 세션 스냅샷을 두지 않는다
  -- (이름·특이사항과 달리 과거 기록에서 되짚을 일이 없다).
  gender     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS beds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  room       TEXT    NOT NULL,
  number     TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bed_id           INTEGER NOT NULL REFERENCES beds(id),
  patient_id       INTEGER NOT NULL REFERENCES patients(id),

  assigned_at      INTEGER NOT NULL,
  assigned_by      INTEGER NOT NULL REFERENCES accounts(id),
  line_staff_id    INTEGER NOT NULL REFERENCES staff(id),

  started_at       INTEGER,
  started_by       INTEGER REFERENCES accounts(id),
  mix_staff_id     INTEGER REFERENCES staff(id),
  duration_minutes INTEGER,

  ended_at         INTEGER,
  ended_by         INTEGER REFERENCES accounts(id),

  cancelled        INTEGER NOT NULL DEFAULT 0,
  cancel_reason    TEXT,
  deleted          INTEGER NOT NULL DEFAULT 0,
  special_note     TEXT,  -- 이 방문의 특이사항(기저질환) 스냅샷. 정본은 patients.baseline_note.
  -- 당일 메모 — 이 방문에만 유효하다. 다음 방문에는 안 뜨고, 그 방문의 기록지·이용기록에만 남는다.
  -- 구 '환자 메모'(patient_memos, 차트 영구)를 대체한다. 그 테이블은 데이터 보존용으로 남겨둔다.
  day_memo         TEXT,
  exam_room        TEXT,  -- 진료실 번호('1'|'2'|'3'|'6'|'7'). 미선택이면 NULL.
  visit_symptom    TEXT,  -- 내원당시증상(주 증상, 내원 사유). 자유 텍스트. 미입력이면 NULL.
  record_snapshot  TEXT,  -- 종료 시 얼린 기록지 데이터(JSON). 종료 전이면 NULL.
  -- 처방을 어느 묶음에서 시작했는지. '고른 처방' 칸의 변경 브리핑이 쓰는 대조 기준일 뿐이고,
  -- 처방 내용은 session_orders가 온전히 들고 있다. NULL이면 브리핑만 안 뜬다.
  order_bundle_id  INTEGER REFERENCES order_bundles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active
  ON sessions(bed_id) WHERE ended_at IS NULL AND cancelled = 0;

CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_pending ON sessions(assigned_at)
  WHERE started_at IS NULL AND cancelled = 0;

CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  occurred_at INTEGER NOT NULL,
  temperature REAL,
  state       TEXT REFERENCES round_states(code),
  memo        TEXT,
  created_at  INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS session_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  occurred_at INTEGER NOT NULL,
  memo        TEXT,
  created_at  INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_note_symptoms (
  note_id INTEGER NOT NULL REFERENCES session_notes(id),
  code    TEXT    NOT NULL REFERENCES symptom_codes(code),
  PRIMARY KEY (note_id, code)
);

CREATE TABLE IF NOT EXISTS session_note_actions (
  note_id INTEGER NOT NULL REFERENCES session_notes(id),
  code    TEXT    NOT NULL REFERENCES action_codes(code),
  PRIMARY KEY (note_id, code)
);

CREATE TABLE IF NOT EXISTS patient_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id),
  category    TEXT    NOT NULL REFERENCES note_categories(code),
  source      TEXT    REFERENCES note_sources(code),
  content     TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pnotes_patient ON patient_notes(patient_id, active, deleted);

-- ─── 표준 어휘 코드 (5종, 모두 동일 형태) ──────────────────────────
CREATE TABLE IF NOT EXISTS symptom_codes (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS action_codes (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS round_states (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS note_categories (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS note_sources (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- ─── 보드 변경 카운터 (폴링 시 변경 여부 판정용) ─────────────────────
CREATE TABLE IF NOT EXISTS app_revision (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO app_revision (id, value) VALUES (1, 0);

-- ─── 로그인 세션 (httpOnly 쿠키 토큰) ───────────────────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_account ON auth_tokens(account_id);

CREATE TABLE IF NOT EXISTS access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER REFERENCES accounts(id),
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  created_at  INTEGER NOT NULL,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON access_logs(created_at DESC);

-- ─── 베드 등록 잠금 (누가 빈 베드에 환자 등록 중인지) ────────────────
-- 빈 베드의 등록 모달을 연 단말이 잠금을 걸고, 열려 있는 동안 주기적으로 updated_at을
-- 갱신(하트비트)한다. 다른 단말은 "환자 등록중"으로 보고 선택 못 한다.
-- updated_at이 LOCK_TTL(5분) 넘게 오래되면 방치로 보고 무시/정리한다.
CREATE TABLE IF NOT EXISTS bed_locks (
  bed_code   TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  client_id  TEXT,
  updated_at INTEGER NOT NULL
);

-- ─── 쪽지 메신저 ─────────────────────────────────────────────────────
-- 계정 간 1:1 쪽지. 직원 화면은 발송 후 10분만 노출(휘발), 이 테이블은 영구 보관(관리자 감사).
-- 휘발은 "조회에서 제외"일 뿐 row는 남는다.
-- 단, 관리자는 데이터 관리 화면에서 로그를 완전 삭제할 수 있다(사용자 결정).
-- 소프트 삭제가 아니라 실제 DELETE라 되돌릴 수 없다 — 지운 행위는 access_logs에 남는다.
CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account INTEGER NOT NULL REFERENCES accounts(id),
  to_account   INTEGER NOT NULL REFERENCES accounts(id),
  content      TEXT    NOT NULL,
  broadcast_id TEXT,               -- 전체발송이면 같은 값으로 묶음. 1:1이면 NULL.
  created_at   INTEGER NOT NULL,   -- 발송 시각(epoch ms). 10분 TTL 기준.
  read_at      INTEGER             -- 확인/답장으로 닫은 시각. NULL이면 아직 안 읽음.
);

-- 수신함 조회용: 특정 계정의 안읽음 + 최근분만 빠르게.
CREATE INDEX IF NOT EXISTS idx_messages_inbox
  ON messages(to_account, read_at, created_at DESC);
-- 관리자 로그 조회용.
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ─── 바이탈(체온·혈압·맥박) ───────────────────────────────────────────
-- 라운딩과 별개. 자유 빈도 기록. 한 행에 재지 않은 항목은 NULL.
CREATE TABLE IF NOT EXISTS vitals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  occurred_at  INTEGER NOT NULL,
  temperature  REAL,        -- 체온 ℃
  bp_systolic  INTEGER,     -- 수축기
  bp_diastolic INTEGER,     -- 이완기
  pulse        INTEGER,     -- 맥박
  created_at   INTEGER NOT NULL,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vitals_session ON vitals(session_id, occurred_at DESC);

-- ─── 수액 Order 항목 정의 ─────────────────────────────────────────────
-- 처방 확인 체크리스트의 항목. 하드코딩이 아니라 DB에서 읽어 렌더한다.
-- 초기 40개는 db.js가 '빈 테이블일 때 1회'만 시드한다(관리자가 지운 항목이 재부팅으로 살아나지 않게).
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,   -- 내부 식별자(라벨 중복 대비)
  label        TEXT    NOT NULL,          -- 화면 표기(원내 표기)
  group_key    TEXT    NOT NULL,          -- '기본'|'치료제'|'IM,SC'|'독감'|'증류수'
  dose_options TEXT,                      -- 용량 선택지 쉼표구분('110,180,100'), 없으면 NULL
  free_text    INTEGER NOT NULL DEFAULT 0,-- 1이면 체크박스 대신 자유입력(증류수 mL)
  -- 1이면 체크박스·수량은 그대로 두고 용량 칸이 하나 더 붙는다(페라미플루: 체중따라 24mL 식).
  -- free_text와 다르다 — free_text는 칸이 곧 체크라 개수를 못 세고, 이건 개수와 mL을 같이 적는다.
  free_dose    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  -- 투여경로 'IV'|'IM'|'SC'. 체크된 항목들의 route를 OR 해서 IV/IM/SC 박스를 자동 체크한다.
  -- ORD처럼 용법에 따라 갈리는 항목은 NULL — 자동 계산에 기여하지 않고 사람이 직접 켠다.
  route        TEXT
);

-- ─── 세션별 처방(체크 결과) ───────────────────────────────────────────
-- 체크 = 행 존재, 해제 = 행 삭제. 저장은 세션 단위 전체 재작성(트랜잭션).
CREATE TABLE IF NOT EXISTS session_orders (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  item_code  TEXT    NOT NULL,   -- order_items.code
  -- dose가 PK에 들어간다. NS를 180·110 두 백 담는 처방이 있어 같은 item_code가 2행 필요하다.
  -- NOT NULL DEFAULT ''인 이유: SQLite는 PK 컬럼에 NULL을 허용하고 유니크로 세지 않는다.
  dose       TEXT    NOT NULL DEFAULT '', -- 용량항목이면 '110'/'5g', 증류수면 mL 자유텍스트, 단순체크면 ''
  -- 주사제 개수. 같은 dose 2백은 qty=2, 다른 dose는 2행.
  -- 소수 둘째 자리까지 쓴다(반 앰플 0.5, 더 잘게 쪼갠 0.25 등). INTEGER 선언이지만 SQLite 타입 친화도는
  -- 손실 없이 정수로 못 바꾸는 값을 real로 그대로 보존한다 → 0.5가 잘리지 않는다.
  qty        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, item_code, dose)
);

-- ─── 묶음처방 ─────────────────────────────────────────────────────────
-- 자주 쓰는 처방 묶음. 처방 확인 모달의 '묶음 버튼'이 이걸로 체크를 채운다.
-- 세션에는 묶음 자체를 저장하지 않는다 — 항상 개별 item_code로 저장하므로
-- 묶음을 지워도 과거 기록은 안 깨진다.
CREATE TABLE IF NOT EXISTS order_bundles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,          -- 버튼에 뜨는 묶음 이름(예: '감기 기본')
  emr_code   TEXT,                      -- 원장님 EMR '묶음코드'('200'·'200-10'·'0'~'3'). 대조용
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_bundle_items (
  bundle_id INTEGER NOT NULL REFERENCES order_bundles(id),
  item_code TEXT    NOT NULL,           -- order_items.code
  dose      TEXT    NOT NULL DEFAULT '',-- session_orders와 같은 이유로 PK에 들어간다(NS 180+110)
  qty       INTEGER NOT NULL DEFAULT 1, -- 소수 둘째 자리까지(반 앰플 0.5). 위 주석 참고
  PRIMARY KEY (bundle_id, item_code, dose)
);

-- ─── 환자 메모 (차트번호 기준, 방문을 넘어 유지) ──────────────────────
-- 이름 주의: 이미 은퇴한 patient_notes 테이블이 따로 있다(구 '주의사항' 기능, 스키마가
-- 전혀 다르고 과거 데이터가 남아 있음). 같은 이름을 쓰면 CREATE IF NOT EXISTS가 조용히
-- 넘어가고 이후 쿼리가 전부 깨지므로 patient_memos로 새로 만든다.
CREATE TABLE IF NOT EXISTS patient_memos (
  chart_no   TEXT PRIMARY KEY,   -- 환자 식별자. 환자당 한 줄.
  note       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER
);

-- ─── 전체 채팅방 ─────────────────────────────────────────────────────
-- 계정 전원이 같은 방 하나를 본다. 방이 여러 개일 필요도, 읽음 확인도 없다(게임 채팅창).
-- 쪽지(messages)와는 다른 것이다: 쪽지는 1:1이고 10분 뒤 화면에서 사라지지만,
-- 채팅은 전체 공개이고 계속 남는다.
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  -- 관리자가 지운 것. 소프트 삭제인 이유: 채팅창에서는 감추되 관리 페이지의 날짜별
  -- 내역에는 '삭제됨'으로 남아야 한다(내역 관리가 목적이라 진짜로 지우면 곤란하다).
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(id DESC);
