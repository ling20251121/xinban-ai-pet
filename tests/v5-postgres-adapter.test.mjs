import assert from "node:assert/strict";
import test from "node:test";

const nodeBin = process.env.CODEX_NODE_BIN || process.execPath;

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
