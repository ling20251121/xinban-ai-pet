import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Miniflare } from "../node_modules/.pnpm/node_modules/miniflare/dist/src/index.js";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

const ORIGIN = "http://localhost";
const ADMIN_KEY = "sandbox-admin-test-key-123456789";

async function newD1() {
  const mf = new Miniflare({
    compatibilityDate: "2026-05-22",
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  return { mf, db: await mf.getD1Database("DB") };
}

async function callApi(pathname, init = {}, bindings = {}) {
  globalThis.__CLOUDFLARE_TEST_ENV__ = bindings;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("sandbox-test", `${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`${ORIGIN}${pathname}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function mutation(body, cookie, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0];
}

test("sandbox is explicit, initializes only synthetic rows, gates adult login, rejects PII and resets", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const bindings = {
    DB: db,
    ADULT_EVALUATION_ONLY: "true",
    PUBLIC_DEMO_MODE: "true",
    SANDBOX_MODE: "true",
    SANDBOX_ADMIN_KEY: ADMIN_KEY,
    QWEN_API_KEY: "test-only-qwen-key",
  };

  const status = await callApi("/api/sandbox/bootstrap", {}, bindings);
  assert.equal(status.status, 200, await status.clone().text());
  assert.equal((await status.json()).initialized, false);

  const denied = await callApi("/api/sandbox/bootstrap", mutation({}, null), bindings);
  assert.equal(denied.status, 403);
  const attempts = await Promise.all([
    callApi(
      "/api/sandbox/bootstrap",
      mutation({}, null, { "x-sandbox-admin-key": ADMIN_KEY }),
      bindings,
    ),
    callApi(
      "/api/sandbox/bootstrap",
      mutation({}, null, { "x-sandbox-admin-key": ADMIN_KEY }),
      bindings,
    ),
  ]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
  const initialized = attempts.find((response) => response.status === 201);
  assert.ok(initialized);
  assert.equal(initialized.status, 201, await initialized.clone().text());
  const credentials = await initialized.json();
  assert.equal(credentials.syntheticOnly, true);
  assert.equal(credentials.students.length, 3);
  assert.equal(credentials.scenarios.length, 3);
  for (const table of ["school_classes", "app_users", "mood_entries"]) {
    assert.equal(
      Number((await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE synthetic<>1`).first()).count),
      0,
      table,
    );
  }
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM sandbox_state").first()).count), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM school_classes").first()).count), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM app_users WHERE role='teacher'").first()).count), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM app_users WHERE role='student'").first()).count), 3);
  const demonstrationEvent = await db.prepare(`SELECT e.synthetic,e.status,e.evidence_code,
    e.source_type,m.synthetic mood_synthetic,m.safety_level,m.note
    FROM support_events e JOIN mood_entries m ON m.id=e.source_id`).first();
  assert.equal(Number(demonstrationEvent.synthetic), 1);
  assert.equal(Number(demonstrationEvent.mood_synthetic), 1);
  assert.equal(demonstrationEvent.status, "new");
  assert.equal(demonstrationEvent.evidence_code, "local_crisis_rule");
  assert.equal(demonstrationEvent.source_type, "mood");
  assert.equal(demonstrationEvent.safety_level, "urgent");
  assert.match(demonstrationEvent.note, /虚构演示事件/u);

  const missingAdult = await callApi(
    "/api/auth/login",
    mutation({ username: credentials.students[0].username, password: credentials.students[0].password }),
    bindings,
  );
  assert.equal(missingAdult.status, 400);
  const login = await callApi(
    "/api/auth/login",
    mutation({
      username: credentials.students[0].username,
      password: credentials.students[0].password,
      adultConfirmed: true,
      syntheticOnlyConfirmed: true,
    }),
    bindings,
  );
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = cookieFrom(login);

  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not run"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const piiChat = await callApi(
    "/api/chat",
    mutation({ mood: "紧张", message: "我的手机号是13800138000" }, cookie),
    bindings,
  );
  assert.equal(piiChat.status, 400, await piiChat.clone().text());
  assert.equal(providerCalls, 0);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM chat_messages").first()).count), 0);

  const piiTts = await callApi(
    "/api/voice/synthesize",
    mutation({ text: "我的邮箱是 demo@example.com", userInitiated: true }, cookie),
    bindings,
  );
  assert.equal(piiTts.status, 400, await piiTts.clone().text());
  assert.equal(providerCalls, 0);

  const reset = await callApi("/api/sandbox/reset", {
    method: "DELETE",
    headers: { origin: ORIGIN, "x-sandbox-admin-key": ADMIN_KEY },
  }, bindings);
  assert.equal(reset.status, 200, await reset.clone().text());
  for (const table of ["sandbox_state", "auth_sessions", "school_classes", "app_users", "mood_entries", "support_events"]) {
    assert.equal(Number((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count), 0, table);
  }
});

test("sandbox initialization transaction rolls back its claim and every row on failure", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const bindings = {
    DB: db,
    ADULT_EVALUATION_ONLY: "true",
    SANDBOX_MODE: "true",
    SANDBOX_ADMIN_KEY: ADMIN_KEY,
  };
  const status = await callApi("/api/sandbox/bootstrap", {}, bindings);
  assert.equal(status.status, 200, await status.clone().text());
  await db.prepare(`CREATE TRIGGER fail_sandbox_support_event
    BEFORE INSERT ON support_events
    BEGIN SELECT RAISE(FAIL, 'forced sandbox initialization failure'); END`).run();

  const failed = await callApi(
    "/api/sandbox/bootstrap",
    mutation({}, null, { "x-sandbox-admin-key": ADMIN_KEY }),
    bindings,
  );
  assert.equal(failed.status, 500, await failed.clone().text());
  for (const table of ["sandbox_state", "school_classes", "app_users", "mood_entries", "support_events"]) {
    assert.equal(Number((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count), 0, table);
  }

  await db.exec("DROP TRIGGER fail_sandbox_support_event;");
  const retry = await callApi(
    "/api/sandbox/bootstrap",
    mutation({}, null, { "x-sandbox-admin-key": ADMIN_KEY }),
    bindings,
  );
  assert.equal(retry.status, 201, await retry.clone().text());
});

test("sandbox database assertion rejects every non-synthetic school-domain row", async () => {
  const { assertSandboxDatabaseIsSynthetic } = await import("../lib/public-demo.ts");
  const dirty = {
    dialect: "postgres",
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return { count: sql.includes("support_events") ? 1 : 0 }; },
      };
    },
  };
  await assert.rejects(
    assertSandboxDatabaseIsSynthetic(dirty, { SANDBOX_MODE: "true", SANDBOX_ADMIN_KEY: ADMIN_KEY }),
    /support_events contains a non-synthetic row/u,
  );
});

test("sandbox startup rejects an explicit non-adult configuration before touching the database", async () => {
  const { assertSandboxDatabaseIsSynthetic } = await import("../lib/public-demo.ts");
  let queries = 0;
  const database = {
    dialect: "postgres",
    prepare() {
      queries += 1;
      throw new Error("database must not be queried for an invalid mode combination");
    },
  };
  await assert.rejects(
    assertSandboxDatabaseIsSynthetic(database, {
      ADULT_EVALUATION_ONLY: "false",
      SANDBOX_MODE: "true",
      SANDBOX_ADMIN_KEY: ADMIN_KEY,
    }),
    /ADULT_EVALUATION_ONLY must remain true/u,
  );
  assert.equal(queries, 0);
});
