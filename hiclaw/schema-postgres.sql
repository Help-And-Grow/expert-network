-- PostgreSQL / DB9 schema for HiClaw agent service (run once on a new database).
-- Use HICLAW_POSTGRES_URL or DB9_DATABASE_URL with hiclaw/service (see .env.example).

CREATE TABLE IF NOT EXISTS expert_status (
  expert_id VARCHAR(255) PRIMARY KEY,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  expert_id VARCHAR(255) NOT NULL,
  mentee_id VARCHAR(255) NOT NULL,
  query TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  on_chain_verified BOOLEAN DEFAULT FALSE,
  eas_attestation_uid VARCHAR(66) NULL,
  tx_hash VARCHAR(255),
  session_hash VARCHAR(255),
  conversation_messages TEXT NULL,
  handoff_artifact TEXT NULL,
  mem9_profile_summary TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expert ON sessions (expert_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mentee ON sessions (mentee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

CREATE TABLE IF NOT EXISTS waiting_room (
  id VARCHAR(255) PRIMARY KEY,
  expert_id VARCHAR(255) NOT NULL,
  mentee_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255),
  draft TEXT,
  edited_response TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_waiting_room_expert_status ON waiting_room (expert_id, status);

CREATE TABLE IF NOT EXISTS evaluator_critiques (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  draft_round INT NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  scores TEXT NULL,
  critique TEXT,
  draft_excerpt TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evaluator_critiques_session ON evaluator_critiques (session_id);
