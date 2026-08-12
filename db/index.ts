import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface RuntimeEnv {
  DB?: D1Database;
  AI_PROVIDER?: string;
  QWEN_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  QWEN_BASE_URL?: string;
  QWEN_MODEL?: string;
  QWEN_ASR_MODEL?: string;
  QWEN_TTS_MODEL?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
    this.name = "DatabaseUnavailableError";
  }
}

export function getRuntimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function getD1(): D1Database {
  const database = getRuntimeEnv().DB;
  if (!database) {
    throw new DatabaseUnavailableError();
  }

  return database;
}

/** Retained for server components that prefer Drizzle; API queries use D1 prepared statements. */
export function getDb() {
  return drizzle(getD1(), { schema });
}
