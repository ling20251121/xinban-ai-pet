import { getRuntimeEnv, getSystemDatabaseBinding } from "@/db";
import type { SystemDatabase } from "@/lib/database-types";
import { assertSandboxDatabaseIsSynthetic } from "@/lib/public-demo";

const TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS sandbox_state (
    id TEXT PRIMARY KEY CHECK (id='synthetic-school'),
    claim_token TEXT NOT NULL,
    initialized_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS school_classes (
    id TEXT PRIMARY KEY, teacher_user_id TEXT NOT NULL, name TEXT NOT NULL,
    safety_contact_name TEXT NOT NULL, safety_contact_phone TEXT NOT NULL,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('teacher','student')),
    username TEXT NOT NULL, display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL CHECK (password_iterations >= 210000),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    class_id TEXT, age_band TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
    guardian_consent_verified_at TEXT, guardian_consent_verified_by TEXT,
    student_consented_at TEXT, student_consent_version TEXT,
    student_consent_withdrawn_at TEXT, created_by_user_id TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK ((role='teacher' AND class_id IS NULL AND age_band IS NULL) OR
      (role='student' AND class_id IS NOT NULL AND age_band IN ('under14','14plus')))
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    scope_key TEXT PRIMARY KEY, window_started_at TEXT NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 0), expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mood_entries (
    id TEXT PRIMARY KEY, participant_hash TEXT NOT NULL, participant_code TEXT NOT NULL,
    user_id TEXT, class_id TEXT, mood TEXT NOT NULL,
    mood_score INTEGER NOT NULL CHECK (mood_score BETWEEN 0 AND 5),
    note TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
    wants_support INTEGER NOT NULL DEFAULT 0 CHECK (wants_support IN (0, 1)),
    safety_level TEXT NOT NULL DEFAULT 'normal' CHECK (safety_level IN ('normal','urgent')),
    support_evidence TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, class_id TEXT NOT NULL,
    started_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    student_turns INTEGER NOT NULL DEFAULT 0 CHECK (student_turns >= 0),
    in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight IN (0, 1)),
    pending_since TEXT,
    lease_token TEXT,
    ended_reason TEXT CHECK (ended_reason IS NULL OR ended_reason IN
      ('expired','turn_limit','urgent','student_deleted','student_finished')),
    ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    , synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','local_safety')),
    content TEXT NOT NULL,
    safety_level TEXT NOT NULL DEFAULT 'normal' CHECK (safety_level IN ('normal','urgent')),
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_events (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, class_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('mood','chat','voice')),
    source_id TEXT, safety_level TEXT NOT NULL CHECK (safety_level='urgent'),
    evidence_code TEXT NOT NULL CHECK (evidence_code='local_crisis_rule'),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','resolved')),
    assigned_teacher_user_id TEXT, acknowledged_at TEXT, resolved_at TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS teacher_attention_events (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, class_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','resolved')),
    assigned_teacher_user_id TEXT, acknowledged_at TEXT, resolved_at TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL,
    UNIQUE (kind, source_id),
    CHECK ((kind='long_chat_session' AND source_type='chat') OR
      (kind='student_support_request' AND source_type='mood'))
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_cues (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
    class_id TEXT NOT NULL, window_turn INTEGER NOT NULL CHECK (window_turn > 0 AND window_turn % 3 = 0),
    observed_expression TEXT NOT NULL CHECK (observed_expression IN ('positive','neutral','mixed','distress','unclear')),
    themes_json TEXT NOT NULL,
    follow_up TEXT NOT NULL CHECK (follow_up IN ('routine_check_in','timely_check_in')),
    trend TEXT NOT NULL CHECK (trend IN ('not_enough_data','stable','easing','intensifying','unclear')),
    confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
    basis_json TEXT NOT NULL, analyzer_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','resolved','dismissed_inaccurate')),
    assigned_teacher_user_id TEXT, acknowledged_at TEXT, resolved_at TEXT, dismissed_at TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)), created_at TEXT NOT NULL,
    UNIQUE (conversation_id, window_turn)
  )`,
] as const;

const INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_school_classes_teacher ON school_classes (teacher_user_id, active)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_unique ON app_users (username)",
  "CREATE INDEX IF NOT EXISTS idx_app_users_class_role_active ON app_users (class_id, role, active)",
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits (expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_mood_entries_participant_created ON mood_entries (participant_hash, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_mood_entries_user_created ON mood_entries (user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_mood_entries_class_created ON mood_entries (class_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_mood_entries_created ON mood_entries (created_at)",
  "CREATE INDEX IF NOT EXISTS idx_mood_entries_flagged_created ON mood_entries (created_at) WHERE wants_support=1 OR safety_level='urgent'",
  "CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_created ON chat_conversations (user_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_one_open_user ON chat_conversations (user_id) WHERE ended_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages (conversation_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages (user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_support_events_class_created ON support_events (class_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_support_events_user_created ON support_events (user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_teacher_attention_events_class_created ON teacher_attention_events (class_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_teacher_attention_events_user_created ON teacher_attention_events (user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_conversation_cues_class_created ON conversation_cues (class_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_conversation_cues_user_created ON conversation_cues (user_id, created_at)",
] as const;

const readyByDatabase = new WeakMap<object, Promise<void>>();

async function initializeD1(database: SystemDatabase): Promise<void> {
  await database.batch(TABLE_SQL.map((statement) => database.prepare(statement)));

  // v4 databases have mood_entries without controlled owner columns. These
  // nullable additions preserve every legacy row while moving v5 lookups to
  // authenticated user_id/class_id ownership.
  const columns = await database
    .prepare("PRAGMA table_info(mood_entries)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column: { name: string }) => column.name));
  const alterations: ReturnType<SystemDatabase["prepare"]>[] = [];
  if (!names.has("user_id")) {
    alterations.push(database.prepare("ALTER TABLE mood_entries ADD COLUMN user_id TEXT"));
  }
  if (!names.has("class_id")) {
    alterations.push(database.prepare("ALTER TABLE mood_entries ADD COLUMN class_id TEXT"));
  }
  if (alterations.length > 0) await database.batch(alterations);

  const syntheticColumns = [
    ["school_classes", "synthetic"],
    ["app_users", "synthetic"],
    ["mood_entries", "synthetic"],
    ["chat_conversations", "synthetic"],
    ["chat_messages", "synthetic"],
    ["support_events", "synthetic"],
    ["teacher_attention_events", "synthetic"],
    ["conversation_cues", "synthetic"],
  ] as const;
  const syntheticAlterations: ReturnType<SystemDatabase["prepare"]>[] = [];
  for (const [table, column] of syntheticColumns) {
    const tableColumns = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!tableColumns.results.some((item) => item.name === column)) {
      syntheticAlterations.push(
        database.prepare(`ALTER TABLE ${table} ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0`),
      );
    }
  }
  if (syntheticAlterations.length > 0) await database.batch(syntheticAlterations);

  // A fixed sentinel makes sandbox initialization a database-level atomic
  // claim. Backfill it for an older database so an upgrade can never create a
  // second set of accounts; an operator can still clear it with sandbox reset.
  await database.prepare(`INSERT INTO sandbox_state (id,claim_token,initialized_at)
    SELECT 'synthetic-school','migrated-existing-school-data',?
    WHERE EXISTS (SELECT 1 FROM app_users)
      AND NOT EXISTS (SELECT 1 FROM sandbox_state WHERE id='synthetic-school')`)
    .bind(new Date().toISOString()).run();

  await database.batch(INDEX_SQL.map((statement) => database.prepare(statement)));
}

export async function getSystemDatabase(): Promise<SystemDatabase> {
  const database = getSystemDatabaseBinding();
  if (database.dialect === "postgres") {
    await assertSandboxDatabaseIsSynthetic(database, getRuntimeEnv());
    return database;
  }
  let schemaReady = readyByDatabase.get(database as object);
  if (!schemaReady) {
    schemaReady = initializeD1(database);
    readyByDatabase.set(database as object, schemaReady);
  }
  try {
    await schemaReady;
    await assertSandboxDatabaseIsSynthetic(database, getRuntimeEnv());
  } catch (error) {
    readyByDatabase.delete(database as object);
    throw error;
  }
  return database;
}
