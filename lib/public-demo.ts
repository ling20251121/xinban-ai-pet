import type { RuntimeConfig, SystemDatabase } from "@/lib/database-types";

export class AdultEvaluationOnlyError extends Error {
  readonly status = 403;
  readonly publicMessage = "当前为成人评估模式，不提供学校账号或学生数据功能。";

  constructor() {
    super("当前为成人评估模式，不提供学校账号或学生数据功能。");
    this.name = "AdultEvaluationOnlyError";
  }
}

/** Fail closed: only the exact value `false` enables student mode. */
export function isAdultEvaluationOnly(runtime: RuntimeConfig): boolean {
  return runtime.ADULT_EVALUATION_ONLY?.trim().toLowerCase() !== "false";
}

/** Explicit opt-in only. Missing, misspelled, or any value except true is off. */
export function isSyntheticSchoolSandbox(runtime: RuntimeConfig): boolean {
  return runtime.SANDBOX_MODE?.trim().toLowerCase() === "true";
}

export function schoolSurfacesEnabled(runtime: RuntimeConfig): boolean {
  return !isAdultEvaluationOnly(runtime) || isSyntheticSchoolSandbox(runtime);
}

export function requireStudentMode(runtime: RuntimeConfig): void {
  if (!schoolSurfacesEnabled(runtime)) {
    throw new AdultEvaluationOnlyError();
  }
}

export function isPublicDemoMode(runtime: RuntimeConfig): boolean {
  return runtime.PUBLIC_DEMO_MODE?.trim().toLowerCase() === "true";
}

const SCHOOL_DATA_TABLES = [
  "school_classes",
  "app_users",
  "auth_sessions",
  "mood_entries",
  "chat_conversations",
  "chat_messages",
  "support_events",
  "teacher_attention_events",
  "conversation_cues",
] as const;

/** Refuse to mount the adult-only service on a database containing school data. */
export async function assertAdultOnlyDatabaseIsClean(
  database: SystemDatabase,
  runtime: RuntimeConfig,
): Promise<void> {
  if (!isAdultEvaluationOnly(runtime) || isSyntheticSchoolSandbox(runtime)) return;
  for (const table of SCHOOL_DATA_TABLES) {
    const row = await database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .first<{ count: number | string }>();
    if (Number(row?.count ?? 0) !== 0) {
      throw new Error(
        `Adult-evaluation-only startup refused: ${table} contains school or student data. Use a new empty database.`,
      );
    }
  }
}

/**
 * A sandbox must use a dedicated database. Every school-domain row must carry
 * the synthetic marker; old/unmarked rows make startup fail closed.
 */
export async function assertSandboxDatabaseIsSynthetic(
  database: SystemDatabase,
  runtime: RuntimeConfig,
): Promise<void> {
  if (!isSyntheticSchoolSandbox(runtime)) return;
  if (!isAdultEvaluationOnly(runtime)) {
    throw new Error(
      "Synthetic school sandbox refused: ADULT_EVALUATION_ONLY must remain true (or be omitted).",
    );
  }
  const key = runtime.SANDBOX_ADMIN_KEY?.trim() ?? "";
  if (key.length < 24) {
    throw new Error("Synthetic school sandbox refused: SANDBOX_ADMIN_KEY must contain at least 24 characters.");
  }
  for (const table of [
    "school_classes",
    "app_users",
    "mood_entries",
    "chat_conversations",
    "chat_messages",
    "support_events",
    "teacher_attention_events",
    "conversation_cues",
  ] as const) {
    const row = await database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE synthetic<>1 OR synthetic IS NULL`)
      .first<{ count: number | string }>();
    if (Number(row?.count ?? 0) !== 0) {
      throw new Error(`Synthetic school sandbox refused: ${table} contains a non-synthetic row. Use a dedicated sandbox database.`);
    }
  }
  const session = await database.prepare(`SELECT COUNT(*) AS count
    FROM auth_sessions s LEFT JOIN app_users u ON u.id=s.user_id
    WHERE u.id IS NULL OR u.synthetic<>1 OR u.synthetic IS NULL`)
    .first<{ count: number | string }>();
  if (Number(session?.count ?? 0) !== 0) {
    throw new Error("Synthetic school sandbox refused: auth_sessions contains a non-synthetic or orphaned session.");
  }
}
