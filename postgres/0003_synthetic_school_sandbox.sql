BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sandbox_state (
  id TEXT PRIMARY KEY CHECK (id = 'synthetic-school'),
  claim_token TEXT NOT NULL,
  initialized_at TEXT NOT NULL
);

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0003_synthetic_school_sandbox') THEN
    RETURN;
  END IF;

  ALTER TABLE school_classes ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
  ALTER TABLE app_users ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
  ALTER TABLE mood_entries ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
  ALTER TABLE chat_conversations ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
  ALTER TABLE chat_messages ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
  ALTER TABLE support_events ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));

  CREATE INDEX idx_school_classes_synthetic_teacher
    ON school_classes (synthetic, teacher_user_id, active);
  CREATE INDEX idx_app_users_synthetic_role
    ON app_users (synthetic, role, active);
  CREATE INDEX idx_mood_entries_synthetic_user
    ON mood_entries (synthetic, user_id, created_at);
  CREATE INDEX idx_chat_conversations_synthetic_user
    ON chat_conversations (synthetic, user_id, created_at);
  CREATE INDEX idx_chat_messages_synthetic_user
    ON chat_messages (synthetic, user_id, created_at);
  CREATE INDEX idx_support_events_synthetic_class
    ON support_events (synthetic, class_id, created_at);

  INSERT INTO schema_migrations(version, applied_at)
  VALUES ('0003_synthetic_school_sandbox', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END
$migration$;

INSERT INTO sandbox_state(id, claim_token, initialized_at)
SELECT 'synthetic-school', 'migrated-existing-school-data',
  to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE EXISTS (SELECT 1 FROM app_users)
ON CONFLICT (id) DO NOTHING;

COMMIT;
