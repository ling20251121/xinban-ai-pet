import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { D1SystemDatabase } from "@/lib/d1-adapter";
import type { RuntimeConfig, SystemDatabase } from "@/lib/database-types";

export interface RuntimeEnv extends RuntimeConfig {
  DB?: D1Database;
}

interface RuntimeOverride {
  database: SystemDatabase;
  runtime: RuntimeConfig;
}

const RUNTIME_OVERRIDE = Symbol.for("xinban.v5.1.runtime");
type RuntimeGlobal = typeof globalThis & { [RUNTIME_OVERRIDE]?: RuntimeOverride };

function nodePostgresSelected(): boolean {
  return typeof process !== "undefined" && process.env.XINBAN_RUNTIME === "node-postgres";
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
  return (
    (globalThis as RuntimeGlobal)[RUNTIME_OVERRIDE]?.runtime ??
    (nodePostgresSelected()
      ? (process.env as RuntimeEnv)
      : (env as unknown as RuntimeEnv))
  );
}

/** Called only by the separate Node/PostgreSQL entry before serving requests. */
export function installRuntimeOverride(override: RuntimeOverride): void {
  (globalThis as RuntimeGlobal)[RUNTIME_OVERRIDE] = override;
}

export function clearRuntimeOverride(): void {
  delete (globalThis as RuntimeGlobal)[RUNTIME_OVERRIDE];
}

export function getD1(): D1Database {
  const database = getRuntimeEnv().DB;
  if (!database) {
    throw new DatabaseUnavailableError();
  }

  return database;
}

export function getSystemDatabaseBinding(): SystemDatabase {
  const override = (globalThis as RuntimeGlobal)[RUNTIME_OVERRIDE];
  if (override) return override.database;
  if (nodePostgresSelected()) {
    throw new Error(
      "PostgreSQL runtime is not registered. Import server/register-postgres before serving requests.",
    );
  }
  return new D1SystemDatabase(getD1());
}

/** Retained for server components that prefer Drizzle; API queries use D1 prepared statements. */
export function getDb() {
  return drizzle(getD1(), { schema });
}
