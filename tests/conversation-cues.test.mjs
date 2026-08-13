import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { Miniflare } from "../node_modules/.pnpm/node_modules/miniflare/dist/src/index.js";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

async function migrate(db) {
  for (const name of [
    "0000_groovy_jane_foster.sql", "0001_controlled_school_system.sql",
    "0002_synthetic_school_sandbox.sql", "0003_evaluation_dialogue.sql",
    "0004_three_hour_conversations.sql", "0005_conversation_cues.sql",
  ]) {
    const source = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    for (const part of source.split("--> statement-breakpoint")) {
      if (part.trim()) await db.prepare(part.trim()).run();
    }
  }
}

function validAnalysis(overrides = {}) {
  return {
    observedExpression: "mixed",
    themes: ["school_pressure"],
    followUp: "routine_check_in",
    trend: "stable",
    confidence: "medium",
    basis: ["repeated_distress_expression"],
    ...overrides,
  };
}

test("conversation cue parser rejects prose, unknown keys and non-enum values", async () => {
  globalThis.__CLOUDFLARE_TEST_ENV__ = {};
  const { isQueueableConversationCue, parseConversationCueAnalysis } = await import("../lib/chat-cues.ts");
  assert.deepEqual(parseConversationCueAnalysis(validAnalysis()), validAnalysis());
  assert.equal(parseConversationCueAnalysis({ ...validAnalysis(), summary: "private prose" }), null);
  assert.equal(parseConversationCueAnalysis(validAnalysis({ observedExpression: "depression" })), null);
  assert.equal(parseConversationCueAnalysis(validAnalysis({ themes: ["school_pressure", "anger", "other"] })), null);
  assert.equal(parseConversationCueAnalysis(validAnalysis({ basis: ["diagnosis"] })), null);
  assert.equal(isQueueableConversationCue(validAnalysis({ confidence: "low" })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({ observedExpression: "positive" })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({ basis: [] })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({
    observedExpression: "neutral", followUp: "timely_check_in", confidence: "high",
  })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({
    observedExpression: "distress", followUp: "timely_check_in", confidence: "medium",
  })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({
    observedExpression: "distress", followUp: "timely_check_in", confidence: "high",
    basis: ["unclear_language"],
  })), false);
  assert.equal(isQueueableConversationCue(validAnalysis({
    observedExpression: "distress", followUp: "timely_check_in", confidence: "high",
  })), true);
});

