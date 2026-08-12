BEGIN;

CREATE TABLE IF NOT EXISTS evaluation_used_codes (
  access_code_hash TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_participants (
  id TEXT PRIMARY KEY,
  participant_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('teacher','expert')),
  experience_band TEXT NOT NULL CHECK (experience_band IN ('0-2','3-5','6-10','11+')),
  sequence_group TEXT NOT NULL CHECK (sequence_group IN ('A','B')),
  consent_version TEXT NOT NULL,
  quote_consent INTEGER NOT NULL DEFAULT 0 CHECK (quote_consent IN (0,1)),
  scenario_pack_version TEXT NOT NULL,
  output_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  access_code_hash TEXT NOT NULL UNIQUE,
  session_token_hash TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  submitted_at TEXT,
  withdrawn_at TEXT,
  data_deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS evaluation_expert_references (
  participant_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  reference_action TEXT NOT NULL,
  reference_evidence_json TEXT NOT NULL,
  reference_context_judgment TEXT NOT NULL,
  reference_reason_codes_json TEXT NOT NULL,
  reference_privacy_choice TEXT NOT NULL,
  reference_confidence INTEGER NOT NULL CHECK (reference_confidence BETWEEN 1 AND 5),
  frozen_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS evaluation_scenario_responses (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  study_condition TEXT NOT NULL CHECK (study_condition IN ('dashboard_only','dashboard_cccr','expert_blind')),
  scenario_pack_version TEXT NOT NULL,
  output_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  chosen_action TEXT NOT NULL,
  evidence_selected_json TEXT,
  context_judgment TEXT,
  reason_codes_json TEXT,
  privacy_choice TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
  quality_json TEXT NOT NULL DEFAULT '{}',
  must_revise INTEGER CHECK (must_revise IS NULL OR must_revise IN (0,1)),
  critical_harm_flags_json TEXT,
  decision_time_ms INTEGER NOT NULL CHECK (decision_time_ms BETWEEN 250 AND 3600000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (participant_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS evaluation_surveys (
  participant_id TEXT PRIMARY KEY,
  sus_json TEXT NOT NULL,
  trust_score INTEGER NOT NULL CHECK (trust_score BETWEEN 1 AND 5),
  appropriateness_score INTEGER NOT NULL CHECK (appropriateness_score BETWEEN 1 AND 5),
  usability_score INTEGER NOT NULL CHECK (usability_score BETWEEN 1 AND 5),
  safety_boundary_score INTEGER NOT NULL CHECK (safety_boundary_score BETWEEN 1 AND 5),
  workload_score INTEGER NOT NULL CHECK (workload_score BETWEEN 0 AND 100),
  feedback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_response_participant
  ON evaluation_scenario_responses (participant_id, scenario_id);
CREATE INDEX IF NOT EXISTS idx_eval_participant_role
  ON evaluation_participants (role, submitted_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0002_adult_evaluation', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
