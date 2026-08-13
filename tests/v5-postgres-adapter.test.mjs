import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const nodeBin = process.env.CODEX_NODE_BIN || process.execPath;

test("auth rate-limit upsert qualifies PostgreSQL target columns", async () => {
  const source = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const upsert = source.match(
    /INSERT INTO auth_rate_limits[\s\S]*?ON CONFLICT\(scope_key\) DO UPDATE SET([\s\S]*?)`\)\.bind/u,
  )?.[1];

  assert.ok(upsert, "auth rate-limit upsert must remain present");
  assert.match(upsert, /auth_rate_limits\.expires_at <= excluded\.window_started_at/u);
  assert.match(upsert, /ELSE auth_rate_limits\.window_started_at END/u);
  assert.match(upsert, /ELSE auth_rate_limits\.request_count\+1 END/u);
  assert.match(upsert, /ELSE auth_rate_limits\.expires_at END/u);
  assert.doesNotMatch(upsert, /WHEN\s+expires_at\s+<=/u);
  assert.doesNotMatch(upsert, /ELSE\s+(?:window_started_at|request_count|expires_at)\b/u);
});

test("PostgreSQL adapter rewrites only unquoted placeholders", async () => {
  const { postgresSql, postgresSslConfiguration } = await import("../lib/postgres-adapter.ts");
  assert.equal(
    postgresSql("SELECT '?' quoted, id FROM app_users WHERE id=? AND username=?"),
    "SELECT '?' quoted, id FROM app_users WHERE id=$1 AND username=$2",
  );
  assert.equal(
    postgresSql("SELECT \"?\" FROM app_users WHERE id=?"),
    "SELECT \"?\" FROM app_users WHERE id=$1",
  );
  assert.equal(
    postgresSql("SELECT id FROM app_users WHERE (? IS NULL OR class_id=?)"),
    "SELECT id FROM app_users WHERE ($1::text IS NULL OR class_id=$2)",
  );
  assert.ok(nodeBin);
  assert.deepEqual(postgresSslConfiguration({}), { rejectUnauthorized: true });
  assert.deepEqual(postgresSslConfiguration({ DATABASE_ALLOW_INSECURE_LOCAL: " false " }), { rejectUnauthorized: true });
  assert.equal(postgresSslConfiguration({ DATABASE_ALLOW_INSECURE_LOCAL: "true" }), undefined);
  assert.throws(() => postgresSslConfiguration({ DATABASE_ALLOW_INSECURE_LOCAL: "yes" }), /true or false/u);
  const directory = await mkdtemp(join(tmpdir(), "xinban-pg-ca-"));
  const caFile = join(directory, "ca.crt");
  await writeFile(caFile, "test-ca\n", "utf8");
  assert.deepEqual(postgresSslConfiguration({ DATABASE_CA_FILE: caFile, DATABASE_TLS_SERVER_NAME: "postgres" }), {
    rejectUnauthorized: true,
    ca: "test-ca\n",
    servername: "postgres",
  });
});

test("PostgreSQL batch is transactional and rolls back on any failed statement", async () => {
  const { PostgresStatement, PostgresSystemDatabase } = await import(
    "../lib/postgres-adapter.ts"
  );
  const calls = [];
  let fail = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (fail && sql.includes("support_events")) throw new Error("forced failure");
      return { rows: [], rowCount: 1 };
    },
    release() {
      calls.push("RELEASE");
    },
  };
  const pool = {
    async connect() {
      return client;
    },
    query() {
      throw new Error("batch must use its checked-out client");
    },
  };
  const database = new PostgresSystemDatabase(pool);
  const first = new PostgresStatement(database, "INSERT INTO chat_messages VALUES ($1)", ["m1"]);
  const second = new PostgresStatement(database, "INSERT INTO support_events VALUES ($1)", ["e1"]);

  await database.batch([first, second]);
  assert.deepEqual(calls, [
    "BEGIN",
    "INSERT INTO chat_messages VALUES ($1)",
    "INSERT INTO support_events VALUES ($1)",
    "COMMIT",
    "RELEASE",
  ]);

  calls.length = 0;
  fail = true;
  await assert.rejects(database.batch([first, second]), /forced failure/u);
  assert.deepEqual(calls, [
    "BEGIN",
    "INSERT INTO chat_messages VALUES ($1)",
    "INSERT INTO support_events VALUES ($1)",
    "ROLLBACK",
    "RELEASE",
  ]);
});

test("public EITT demo mode defaults closed and recognizes only explicit true", async () => {
  const { assertAdultOnlyDatabaseIsClean, isAdultEvaluationOnly, isPublicDemoMode } = await import("../lib/public-demo.ts");
  assert.equal(isPublicDemoMode({ PUBLIC_DEMO_MODE: "true" }), true);
  assert.equal(isPublicDemoMode({ PUBLIC_DEMO_MODE: " TRUE " }), true);
  assert.equal(isPublicDemoMode({ PUBLIC_DEMO_MODE: "false" }), false);
  assert.equal(isPublicDemoMode({}), false);
  assert.equal(isAdultEvaluationOnly({}), true);
  assert.equal(isAdultEvaluationOnly({ ADULT_EVALUATION_ONLY: "true" }), true);
  assert.equal(isAdultEvaluationOnly({ ADULT_EVALUATION_ONLY: " FALSE " }), false);

  const cleanDatabase = {
    dialect: "postgres",
    prepare() { return { bind() { return this; }, async first() { return { count: "0" }; } }; },
    async batch() { return []; },
  };
  await assertAdultOnlyDatabaseIsClean(cleanDatabase, {});
  const dirtyDatabase = {
    ...cleanDatabase,
    prepare(sql) { return { bind() { return this; }, async first() { return { count: sql.includes("mood_entries") ? "1" : "0" }; } }; },
  };
  await assert.rejects(assertAdultOnlyDatabaseIsClean(dirtyDatabase, {}), /mood_entries contains school or student data/u);
  await assert.doesNotReject(assertAdultOnlyDatabaseIsClean(dirtyDatabase, { ADULT_EVALUATION_ONLY: "false" }));
});
