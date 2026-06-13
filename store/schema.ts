// ---------------------------------------------------------------------------
// SQLite schema for JARVIS's local data store (PRD Section 12).
//
// Tables:
//   - conversations: session id, timestamps, role, transcript text
//   - activity_log:  append-only log of every action JARVIS takes
//   - memory:         long-term key/value facts and preferences
//   - cost_ledger:    per-call token/character usage and estimated cost
//   - settings:       single-row key/value app settings
// ---------------------------------------------------------------------------

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_session
  ON conversations (session_id, created_at);

-- Append-only audit trail (FR-2.6, SEC-5). Rows are never updated or deleted
-- by the application.
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  skill       TEXT NOT NULL,
  tool        TEXT NOT NULL,
  tier        INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 3),
  params_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'denied', 'pending')),
  summary     TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
  ON activity_log (created_at);

-- Long-term memory: editable/erasable facts and preferences (FR-2.2).
CREATE TABLE IF NOT EXISTS memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-call cost tracking (FR-2.8, FR-8.1).
CREATE TABLE IF NOT EXISTS cost_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  input_units INTEGER NOT NULL DEFAULT 0,
  output_units INTEGER NOT NULL DEFAULT 0,
  unit_kind   TEXT NOT NULL DEFAULT 'tokens',
  estimated_cost_usd REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_created_at
  ON cost_ledger (created_at);

-- Single key/value settings table (voice adapter, allowed dirs, etc.).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;
