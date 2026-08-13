export interface DatabaseResult<TRow = unknown> {
  results: TRow[];
  success: boolean;
  meta: { changes?: number; [key: string]: unknown };
}

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<TRow = unknown>(): Promise<TRow | null>;
  all<TRow = unknown>(): Promise<DatabaseResult<TRow>>;
  run(): Promise<DatabaseResult>;
}

/**
 * The deliberately small subset shared by Cloudflare D1 and PostgreSQL.
 * Application services depend on this contract rather than either driver.
 */
export interface SystemDatabase {
  readonly dialect: "d1" | "postgres";
  prepare(sql: string): DatabaseStatement;
  /** Every statement succeeds or the whole group is rolled back. */
  batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]>;
}

export interface RuntimeConfig {
  AI_PROVIDER?: string;
  QWEN_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  QWEN_BASE_URL?: string;
  QWEN_MODEL?: string;
  QWEN_ASR_MODEL?: string;
  QWEN_TTS_MODEL?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
  PUBLIC_DEMO_MODE?: string;
  ADULT_EVALUATION_ONLY?: string;
  SANDBOX_MODE?: string;
  SANDBOX_ADMIN_KEY?: string;
  EVALUATION_TEACHER_CODES?: string;
  EVALUATION_EXPERT_CODES?: string;
  RESEARCH_ACCESS_KEY?: string;
  EVALUATION_RESEARCHER_NAME?: string;
  EVALUATION_CONTACT?: string;
  EVALUATION_ETHICS_STATUS?: string;
  EVALUATION_RETENTION_DAYS?: string;
  EVALUATION_DATA_HOST?: string;
  LOCAL_MENTAL_HEALTH_NAME?: string;
  LOCAL_MENTAL_HEALTH_PHONE?: string;
}
