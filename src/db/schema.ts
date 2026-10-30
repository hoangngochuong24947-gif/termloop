/**
 * SQLite schema。
 *
 * 内联成字符串而不是 .sql 文件，是为了让「启动一个新实例」不需要任何相对路径假设——
 * `npx termloop serve` 在任何 cwd 下都该能跑起来。
 */

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS terms (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('term','phrase','procedural','metric','unit','symbol')),
  level       TEXT NOT NULL DEFAULT 'domain' CHECK (level IN ('general','academic','domain')),
  importance  INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','accepted','active','archived')),
  domain      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_state ON terms(state);
CREATE INDEX IF NOT EXISTS idx_terms_kind  ON terms(kind);

CREATE TABLE IF NOT EXISTS surfaces (
  id       TEXT PRIMARY KEY,
  term_id  TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  type     TEXT NOT NULL CHECK (type IN ('en','zh','abbr','symbol','formula')),
  text     TEXT NOT NULL,
  norm     TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL DEFAULT 'preferred' CHECK (status IN ('preferred','accepted','rejected')),
  evidence TEXT NOT NULL DEFAULT 'unverified' CHECK (evidence IN ('unverified','A','B','C')),
  locator  TEXT,
  ord      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (term_id, type, text)
);
CREATE INDEX IF NOT EXISTS idx_surfaces_term ON surfaces(term_id);
CREATE INDEX IF NOT EXISTS idx_surfaces_norm ON surfaces(norm);

CREATE TABLE IF NOT EXISTS zh_sides (
  term_id       TEXT PRIMARY KEY REFERENCES terms(id) ON DELETE CASCADE,
  name          TEXT,
  name_evidence TEXT NOT NULL DEFAULT 'unverified' CHECK (name_evidence IN ('unverified','A','B','C')),
  explain       TEXT NOT NULL DEFAULT '',
  -- 不变量：中文侧永不真正空置。name 或 explain 至少要有一个。（见 PRD §2.3 / R3）
  CHECK (name IS NOT NULL OR length(explain) > 0)
);

CREATE TABLE IF NOT EXISTS annotations (
  id      TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK (type IN ('alias','catchword','dimension','usage','provenance')),
  text    TEXT NOT NULL,
  ord     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_annotations_term ON annotations(term_id);

CREATE TABLE IF NOT EXISTS tags (
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (term_id, tag)
);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  term_id     TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  stability   REAL NOT NULL DEFAULT 1,
  difficulty  REAL NOT NULL DEFAULT 5,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  due         TEXT NOT NULL,
  last_review TEXT,
  UNIQUE (term_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_term ON cards(term_id);

CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  ts         TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  answer_raw TEXT,
  -- NULL 表示这一题不做自动判分，由人直接自评（decided_by='human'）
  verdict    TEXT CHECK (verdict IS NULL OR verdict IN ('correct','partial','wrong')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('rule','llm','human')),
  rating     TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
  elapsed_ms INTEGER,
  sched_json TEXT NOT NULL,
  appeal_of  TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts);

CREATE TABLE IF NOT EXISTS drafts (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  source        TEXT,
  actor_type    TEXT NOT NULL,
  actor_name    TEXT,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  ai_confidence REAL,
  decided_at    TEXT,
  decided_by    TEXT,
  term_id       TEXT,
  result_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  diff_json   TEXT,
  revertable  INTEGER NOT NULL DEFAULT 1,
  reverted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS idempotency (
  key           TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  response_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`
