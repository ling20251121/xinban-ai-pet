BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_v5_1_system') THEN
    RETURN;
  END IF;

  CREATE TABLE school_classes (
    id TEXT PRIMARY KEY,
    teacher_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    safety_contact_name TEXT NOT NULL,
    safety_contact_phone TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE app_users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL CHECK (password_iterations >= 210000),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    class_id TEXT,
    age_band TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
    guardian_consent_verified_at TEXT,
    guardian_consent_verified_by TEXT,
    student_consented_at TEXT,
    student_consent_version TEXT,
    student_consent_withdrawn_at TEXT,
    created_by_user_id TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (role = 'teacher' AND class_id IS NULL AND age_band IS NULL) OR
      (role = 'student' AND class_id IS NOT NULL AND age_band IN ('under14', '14plus'))
    )
  );

  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE auth_rate_limits (
    scope_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 0),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE mood_entries (
    id TEXT PRIMARY KEY,
    participant_hash TEXT NOT NULL,
    participant_code TEXT NOT NULL,
    user_id TEXT,
    class_id TEXT,
    mood TEXT NOT NULL,
    mood_score INTEGER NOT NULL CHECK (mood_score BETWEEN 0 AND 5),
    note TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    wants_support INTEGER NOT NULL DEFAULT 0 CHECK (wants_support IN (0, 1)),
    safety_level TEXT NOT NULL DEFAULT 'normal' CHECK (safety_level IN ('normal', 'urgent')),
    support_evidence TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE chat_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    student_turns INTEGER NOT NULL DEFAULT 0 CHECK (student_turns BETWEEN 0 AND 12),
    in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight IN (0, 1)),
    pending_since TEXT,
    lease_token TEXT,
    ended_reason TEXT CHECK (
      ended_reason IS NULL OR ended_reason IN ('expired', 'turn_limit', 'urgent', 'student_deleted')
    ),
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'local_safety')),
    content TEXT NOT NULL,
    safety_level TEXT NOT NULL DEFAULT 'normal' CHECK (safety_level IN ('normal', 'urgent')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE support_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('mood', 'chat', 'voice')),
    source_id TEXT,
    safety_level TEXT NOT NULL CHECK (safety_level = 'urgent'),
    evidence_code TEXT NOT NULL CHECK (evidence_code = 'local_crisis_rule'),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
    assigned_teacher_user_id TEXT,
    acknowledged_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_school_classes_teacher ON school_classes (teacher_user_id, active);
  CREATE UNIQUE INDEX idx_app_users_username_unique ON app_users (username);
  CREATE INDEX idx_app_users_class_role_active ON app_users (class_id, role, active);
  CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id, expires_at);
  CREATE INDEX idx_auth_sessions_expiry ON auth_sessions (expires_at);
  CREATE INDEX idx_auth_rate_limits_expiry ON auth_rate_limits (expires_at);
  CREATE INDEX idx_mood_entries_participant_created ON mood_entries (participant_hash, created_at);
  CREATE INDEX idx_mood_entries_user_created ON mood_entries (user_id, created_at);
  CREATE INDEX idx_mood_entries_class_created ON mood_entries (class_id, created_at);
  CREATE INDEX idx_mood_entries_created ON mood_entries (created_at);
  CREATE INDEX idx_mood_entries_flagged_created ON mood_entries (created_at)
    WHERE wants_support = 1 OR safety_level = 'urgent';
  CREATE INDEX idx_chat_conversations_user_created ON chat_conversations (user_id, created_at);
  CREATE UNIQUE INDEX idx_chat_conversations_one_open_user ON chat_conversations (user_id)
    WHERE ended_at IS NULL;
  CREATE INDEX idx_chat_messages_conversation_created ON chat_messages (conversation_id, created_at);
  CREATE INDEX idx_chat_messages_user_created ON chat_messages (user_id, created_at);
  CREATE INDEX idx_support_events_class_created ON support_events (class_id, created_at);
  CREATE INDEX idx_support_events_user_created ON support_events (user_id, created_at);

  INSERT INTO schema_migrations(version, applied_at)
  VALUES ('0001_v5_1_system', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END
$migration$;

COMMIT;
