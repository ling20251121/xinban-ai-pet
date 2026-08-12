import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { readFileSync } from "node:fs";
import type {
  DatabaseResult,
  DatabaseStatement,
  RuntimeConfig,
  SystemDatabase,
} from "@/lib/database-types";

const MAX_CONNECTION_STRING_LENGTH = 2_048;

function postgresSql(source: string): string {
  let index = 0;
  let quote: "'" | '"' | null = null;
  let output = "";
  for (let position = 0; position < source.length; position += 1) {
    const character = source[position];
    if (quote) {
      output += character;
      if (character === quote) {
        if (source[position + 1] === quote) {
          output += source[position + 1];
          position += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      index += 1;
      const standaloneNullCheck = /^\s+IS\s+(?:NOT\s+)?NULL\b/iu.test(
        source.slice(position + 1),
      );
      output += `$${index}${standaloneNullCheck ? "::text" : ""}`;
    } else {
      output += character;
    }
  }
  return output;
}

function result<TRow extends QueryResultRow>(
  value: QueryResult<TRow>,
): DatabaseResult<TRow> {
  return {
    results: value.rows,
    success: true,
    meta: { changes: value.rowCount ?? 0 },
  };
}

export class PostgresStatement implements DatabaseStatement {
  private readonly database: PostgresSystemDatabase;
  readonly sql: string;
  readonly values: unknown[];

  constructor(
    database: PostgresSystemDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]): DatabaseStatement {
    return new PostgresStatement(this.database, this.sql, values);
  }

  async first<TRow = unknown>(): Promise<TRow | null> {
    const response = await this.database.query(this.sql, this.values);
    return (response.rows[0] as TRow | undefined) ?? null;
  }

  async all<TRow = unknown>(): Promise<DatabaseResult<TRow>> {
    return result(await this.database.query(this.sql, this.values)) as DatabaseResult<TRow>;
  }

  async run(): Promise<DatabaseResult> {
    return result(await this.database.query(this.sql, this.values));
  }
}

/** Node-only adapter used by the separate Alibaba Cloud build. */
export class PostgresSystemDatabase implements SystemDatabase {
  readonly dialect = "postgres" as const;
  private readonly pool: Pool;
  private readonly transactionClient?: PoolClient;

  constructor(
    pool: Pool,
    transactionClient?: PoolClient,
  ) {
    this.pool = pool;
    this.transactionClient = transactionClient;
  }

  prepare(sql: string): DatabaseStatement {
    return new PostgresStatement(this, postgresSql(sql));
  }

  query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[],
  ): Promise<QueryResult<TRow>> {
    return (this.transactionClient ?? this.pool).query<TRow>(sql, values);
  }

  async batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const transaction = new PostgresSystemDatabase(this.pool, client);
      const results: DatabaseResult[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresStatement)) {
          throw new TypeError("Cannot mix database adapters in one batch.");
        }
        const response = await transaction.query(statement.sql, statement.values);
        results.push(result(response));
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function postgresSslConfiguration(
  environment: NodeJS.ProcessEnv,
): { rejectUnauthorized: true; ca?: string; servername?: string } | undefined {
  const allowInsecureLocal = environment.DATABASE_ALLOW_INSECURE_LOCAL
    ?.trim()
    .toLowerCase();
  if (allowInsecureLocal === "true") return undefined;
  if (allowInsecureLocal && allowInsecureLocal !== "false") {
    throw new Error(
      "DATABASE_ALLOW_INSECURE_LOCAL must be true or false when set.",
    );
  }
  const caFile = environment.DATABASE_CA_FILE?.trim() ?? "";
  const servername = environment.DATABASE_TLS_SERVER_NAME?.trim() ?? "";
  return caFile
    ? {
        rejectUnauthorized: true,
        ca: readFileSync(caFile, "utf8"),
        ...(servername ? { servername } : {}),
      }
    : { rejectUnauthorized: true };
}

export function createPostgresDatabase(environment: NodeJS.ProcessEnv): {
  database: PostgresSystemDatabase;
  runtime: RuntimeConfig;
  close(): Promise<void>;
} {
  const connectionString = environment.DATABASE_URL?.trim() ?? "";
  if (
    !connectionString ||
    connectionString.length > MAX_CONNECTION_STRING_LENGTH ||
    !/^postgres(?:ql)?:\/\//iu.test(connectionString)
  ) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  }
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: postgresSslConfiguration(environment),
  });
  return {
    database: new PostgresSystemDatabase(pool),
    runtime: {
      AI_PROVIDER: environment.AI_PROVIDER,
      QWEN_API_KEY: environment.QWEN_API_KEY,
      DASHSCOPE_API_KEY: environment.DASHSCOPE_API_KEY,
      QWEN_BASE_URL: environment.QWEN_BASE_URL,
      QWEN_MODEL: environment.QWEN_MODEL,
      QWEN_ASR_MODEL: environment.QWEN_ASR_MODEL,
      QWEN_TTS_MODEL: environment.QWEN_TTS_MODEL,
      AUTH_BOOTSTRAP_TOKEN: environment.AUTH_BOOTSTRAP_TOKEN,
      PUBLIC_DEMO_MODE: environment.PUBLIC_DEMO_MODE,
      ADULT_EVALUATION_ONLY: environment.ADULT_EVALUATION_ONLY,
      SANDBOX_MODE: environment.SANDBOX_MODE,
      SANDBOX_ADMIN_KEY: environment.SANDBOX_ADMIN_KEY,
      EVALUATION_TEACHER_CODES: environment.EVALUATION_TEACHER_CODES,
      EVALUATION_EXPERT_CODES: environment.EVALUATION_EXPERT_CODES,
      RESEARCH_ACCESS_KEY: environment.RESEARCH_ACCESS_KEY,
      EVALUATION_RESEARCHER_NAME: environment.EVALUATION_RESEARCHER_NAME,
      EVALUATION_CONTACT: environment.EVALUATION_CONTACT,
      EVALUATION_ETHICS_STATUS: environment.EVALUATION_ETHICS_STATUS,
      EVALUATION_RETENTION_DAYS: environment.EVALUATION_RETENTION_DAYS,
      EVALUATION_DATA_HOST: environment.EVALUATION_DATA_HOST,
    },
    close: () => pool.end(),
  };
}

export { postgresSql };
