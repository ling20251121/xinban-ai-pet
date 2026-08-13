BEGIN;

CREATE TABLE IF NOT EXISTS evaluation_student_ui_task_runs (
  participant_id TEXT NOT NULL,
  task_version TEXT NOT NULL,
  task_id TEXT NOT NULL CHECK (task_id IN ('mood_select','fixed_expression','support_tool')),
  status TEXT NOT NULL CHECK (status IN ('in_progress','success','unable')),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count BETWEEN 0 AND 20),
  unable_reason TEXT CHECK (unable_reason IS NULL OR unable_reason IN ('could_not_find','unclear_instruction','other_no_text')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 604800000),
  PRIMARY KEY(participant_id,task_version,task_id),
  CONSTRAINT evaluation_student_ui_task_runs_participant_fk FOREIGN KEY (participant_id)
    REFERENCES evaluation_participants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_student_ui_task_version
  ON evaluation_student_ui_task_runs (task_version,task_id,participant_id);

CREATE TABLE IF NOT EXISTS evaluation_student_ui_task_feedback (
  participant_id TEXT NOT NULL,
  task_version TEXT NOT NULL,
  actual_ease_score INTEGER NOT NULL CHECK (actual_ease_score BETWEEN 1 AND 5),
  rated_at TEXT NOT NULL,
  PRIMARY KEY(participant_id,task_version),
  CONSTRAINT evaluation_student_ui_task_feedback_participant_fk FOREIGN KEY (participant_id)
    REFERENCES evaluation_participants(id) ON DELETE CASCADE
);

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0008_student_ui_actual_usability', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
