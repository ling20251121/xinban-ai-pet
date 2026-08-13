import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { Miniflare } from "../node_modules/.pnpm/node_modules/miniflare/dist/src/index.js";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

const ORIGIN = "http://localhost";

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
  workerUrl.searchParams.set("v5-test", `${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`${ORIGIN}${pathname}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function mutation(body, cookie, extraHeaders = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "expected a session cookie");
  return value.split(";", 1)[0];
}

function wavDataUrl(seconds = 1) {
  const sampleRate = 8_000;
  const dataSize = Math.floor(seconds * sampleRate * 2);
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

function paddedWavDataUrl(totalBytes, seconds = 1) {
  const sampleRate = 8_000;
  const dataSize = Math.floor(seconds * sampleRate * 2);
  const junkSize = totalBytes - 52 - dataSize;
  assert.ok(junkSize >= 0);
  const wav = Buffer.alloc(totalBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(totalBytes - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("JUNK", 36);
  wav.writeUInt32LE(junkSize, 40);
  const dataOffset = 44 + junkSize;
  wav.write("data", dataOffset);
  wav.writeUInt32LE(dataSize, dataOffset + 4);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

test("0000 then 0001 preserves every legacy mood field", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const initial = await readFile(new URL("../drizzle/0000_groovy_jane_foster.sql", import.meta.url), "utf8");
  for (const statement of initial.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql) await db.prepare(sql).run();
  }
  const legacy = {
    id: "legacy-row-1",
    hash: "legacy-hash",
    code: "OLD-1001",
    mood: "一般",
    score: 3,
    note: "旧记录正文",
    goal: "早点休息",
    evidence: "主动请求支持",
    created: "2026-01-02T03:04:05.000Z",
  };
  await db.prepare(`INSERT INTO mood_entries
    (id,participant_hash,participant_code,mood,mood_score,note,goal,wants_support,
      safety_level,support_evidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      legacy.id, legacy.hash, legacy.code, legacy.mood, legacy.score, legacy.note,
      legacy.goal, 1, "normal", legacy.evidence, legacy.created,
    ).run();

  const migration = await readFile(new URL("../drizzle/0001_controlled_school_system.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql) await db.prepare(sql).run();
  }
  const row = await db.prepare("SELECT * FROM mood_entries WHERE id=?").bind(legacy.id).first();
  assert.deepEqual(
    {
      id: row.id, hash: row.participant_hash, code: row.participant_code,
      mood: row.mood, score: row.mood_score, note: row.note, goal: row.goal,
      evidence: row.support_evidence, created: row.created_at,
      userId: row.user_id, classId: row.class_id,
    },
    { ...legacy, userId: null, classId: null },
  );
});

test("controlled two-class flow enforces identity, consent and teacher scope", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const bindings = {
    DB: db,
    AUTH_BOOTSTRAP_TOKEN: "bootstrap-test-token-1234567890",
    ADULT_EVALUATION_ONLY: "false",
  };

  const missingOrigin = await callApi(
    "/api/auth/bootstrap",
    { ...mutation({}), headers: { "content-type": "application/json" } },
    bindings,
  );
  assert.equal(missingOrigin.status, 403);

  const bootstrap = await callApi(
    "/api/auth/bootstrap",
    mutation({
      bootstrapToken: bindings.AUTH_BOOTSTRAP_TOKEN,
      username: "teacher.one",
      password: "Teacher!Pass123",
      displayName: "测试教师",
    }),
    bindings,
  );
  assert.equal(bootstrap.status, 201, await bootstrap.clone().text());
  const teacherCookie = cookieFrom(bootstrap);

  const secondBootstrap = await callApi(
    "/api/auth/bootstrap",
    mutation({
      bootstrapToken: bindings.AUTH_BOOTSTRAP_TOKEN,
      username: "teacher.two",
      password: "Teacher!Pass456",
    }),
    bindings,
  );
  assert.equal(secondBootstrap.status, 409);

  async function createClass(name) {
    const response = await callApi(
      "/api/teacher/classes",
      mutation({ name, safetyContactName: "学校值班教师", safetyContactPhone: "010-12345678" }, teacherCookie),
      bindings,
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).classroom;
  }
  const classA = await createClass("A班");
  const classB = await createClass("B班");

  async function createStudent(classId, username) {
    const response = await callApi(
      "/api/teacher/students",
      mutation({
        classId,
        username,
        password: "Initial!Pass123",
        displayName: username,
        ageBand: "under14",
        guardianConsentVerified: true,
      }, teacherCookie),
      bindings,
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).student;
  }
  const studentA = await createStudent(classA.id, "student.a");
  await createStudent(classB.id, "student.b");
  assert.equal(studentA.mustChangePassword, true);
  assert.equal(studentA.ageBand, "under14");

  const login = await callApi(
    "/api/auth/login",
    mutation({ username: "student.a", password: "Initial!Pass123" }),
    bindings,
  );
  assert.equal(login.status, 200, await login.clone().text());
  const studentCookie = cookieFrom(login);

  const beforePassword = await callApi(
    "/api/moods",
    mutation({ mood: "平静", moodScore: 4, note: "测试", goal: "", wantsSupport: false }, studentCookie),
    bindings,
  );
  assert.equal(beforePassword.status, 403);

  const password = await callApi(
    "/api/auth/password",
    mutation({ currentPassword: "Initial!Pass123", newPassword: "Student!NewPass456" }, studentCookie),
    bindings,
  );
  assert.equal(password.status, 200, await password.clone().text());
  const consent = await callApi(
    "/api/auth/consent",
    mutation({ accepted: true }, studentCookie),
    bindings,
  );
  assert.equal(consent.status, 200, await consent.clone().text());

  const privateNote = "FICTIONAL_PRIVATE_NOTE_7291";
  const privateGoal = "FICTIONAL_PRIVATE_GOAL_7291";
  const saved = await callApi(
    "/api/moods",
    mutation({ mood: "平静", moodScore: 4, note: "虚构记录", goal: "早点睡", wantsSupport: false }, studentCookie),
    bindings,
  );
  assert.equal(saved.status, 201, await saved.clone().text());

  const privateSaved = await callApi(
    "/api/moods",
    mutation({
      mood: "calm",
      moodScore: 4,
      note: privateNote,
      goal: privateGoal,
      wantsSupport: true,
    }, studentCookie),
    bindings,
  );
  assert.equal(privateSaved.status, 201, await privateSaved.clone().text());

  const own = await callApi("/api/moods", { headers: { cookie: studentCookie } }, bindings);
  assert.equal(own.status, 200);
  assert.equal((await own.json()).entries.length, 2);

  const classASummary = await callApi(
    `/api/teacher/summary?classId=${classA.id}`,
    { headers: { cookie: teacherCookie } },
    bindings,
  );
  assert.equal(classASummary.status, 200);
  const classASummaryBody = await classASummary.json();
  assert.equal(classASummaryBody.totals.entries, 2);
  assert.doesNotMatch(JSON.stringify(classASummaryBody), new RegExp(`${privateNote}|${privateGoal}`));
  assert.equal("evidence" in classASummaryBody.alerts[0], false);
  const classBSummary = await callApi(
    `/api/teacher/summary?classId=${classB.id}`,
    { headers: { cookie: teacherCookie } },
    bindings,
  );
  assert.equal(classBSummary.status, 200);
  assert.equal((await classBSummary.json()).totals.entries, 0);

  const originalVoiceFetch = globalThis.fetch;
  let asrRequest;
  let asrCalls = 0;
  let asrAudioTokens = 25;
  let includeAsrUsage = true;
  let ttsRequest;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/chat/completions")) {
      asrCalls += 1;
      asrRequest = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{ message: { content: "Fictional short transcript." } }],
        ...(includeAsrUsage
          ? { usage: { prompt_tokens_details: { audio_tokens: asrAudioTokens } } }
          : {}),
      });
    }
    if (url.includes("/multimodal-generation/generation")) {
      ttsRequest = JSON.parse(String(init?.body));
      return Response.json({
        output: {
          audio: {
            data: "",
            url: "https://dashscope-a717.oss-cn-beijing.aliyuncs.com/test.wav?Signature=test",
          },
        },
      });
    }
    if (url.startsWith("https://dashscope-a717.oss-cn-beijing.aliyuncs.com/")) {
      return new Response(Buffer.from(wavDataUrl(0.2).split(",", 2)[1], "base64"), {
        headers: { "content-type": "audio/wav" },
      });
    }
    throw new Error(`unexpected provider URL: ${url}`);
  };
  try {
    const voiceBindings = {
      ...bindings,
      QWEN_API_KEY: "test-only-key",
      QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      QWEN_ASR_MODEL: "qwen3-asr-flash-2026-02-10",
      QWEN_TTS_MODEL: "qwen3-tts-instruct-flash-2026-01-26",
    };
    const transcription = await callApi(
      "/api/voice/transcribe",
      mutation({ dataUrl: wavDataUrl(), mimeType: "audio/wav" }, studentCookie),
      voiceBindings,
    );
    assert.equal(transcription.status, 200, await transcription.clone().text());
    assert.equal((await transcription.json()).text, "Fictional short transcript.");
    assert.equal(asrRequest.model, "qwen3-asr-flash-2026-02-10");

    asrAudioTokens = 3_000;
    const twoMinuteTranscription = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: wavDataUrl(120), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.120" },
      ),
      voiceBindings,
    );
    assert.equal(twoMinuteTranscription.status, 200, await twoMinuteTranscription.clone().text());

    const callsBeforeLongContainer = asrCalls;
    const tooLongContainer = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: wavDataUrl(121), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.121" },
      ),
      voiceBindings,
    );
    assert.equal(tooLongContainer.status, 413);
    assert.match((await tooLongContainer.json()).error, /2 分钟/u);
    assert.equal(asrCalls, callsBeforeLongContainer, "over-limit container must not reach Qwen");

    asrAudioTokens = 3_001;
    const providerReportedTooLong = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: wavDataUrl(1.1), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.122" },
      ),
      voiceBindings,
    );
    assert.equal(providerReportedTooLong.status, 413);

    includeAsrUsage = false;
    const missingProviderUsage = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: wavDataUrl(1.2), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.123" },
      ),
      voiceBindings,
    );
    assert.equal(missingProviderUsage.status, 502, "provider duration metadata must fail closed");
    includeAsrUsage = true;
    asrAudioTokens = 25;

    const maximumSize = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: paddedWavDataUrl(8_000_000), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.124" },
      ),
      voiceBindings,
    );
    assert.equal(maximumSize.status, 200, await maximumSize.clone().text());

    const callsBeforeOversize = asrCalls;
    const oversizedAudio = await callApi(
      "/api/voice/transcribe",
      mutation(
        { dataUrl: paddedWavDataUrl(8_000_001), mimeType: "audio/wav" },
        studentCookie,
        { "x-forwarded-for": "198.51.100.125" },
      ),
      voiceBindings,
    );
    assert.equal(oversizedAudio.status, 413);
    assert.match((await oversizedAudio.json()).error, /8 MB/u);
    assert.equal(asrCalls, callsBeforeOversize, "oversized audio must not reach Qwen");

    const synthesis = await callApi(
      "/api/voice/synthesize",
      mutation({ text: "Take one small step.", userInitiated: true }, studentCookie),
      voiceBindings,
    );
    assert.equal(synthesis.status, 200, await synthesis.clone().text());
    assert.equal(synthesis.headers.get("content-type"), "audio/wav");
    assert.equal(ttsRequest.model, "qwen3-tts-instruct-flash-2026-01-26");
    assert.equal(ttsRequest.input.voice, "Cherry");
  } finally {
    globalThis.fetch = originalVoiceFetch;
  }

  const providerBindings = {
    ...bindings,
    AI_PROVIDER: "qwen",
    QWEN_API_KEY: "test-only-key",
    QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    QWEN_MODEL: "qwen3.7-plus-2026-05-26",
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let analyzerCalls = 0;
  const providerBodies = [];
  globalThis.fetch = async (_input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.response_format?.type === "json_object") {
      analyzerCalls += 1;
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          observedExpression: "mixed",
          themes: ["school_pressure"],
          followUp: "routine_check_in",
          trend: "stable",
          confidence: "medium",
          basis: ["repeated_distress_expression"],
        }) } }],
      });
    }
    providerCalls += 1;
    providerBodies.push(body);
    return Response.json({
      choices: [{ message: { content: "I hear you. Take one small step, then talk with a trusted adult." } }],
    });
  };
  try {
    const crisis = await callApi(
      "/api/chat",
      mutation({ mood: "难过", message: "我现在想死，不知道怎么办。" }, studentCookie),
      providerBindings,
    );
    assert.equal(crisis.status, 200, await crisis.clone().text());
    const crisisBody = await crisis.json();
    assert.equal(crisisBody.urgent, true);
    assert.equal(crisisBody.provider, "local-safety");
    assert.equal(crisisBody.ended, true);
    assert.equal(providerCalls, 0, "urgent text must never be sent to Qwen");

    const eventsResponse = await callApi(
      `/api/teacher/safety-events?classId=${classA.id}`,
      { headers: { cookie: teacherCookie } },
      providerBindings,
    );
    assert.equal(eventsResponse.status, 200);
    const eventPayload = await eventsResponse.json();
    assert.equal(eventPayload.events.length, 1);
    assert.equal(eventPayload.events[0].eventCode, "local_crisis_rule");
    assert.equal(eventPayload.events[0].status, "new");
    assert.equal(eventPayload.events[0].sourceType, "chat");
    assert.doesNotMatch(JSON.stringify(eventPayload), /想死|不知道怎么办/u);
    const urgentConversation = await db.prepare(
      "SELECT ended_reason,ended_at FROM chat_conversations WHERE id=?",
    ).bind(crisisBody.conversationId).first();
    assert.equal(urgentConversation.ended_reason, "urgent");
    assert.ok(urgentConversation.ended_at);

    const teacherCannotReadChat = await callApi(
      `/api/chat?conversationId=${crisisBody.conversationId}`,
      { headers: { cookie: teacherCookie } },
      providerBindings,
    );
    assert.equal(teacherCannotReadChat.status, 403);

    // D1 batch is transactional: if the safety-event insert fails, neither
    // crisis prose nor a local-safety reply nor an urgent close may persist.
    await db.prepare(`CREATE TRIGGER fail_test_support_event
      BEFORE INSERT ON support_events
      BEGIN SELECT RAISE(ABORT, 'test support event failure'); END`).run();
    const failedCrisis = await callApi(
      "/api/chat",
      mutation({ mood: "sad", message: "我现在想死，不知道怎么办。" }, studentCookie),
      providerBindings,
    );
    assert.equal(failedCrisis.status, 500);
    await db.exec("DROP TRIGGER fail_test_support_event;");
    const partialMessages = await db.prepare(`SELECT COUNT(*) count FROM chat_messages
      WHERE user_id=? AND content LIKE '%不知道怎么办%'`).bind(studentA.id).first();
    assert.equal(partialMessages.count, 1, "only the earlier committed crisis may remain");
    const openAfterFailure = await db.prepare(`SELECT id,ended_reason,in_flight FROM chat_conversations
      WHERE user_id=? AND ended_at IS NULL`).bind(studentA.id).first();
    assert.equal(openAfterFailure.ended_reason, null);
    assert.equal(openAfterFailure.in_flight, 0);
    const deleteRolledBackConversation = await callApi(
      "/api/chat",
      {
        method: "DELETE",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: studentCookie },
        body: JSON.stringify({ conversationId: openAfterFailure.id }),
      },
      providerBindings,
    );
    assert.equal(deleteRolledBackConversation.status, 200);

    const deletedUrgent = await callApi(
      "/api/chat",
      {
        method: "DELETE",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: studentCookie },
        body: JSON.stringify({ conversationId: crisisBody.conversationId }),
      },
      providerBindings,
    );
    assert.equal(deletedUrgent.status, 200);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM support_events WHERE source_id=?")
        .bind(crisisBody.conversationId).first()).count,
      1,
      "deleting chat content must retain the structured urgent audit event",
    );

    let conversationId;
    for (let turn = 1; turn <= 13; turn += 1) {
      const response = await callApi(
        "/api/chat",
        mutation({
          mood: "平静",
          message: `This is fictional test turn ${turn}.`,
          ...(conversationId ? { conversationId } : {}),
        }, studentCookie),
        providerBindings,
      );
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      conversationId ??= body.conversationId;
      assert.equal(body.studentTurns, turn);
      assert.equal(body.ended, false);
      if (turn % 3 === 0) {
        assert.equal(body.analysisAvailable, true);
        assert.equal(body.cueCreated, true);
        assert.equal("cueSummary" in body, false, "student API returns only whether a cue was created");
      } else {
        assert.equal("analysisAvailable" in body, false);
      }
    }
    assert.equal(providerCalls, 13);
    assert.equal(analyzerCalls, 4);
    const cueRows = await db.prepare(`SELECT window_turn,observed_expression,themes_json,
      follow_up,trend,confidence,basis_json,status FROM conversation_cues
      WHERE conversation_id=? ORDER BY window_turn`).bind(conversationId).all();
    assert.deepEqual(cueRows.results.map((row) => row.window_turn), [3, 6, 9, 12]);
    assert.doesNotMatch(JSON.stringify(cueRows.results), /fictional test turn/iu);

    globalThis.fetch = async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.response_format?.type === "json_object") {
        analyzerCalls += 1;
        return Response.json({ choices: [{ message: { content: "malformed" } }] });
      }
      providerCalls += 1;
      providerBodies.push(body);
      return Response.json({
        choices: [{ message: { content: "I hear you. Take one small step, then talk with a trusted adult." } }],
      });
    };
    for (let turn = 14; turn <= 15; turn += 1) {
      const response = await callApi(
        "/api/chat",
        mutation({ mood: "calm", message: `Safe malformed analysis turn ${turn}.`, conversationId }, studentCookie),
        providerBindings,
      );
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      if (turn === 15) {
        assert.equal(body.analysisAvailable, false);
        assert.equal(body.cueCreated, false);
      }
    }
    assert.equal(providerCalls, 15, "bad analyzer JSON must not break or roll back chat replies");
    assert.equal(analyzerCalls, 5);
    assert.ok(providerBodies.every((body) => body.model === "qwen3.7-plus-2026-05-26"));
    assert.ok(providerBodies.every((body) => body.enable_thinking === false));
    assert.ok(providerBodies.every((body) => body.messages.length <= 14));
    const finishOpenConversation = await callApi(
      "/api/chat",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: studentCookie },
        body: JSON.stringify({ conversationId }),
      },
      providerBindings,
    );
    assert.equal(finishOpenConversation.status, 200, await finishOpenConversation.clone().text());
    const afterFinish = await callApi(
      "/api/chat",
      mutation({ mood: "平静", message: "This must not call Qwen.", conversationId }, studentCookie),
      providerBindings,
    );
    assert.equal(afterFinish.status, 409);
    assert.equal(providerCalls, 15);

    const atomicDelete = await callApi(
      "/api/student/data",
      { method: "DELETE", headers: { origin: ORIGIN, cookie: studentCookie } },
      providerBindings,
    );
    assert.equal(atomicDelete.status, 200, await atomicDelete.clone().text());
    const deletedPayload = await atomicDelete.json();
    assert.ok(deletedPayload.deleted.messages >= 26);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM chat_messages WHERE user_id=?")
        .bind(studentA.id).first()).count,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM chat_conversations WHERE user_id=?")
        .bind(studentA.id).first()).count,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM mood_entries WHERE user_id=?")
        .bind(studentA.id).first()).count,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM support_events WHERE user_id=?")
        .bind(studentA.id).first()).count,
      1,
      "structured crisis audit remains without student prose",
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) count FROM conversation_cues WHERE user_id=?")
        .bind(studentA.id).first()).count,
      4,
      "text-free teacher cue audit remains after student prose is deleted",
    );
    assert.doesNotMatch(
      JSON.stringify((await db.prepare(`SELECT observed_expression,themes_json,follow_up,
        trend,confidence,basis_json FROM conversation_cues WHERE user_id=?`)
        .bind(studentA.id).all()).results),
      /fictional test turn|Safe malformed analysis/iu,
    );

    const loginB = await callApi(
      "/api/auth/login",
      mutation({ username: "student.b", password: "Initial!Pass123" }),
      bindings,
    );
    assert.equal(loginB.status, 200, await loginB.clone().text());
    const studentBCookie = cookieFrom(loginB);
    const passwordB = await callApi(
      "/api/auth/password",
      mutation({ currentPassword: "Initial!Pass123", newPassword: "Student!Other456" }, studentBCookie),
      bindings,
    );
    assert.equal(passwordB.status, 200, await passwordB.clone().text());
    const consentB = await callApi(
      "/api/auth/consent",
      mutation({ accepted: true }, studentBCookie),
      bindings,
    );
    assert.equal(consentB.status, 200, await consentB.clone().text());
    const crossStudent = await callApi(
      `/api/chat?conversationId=${conversationId}`,
      { headers: { cookie: studentBCookie } },
      bindings,
    );
    assert.equal(crossStudent.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const unauthenticated = await callApi("/api/moods", {}, bindings);
  assert.equal(unauthenticated.status, 401);

  const crossOriginDelete = await callApi(
    "/api/moods",
    {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: studentCookie, origin: "https://evil.invalid" },
      body: "{}",
    },
    bindings,
  );
  assert.equal(crossOriginDelete.status, 403);
});

test("anonymous chat cannot probe crisis handling or trigger a provider", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const now = new Date().toISOString();
  await db.exec(`
    CREATE TABLE school_classes (id TEXT PRIMARY KEY,teacher_user_id TEXT,name TEXT,safety_contact_name TEXT,safety_contact_phone TEXT,active INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE app_users (id TEXT PRIMARY KEY,role TEXT,username TEXT,display_name TEXT,password_salt TEXT,password_hash TEXT,password_iterations INTEGER,active INTEGER,class_id TEXT,age_band TEXT,must_change_password INTEGER,guardian_consent_verified_at TEXT,guardian_consent_verified_by TEXT,student_consented_at TEXT,student_consent_version TEXT,student_consent_withdrawn_at TEXT,created_by_user_id TEXT,failed_login_count INTEGER,locked_until TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT,last_seen_at TEXT,revoked_at TEXT);
  `);
  // Let runtime creation add the remaining tables. This test uses the full
  // bootstrap flow in the previous test for password/session cryptography.
  await db.prepare(`INSERT INTO school_classes VALUES ('c1','t1','测试班','值班教师','010-12345678',1,?,?)`).bind(now, now).run();

  let externalCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("must not call provider"); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await callApi(
    "/api/chat",
    mutation({ mood: "难过", message: "我现在想死，不知道怎么办。" }),
    {
      DB: db,
      AI_PROVIDER: "qwen",
      QWEN_API_KEY: "test-only",
      ADULT_EVALUATION_ONLY: "false",
    },
  );
  assert.equal(response.status, 401);
  assert.equal(externalCalls, 0);
});

test("adult evaluation only blocks every school-account and student-data surface", async (t) => {
  const { mf, db } = await newD1();
  t.after(() => mf.dispose());
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const teacherToken = "t".repeat(43);
  const studentToken = "s".repeat(43);
  const encoder = new TextEncoder();
  const hash = async (value) => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    return Buffer.from(digest).toString("base64url");
  };
  await db.exec(`
    CREATE TABLE school_classes (id TEXT PRIMARY KEY,teacher_user_id TEXT,name TEXT,safety_contact_name TEXT,safety_contact_phone TEXT,active INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE app_users (id TEXT PRIMARY KEY,role TEXT,username TEXT,display_name TEXT,password_salt TEXT,password_hash TEXT,password_iterations INTEGER,active INTEGER,class_id TEXT,age_band TEXT,must_change_password INTEGER,guardian_consent_verified_at TEXT,guardian_consent_verified_by TEXT,student_consented_at TEXT,student_consent_version TEXT,student_consent_withdrawn_at TEXT,created_by_user_id TEXT,failed_login_count INTEGER,locked_until TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT,last_seen_at TEXT,revoked_at TEXT);
  `);
  await db.prepare("INSERT INTO school_classes VALUES (?,?,?,?,?,?,?,?)")
    .bind("adult-only-c1", "adult-only-teacher", "Historical class", "Historical contact", "010-00000000", 1, now, now).run();
  await db.prepare(`INSERT INTO app_users VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      "adult-only-teacher", "teacher", "teacher.old", "Historical teacher", "salt", "hash",
      210000, 1, null, null, 0, null, null, null, null, null, null, 0, null, now, now,
    ).run();
  await db.prepare(`INSERT INTO app_users VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      "adult-only-student", "student", "student.old", "Historical student", "salt", "hash",
      210000, 1, "adult-only-c1", "under14", 0, now, "adult-only-teacher", now,
      "2026-08-v1", null, "adult-only-teacher", 0, null, now, now,
    ).run();
  await db.prepare("INSERT INTO auth_sessions VALUES (?,?,?,?,?,NULL)")
    .bind(await hash(teacherToken), "adult-only-teacher", now, future, now).run();
  await db.prepare("INSERT INTO auth_sessions VALUES (?,?,?,?,?,NULL)")
    .bind(await hash(studentToken), "adult-only-student", now, future, now).run();

  const bindings = { DB: db, AUTH_BOOTSTRAP_TOKEN: "bootstrap-test-token-1234567890" };
  const teacherCookie = `xinban_session=${teacherToken}`;
  const studentCookie = `xinban_session=${studentToken}`;

  const login = await callApi(
    "/api/auth/login",
    mutation({ username: "student.old", password: "Any!Password123" }),
    bindings,
  );
  assert.equal(login.status, 403);
  const teacherLogin = await callApi(
    "/api/auth/login",
    mutation({ username: "teacher.old", password: "Any!Password123" }),
    bindings,
  );
  assert.equal(teacherLogin.status, 403);
  const bootstrap = await callApi(
    "/api/auth/bootstrap",
    mutation({
      bootstrapToken: bindings.AUTH_BOOTSTRAP_TOKEN,
      username: "teacher.new",
      password: "Teacher!Pass123",
    }),
    bindings,
  );
  assert.equal(bootstrap.status, 403);
  const session = await callApi(
    "/api/auth/session",
    { headers: { cookie: studentCookie } },
    bindings,
  );
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, false);
  const teacherSession = await callApi(
    "/api/auth/session",
    { headers: { cookie: teacherCookie } },
    bindings,
  );
  assert.equal(teacherSession.status, 200);
  assert.equal((await teacherSession.json()).authenticated, false);

  const studentRequests = [
    ["/api/moods", { headers: { cookie: studentCookie } }],
    ["/api/moods", mutation({ mood: "calm", moodScore: 4, note: "synthetic", goal: "", wantsSupport: false }, studentCookie)],
    ["/api/moods", { method: "DELETE", headers: { origin: ORIGIN, "content-type": "application/json", cookie: studentCookie }, body: "{}" }],
    ["/api/chat", mutation({ mood: "calm", message: "synthetic" }, studentCookie)],
    ["/api/chat", { headers: { cookie: studentCookie } }],
    ["/api/chat/export", { headers: { cookie: studentCookie } }],
    ["/api/student/data", { method: "DELETE", headers: { origin: ORIGIN, cookie: studentCookie } }],
    ["/api/chat", { method: "DELETE", headers: { origin: ORIGIN, "content-type": "application/json", cookie: studentCookie }, body: "{}" }],
    ["/api/auth/consent", mutation({ accepted: true }, studentCookie)],
    ["/api/auth/password", mutation({ currentPassword: "Old!Password123", newPassword: "New!Password456" }, studentCookie)],
    ["/api/voice/transcribe", mutation({ dataUrl: wavDataUrl(), mimeType: "audio/wav" }, studentCookie)],
    ["/api/voice/synthesize", mutation({ text: "synthetic", userInitiated: true }, studentCookie)],
  ];
  for (const [pathname, init] of studentRequests) {
    const response = await callApi(pathname, init, bindings);
    assert.equal(response.status, 403, pathname);
  }

  const teacherVoice = await callApi(
    "/api/voice/synthesize",
    mutation({ text: "synthetic adult input", userInitiated: true }, teacherCookie),
    bindings,
  );
  assert.equal(teacherVoice.status, 403);

  for (const pathname of [
    "/api/teacher/classes",
    "/api/teacher/students",
    "/api/teacher/summary",
    "/api/teacher/safety-events",
    "/api/teacher/attention-events",
    "/api/teacher/conversation-cues",
  ]) {
    const response = await callApi(pathname, { headers: { cookie: teacherCookie } }, bindings);
    assert.equal(response.status, 403, pathname);
  }

  const teacherMutations = [
    ["/api/teacher/classes", mutation({ name: "Synthetic class" }, teacherCookie)],
    ["/api/teacher/students", mutation({ username: "synthetic.student" }, teacherCookie)],
    [
      "/api/teacher/students",
      {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ studentId: "adult-only-student", active: false }),
      },
    ],
    [
      "/api/teacher/safety-events",
      {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ eventId: "synthetic-event", status: "reviewed" }),
      },
    ],
    [
      "/api/teacher/conversation-cues",
      {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ cueId: "synthetic-cue", status: "acknowledged" }),
      },
    ],
    [
      "/api/teacher/attention-events",
      {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ eventId: "synthetic-attention", status: "acknowledged" }),
      },
    ],
  ];
  for (const [pathname, init] of teacherMutations) {
    const response = await callApi(pathname, init, bindings);
    assert.equal(response.status, 403, `${init.method} ${pathname}`);
  }
});
