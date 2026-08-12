BEGIN;

CREATE TABLE IF NOT EXISTS evaluation_dialogues (
  participant_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  dialogue_pack_version TEXT NOT NULL,
  dialogue_prompt_version TEXT NOT NULL,
  model_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','in_flight','completed')),
  next_turn INTEGER NOT NULL DEFAULT 0 CHECK (next_turn BETWEEN 0 AND 3),
  lease_token TEXT,
  lease_started_at TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  provider_metadata_json TEXT NOT NULL DEFAULT '[]',
  total_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
  safety_ended INTEGER NOT NULL DEFAULT 0 CHECK (safety_ended IN (0,1)),
  rating_json TEXT,
  rating_token TEXT,
  must_revise INTEGER CHECK (must_revise IS NULL OR must_revise IN (0,1)),
  harm_flags_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  rated_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, scenario_id)
);

CREATE INDEX IF NOT EXISTS idx_eval_dialogue_participant
  ON evaluation_dialogues (participant_id, scenario_id);

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0004_evaluation_dialogue', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
