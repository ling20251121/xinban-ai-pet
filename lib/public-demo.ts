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

export function requireStudentMode(runtime: RuntimeConfig): void {
  if (isAdultEvaluationOnly(runtime)) {
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
] as const;

/** Refuse to mount the adult-only service on a database containing school data. */
export async function assertAdultOnlyDatabaseIsClean(
  database: SystemDatabase,
  runtime: RuntimeConfig,
): Promise<void> {
  if (!isAdultEvaluationOnly(runtime)) return;
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
