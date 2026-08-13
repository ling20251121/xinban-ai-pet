BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_conversations_student_turns_check'
      AND conrelid = 'chat_conversations'::regclass
  ) THEN
    ALTER TABLE chat_conversations
      DROP CONSTRAINT chat_conversations_student_turns_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_conversations_turns_check'
      AND conrelid = 'chat_conversations'::regclass
  ) THEN
    ALTER TABLE chat_conversations
      DROP CONSTRAINT chat_conversations_turns_check;
  END IF;
END $$;

ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_student_turns_check
  CHECK (student_turns >= 0);

ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_ended_reason_check;
ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_end_reason_check;
ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_ended_reason_check CHECK (
    ended_reason IS NULL OR ended_reason IN
      ('expired', 'turn_limit', 'urgent', 'student_deleted', 'student_finished')
  );

CREATE TABLE IF NOT EXISTS teacher_attention_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
  assigned_teacher_user_id TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (kind, source_id),
  CHECK (
    (kind = 'long_chat_session' AND source_type = 'chat') OR
    (kind = 'student_support_request' AND source_type = 'mood')
  )
);

CREATE INDEX IF NOT EXISTS idx_teacher_attention_events_class_created
  ON teacher_attention_events (class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_teacher_attention_events_user_created
  ON teacher_attention_events (user_id, created_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0005_three_hour_conversations', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
