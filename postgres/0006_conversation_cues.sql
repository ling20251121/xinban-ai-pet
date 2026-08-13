BEGIN;

CREATE TABLE IF NOT EXISTS conversation_cues (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  window_turn INTEGER NOT NULL CHECK (window_turn > 0 AND window_turn % 3 = 0),
  observed_expression TEXT NOT NULL CHECK (observed_expression IN ('positive','neutral','mixed','distress','unclear')),
  themes_json TEXT NOT NULL,
  follow_up TEXT NOT NULL CHECK (follow_up IN ('routine_check_in','timely_check_in')),
  trend TEXT NOT NULL CHECK (trend IN ('not_enough_data','stable','easing','intensifying','unclear')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  basis_json TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','resolved','dismissed_inaccurate')),
  assigned_teacher_user_id TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  dismissed_at TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, window_turn)
);

CREATE INDEX IF NOT EXISTS idx_conversation_cues_class_created ON conversation_cues (class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_cues_user_created ON conversation_cues (user_id, created_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0006_conversation_cues', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