test("analyzer sends only de-identified student turns and fails closed without a cue", async () => {
  globalThis.__CLOUDFLARE_TEST_ENV__ = {
    QWEN_API_KEY: "test-key",
    QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    QWEN_MODEL: "qwen3.7-plus-2026-05-26",
  };
  const { analyzeConversationWindow } = await import("../lib/chat-cues.ts");
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(validAnalysis()) } }] });
  };
  try {
    const analyzed = await analyzeConversationWindow([
      { content: "Call 13812345678 or see https://private.invalid" },
      { content: "电话是一三八一二三四五六七八" },
      { content: "Schoolwork feels heavy." },
    ]);
    assert.equal(analyzed.analysis.followUp, "routine_check_in");
    assert.equal(providerBody.model, "qwen3.7-plus-2026-05-26");
    assert.equal(providerBody.enable_thinking, false);
    assert.equal(providerBody.temperature, 0);
    assert.deepEqual(providerBody.response_format, { type: "json_object" });
    assert.equal("max_tokens" in providerBody, false);
    assert.equal(providerBody.messages.length, 2, "assistant replies must never enter the cue analyzer");
    assert.match(providerBody.messages[0].content, /observedExpression/u);
    assert.match(providerBody.messages[0].content, /routine_check_in\|timely_check_in/u);
    assert.match(providerBody.messages[0].content, /no others/u);
    assert.doesNotMatch(JSON.stringify(providerBody), /13812345678|private\.invalid|一三八一二三四五六七八/u);
    assert.match(JSON.stringify(providerBody), /已隐藏手机号/u);

    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "not-json" } }] });
    assert.equal(await analyzeConversationWindow([{ content: "ordinary" }]), null);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...validAnalysis(), diagnosis: "x" }) } }] });
    assert.equal(await analyzeConversationWindow([{ content: "ordinary" }]), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cue table stores no prose, queues follow-up only, retains audit and isolates teacher", async (t) => {
  const mf = new Miniflare({
    compatibilityDate: "2026-05-22", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await migrate(db);
  globalThis.__CLOUDFLARE_TEST_ENV__ = { DB: db, ADULT_EVALUATION_ONLY: "false" };
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO school_classes
    (id,teacher_user_id,name,safety_contact_name,safety_contact_phone,synthetic,active,created_at,updated_at)
    VALUES ('class-a','teacher-a','A','support','000',0,1,?,?),('class-b','teacher-b','B','support','000',0,1,?,?)`)
    .bind(now, now, now, now).run();
  const userSql = `INSERT INTO app_users
    (id,role,username,display_name,password_salt,password_hash,password_iterations,active,class_id,
     age_band,must_change_password,failed_login_count,synthetic,created_at,updated_at)
    VALUES (?,?,?,?, 'salt','hash',210000,1,?,?,0,0,0,?,?)`;
  await db.batch([
    db.prepare(userSql).bind("teacher-a", "teacher", "tea-a", "A", null, null, now, now),
    db.prepare(userSql).bind("teacher-b", "teacher", "tea-b", "B", null, null, now, now),
    db.prepare(userSql).bind("student-a", "student", "stu-a", "Student", "class-a", "under14", now, now),
    db.prepare(`INSERT INTO chat_conversations
      (id,user_id,class_id,started_at,expires_at,student_turns,in_flight,synthetic,created_at,updated_at)
      VALUES ('chat-a','student-a','class-a',?,?,3,0,0,?,?)`).bind(now, now, now, now),
  ]);
  const { listConversationCues, saveConversationCue, updateConversationCue } = await import("../lib/chat-cues.ts");
  const student = { id: "student-a", role: "student", username: "stu-a", displayName: "Student", active: true, classId: "class-a", ageBand: "under14", mustChangePassword: false, guardianConsentVerified: true, studentConsented: true, consentVersion: "x", safetyContact: null, synthetic: false };
  assert.equal(await saveConversationCue({ user: student, conversationId: "chat-a", windowTurn: 3, analysis: validAnalysis({ followUp: "none" }), model: "qwen3.7-plus-2026-05-26" }), false);
  assert.equal(await saveConversationCue({ user: student, conversationId: "chat-a", windowTurn: 3, analysis: validAnalysis(), model: "qwen3.7-plus-2026-05-26" }), true);
  assert.equal(await saveConversationCue({ user: student, conversationId: "chat-a", windowTurn: 3, analysis: validAnalysis(), model: "qwen3.7-plus-2026-05-26" }), false);
  const columns = (await db.prepare("PRAGMA table_info(conversation_cues)").all()).results.map((row) => row.name);
  for (const forbidden of ["content", "raw", "summary", "embedding", "reasoning", "cot"]) {
    assert.equal(columns.some((name) => name.toLowerCase().includes(forbidden)), false);
  }
  assert.equal((await listConversationCues("teacher-b", null)).length, 0);
  const own = await listConversationCues("teacher-a", null);
  assert.equal(own.length, 1);
  assert.deepEqual(own[0].themes, ["school_pressure"]);
  const teacherA = { ...student, id: "teacher-a", role: "teacher", username: "tea-a", classId: null, ageBand: null };
  const teacherB = { ...teacherA, id: "teacher-b", username: "tea-b" };
  await assert.rejects(updateConversationCue(teacherB, own[0].id, "acknowledged"));
  assert.equal((await updateConversationCue(teacherA, own[0].id, "acknowledged")).status, "acknowledged");
  assert.equal((await updateConversationCue(teacherA, own[0].id, "dismissed_inaccurate")).status, "dismissed_inaccurate");

  await db.prepare("DELETE FROM chat_messages WHERE conversation_id='chat-a'").run();
  await db.prepare("DELETE FROM chat_conversations WHERE id='chat-a'").run();
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM conversation_cues WHERE id=?").bind(own[0].id).first()).count, 1);
});

test("teacher cue API rejects anonymous access", async (t) => {
  const mf = new Miniflare({
    compatibilityDate: "2026-05-22", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await migrate(db);
  globalThis.__CLOUDFLARE_TEST_ENV__ = { DB: db, ADULT_EVALUATION_ONLY: "false" };
  const { GET, PATCH } = await import("../app/api/teacher/conversation-cues/route.ts");
  const anonymous = await GET(new Request("http://localhost/api/teacher/conversation-cues"));
  assert.equal(anonymous.status, 401);
  const anonymousPatch = await PATCH(new Request("http://localhost/api/teacher/conversation-cues", {
    method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ cueId: "cue-a", status: "acknowledged" }),
  }));
  assert.equal(anonymousPatch.status, 401);
});
