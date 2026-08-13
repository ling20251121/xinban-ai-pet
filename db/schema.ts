import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sandboxState = sqliteTable(
  "sandbox_state",
  {
    id: text("id").primaryKey(),
    claimToken: text("claim_token").notNull(),
    initializedAt: text("initialized_at").notNull(),
  },
  (table) => [
    check("sandbox_state_id_check", sql`${table.id} = 'synthetic-school'`),
  ],
);

export const schoolClasses = sqliteTable(
  "school_classes",
  {
    id: text("id").primaryKey(),
    teacherUserId: text("teacher_user_id").notNull(),
    name: text("name").notNull(),
    safetyContactName: text("safety_contact_name").notNull(),
    safetyContactPhone: text("safety_contact_phone").notNull(),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("school_classes_active_check", sql`${table.active} IN (0, 1)`),
    check("school_classes_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    index("idx_school_classes_teacher").on(table.teacherUserId, table.active),
  ],
);

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    role: text("role", { enum: ["teacher", "student"] }).notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    classId: text("class_id"),
    ageBand: text("age_band", { enum: ["under14", "14plus"] }),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    guardianConsentVerifiedAt: text("guardian_consent_verified_at"),
    guardianConsentVerifiedBy: text("guardian_consent_verified_by"),
    studentConsentedAt: text("student_consented_at"),
    studentConsentVersion: text("student_consent_version"),
    studentConsentWithdrawnAt: text("student_consent_withdrawn_at"),
    createdByUserId: text("created_by_user_id"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_app_users_username_unique").on(table.username),
    index("idx_app_users_class_role_active").on(
      table.classId,
      table.role,
      table.active,
    ),
    check("app_users_role_check", sql`${table.role} IN ('teacher', 'student')`),
    check("app_users_active_check", sql`${table.active} IN (0, 1)`),
    check("app_users_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    check(
      "app_users_password_change_check",
      sql`${table.mustChangePassword} IN (0, 1)`,
    ),
    check(
      "app_users_password_iterations_check",
      sql`${table.passwordIterations} >= 210000`,
    ),
    check(
      "app_users_class_check",
      sql`(${table.role} = 'teacher' AND ${table.classId} IS NULL AND ${table.ageBand} IS NULL) OR (${table.role} = 'student' AND ${table.classId} IS NOT NULL AND ${table.ageBand} IN ('under14', '14plus'))`,
    ),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("idx_auth_sessions_user").on(table.userId, table.expiresAt),
    index("idx_auth_sessions_expiry").on(table.expiresAt),
  ],
);

export const authRateLimits = sqliteTable(
  "auth_rate_limits",
  {
    scopeKey: text("scope_key").primaryKey(),
    windowStartedAt: text("window_started_at").notNull(),
    requestCount: integer("request_count").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    check("auth_rate_limits_count_check", sql`${table.requestCount} >= 0`),
    index("idx_auth_rate_limits_expiry").on(table.expiresAt),
  ],
);

/**
 * Legacy anonymous columns remain intact. New v5 rows are owned exclusively by
 * userId/classId; legacy rows stay nullable and are not exposed through v5 APIs.
 */
