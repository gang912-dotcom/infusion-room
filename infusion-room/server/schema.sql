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
  role          TEXT    NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('staff','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chart_no   TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
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
  deleted          INTEGER NOT NULL DEFAULT 0
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