export const moodEntries = sqliteTable(
  "mood_entries",
  {
    id: text("id").primaryKey(),
    participantHash: text("participant_hash").notNull(),
    participantCode: text("participant_code").notNull(),
    userId: text("user_id"),
    classId: text("class_id"),
    mood: text("mood").notNull(),
    moodScore: integer("mood_score").notNull(),
    note: text("note").notNull().default(""),
    goal: text("goal").notNull().default(""),
    wantsSupport: integer("wants_support", { mode: "boolean" })
      .notNull()
      .default(false),
    safetyLevel: text("safety_level", { enum: ["normal", "urgent"] })
      .notNull()
      .default("normal"),
    supportEvidence: text("support_evidence"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    check("mood_entries_score_check", sql`${table.moodScore} BETWEEN 0 AND 5`),
    check("mood_entries_support_check", sql`${table.wantsSupport} IN (0, 1)`),
    check("mood_entries_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    check(
      "mood_entries_safety_check",
      sql`${table.safetyLevel} IN ('normal', 'urgent')`,
    ),
    index("idx_mood_entries_participant_created").on(
      table.participantHash,
      table.createdAt,
    ),
    index("idx_mood_entries_user_created").on(table.userId, table.createdAt),
    index("idx_mood_entries_class_created").on(table.classId, table.createdAt),
    index("idx_mood_entries_created").on(table.createdAt),
    index("idx_mood_entries_flagged_created")
      .on(table.createdAt)
      .where(sql`${table.wantsSupport} = 1 OR ${table.safetyLevel} = 'urgent'`),
  ],
);

export const chatConversations = sqliteTable(
  "chat_conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    classId: text("class_id").notNull(),
    startedAt: text("started_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    studentTurns: integer("student_turns").notNull().default(0),
    inFlight: integer("in_flight", { mode: "boolean" }).notNull().default(false),
    pendingSince: text("pending_since"),
    leaseToken: text("lease_token"),
    endedReason: text("ended_reason", {
      enum: ["expired", "turn_limit", "urgent", "student_deleted", "student_finished"],
    }),
    endedAt: text("ended_at"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("chat_conversations_turns_check", sql`${table.studentTurns} >= 0`),
    check(
      "chat_conversations_in_flight_check",
      sql`${table.inFlight} IN (0, 1)`,
    ),
    check("chat_conversations_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    check(
      "chat_conversations_end_reason_check",
      sql`${table.endedReason} IS NULL OR ${table.endedReason} IN ('expired', 'turn_limit', 'urgent', 'student_deleted', 'student_finished')`,
    ),
    index("idx_chat_conversations_user_created").on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("idx_chat_conversations_one_open_user")
      .on(table.userId)
      .where(sql`${table.endedAt} IS NULL`),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "local_safety"] }).notNull(),
    content: text("content").notNull(),
    safetyLevel: text("safety_level", { enum: ["normal", "urgent"] })
      .notNull()
      .default("normal"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "chat_messages_role_check",
      sql`${table.role} IN ('user', 'assistant', 'local_safety')`,
    ),
    check(
      "chat_messages_safety_check",
      sql`${table.safetyLevel} IN ('normal', 'urgent')`,
    ),
    check("chat_messages_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    index("idx_chat_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
    index("idx_chat_messages_user_created").on(table.userId, table.createdAt),
  ],
);

/** No student text is stored here; teachers receive only the event code. */
export const supportEvents = sqliteTable(
  "support_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    classId: text("class_id").notNull(),
    sourceType: text("source_type", { enum: ["mood", "chat", "voice"] }).notNull(),
    sourceId: text("source_id"),
    safetyLevel: text("safety_level", { enum: ["urgent"] }).notNull(),
    evidenceCode: text("evidence_code", { enum: ["local_crisis_rule"] }).notNull(),
    status: text("status", { enum: ["new", "acknowledged", "resolved"] })
      .notNull()
      .default("new"),
    assignedTeacherUserId: text("assigned_teacher_user_id"),
    acknowledgedAt: text("acknowledged_at"),
    resolvedAt: text("resolved_at"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "support_events_source_check",
      sql`${table.sourceType} IN ('mood', 'chat', 'voice')`,
    ),
    check("support_events_safety_check", sql`${table.safetyLevel} = 'urgent'`),
    check(
      "support_events_evidence_check",
      sql`${table.evidenceCode} = 'local_crisis_rule'`,
    ),
    check(
      "support_events_status_check",
      sql`${table.status} IN ('new', 'acknowledged', 'resolved')`,
    ),
    check("support_events_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    index("idx_support_events_class_created").on(table.classId, table.createdAt),
    index("idx_support_events_user_created").on(table.userId, table.createdAt),
  ],
);

/** A non-diagnostic wellbeing cue. It never stores or exposes chat prose. */
export const teacherAttentionEvents = sqliteTable(
  "teacher_attention_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    classId: text("class_id").notNull(),
    kind: text("kind", { enum: ["long_chat_session", "student_support_request"] }).notNull(),
    sourceType: text("source_type", { enum: ["chat", "mood"] }).notNull(),
    sourceId: text("source_id").notNull(),
    status: text("status", { enum: ["new", "acknowledged", "resolved"] })
      .notNull()
      .default("new"),
    assignedTeacherUserId: text("assigned_teacher_user_id"),
    acknowledgedAt: text("acknowledged_at"),
    resolvedAt: text("resolved_at"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "teacher_attention_events_kind_source_check",
      sql`(${table.kind} = 'long_chat_session' AND ${table.sourceType} = 'chat') OR (${table.kind} = 'student_support_request' AND ${table.sourceType} = 'mood')`,
    ),
    check(
      "teacher_attention_events_status_check",
      sql`${table.status} IN ('new', 'acknowledged', 'resolved')`,
    ),
    check(
      "teacher_attention_events_synthetic_check",
      sql`${table.synthetic} IN (0, 1)`,
    ),
    uniqueIndex("idx_teacher_attention_events_kind_source").on(table.kind, table.sourceId),
    index("idx_teacher_attention_events_class_created").on(table.classId, table.createdAt),
    index("idx_teacher_attention_events_user_created").on(table.userId, table.createdAt),
  ],
);

/**
 * Structured, non-diagnostic classifier output. No message text, summary,
 * embedding or model reasoning is copied into this table.
 */
export const conversationCues = sqliteTable(
  "conversation_cues",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    classId: text("class_id").notNull(),
    windowTurn: integer("window_turn").notNull(),
    observedExpression: text("observed_expression", {
      enum: ["positive", "neutral", "mixed", "distress", "unclear"],
    }).notNull(),
    themesJson: text("themes_json").notNull(),
    followUp: text("follow_up", { enum: ["routine_check_in", "timely_check_in"] }).notNull(),
    trend: text("trend", {
      enum: ["not_enough_data", "stable", "easing", "intensifying", "unclear"],
    }).notNull(),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull(),
    basisJson: text("basis_json").notNull(),
    analyzerVersion: text("analyzer_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    status: text("status", {
      enum: ["new", "acknowledged", "resolved", "dismissed_inaccurate"],
    }).notNull().default("new"),
    assignedTeacherUserId: text("assigned_teacher_user_id"),
    acknowledgedAt: text("acknowledged_at"),
    resolvedAt: text("resolved_at"),
    dismissedAt: text("dismissed_at"),
    synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("conversation_cues_window_check", sql`${table.windowTurn} > 0 AND ${table.windowTurn} % 3 = 0`),
    check("conversation_cues_expression_check", sql`${table.observedExpression} IN ('positive','neutral','mixed','distress','unclear')`),
    check("conversation_cues_follow_up_check", sql`${table.followUp} IN ('routine_check_in','timely_check_in')`),
    check("conversation_cues_trend_check", sql`${table.trend} IN ('not_enough_data','stable','easing','intensifying','unclear')`),
    check("conversation_cues_confidence_check", sql`${table.confidence} IN ('low','medium','high')`),
    check("conversation_cues_status_check", sql`${table.status} IN ('new','acknowledged','resolved','dismissed_inaccurate')`),
    check("conversation_cues_synthetic_check", sql`${table.synthetic} IN (0, 1)`),
    uniqueIndex("idx_conversation_cues_window").on(table.conversationId, table.windowTurn),
    index("idx_conversation_cues_class_created").on(table.classId, table.createdAt),
    index("idx_conversation_cues_user_created").on(table.userId, table.createdAt),
  ],
);

export type MoodEntry = typeof moodEntries.$inferSelect;
export type AppUser = typeof appUsers.$inferSelect;
