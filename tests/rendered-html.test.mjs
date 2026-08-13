import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("render-test", `${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function call(pathname, init = {}, bindings = {}) {
  globalThis.__CLOUDFLARE_TEST_ENV__ = bindings;
  return (await worker()).fetch(
    new Request(`http://localhost${pathname}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders student, login and teacher experiences", async () => {
  for (const pathname of ["/", "/login", "/teacher"]) {
    const response = await call(
      pathname,
      { headers: { accept: "text/html" } },
      { ADULT_EVALUATION_ONLY: "false" },
    );
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/iu);
    const html = await response.text();
    assert.match(html, /<html|<!doctype/iu);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/iu);
  }
});

test("adult evaluation mode fails closed and redirects every school surface", async () => {
  for (const pathname of ["/", "/login", "/teacher"]) {
    const response = await call(pathname, { headers: { accept: "text/html" } });
    assert.ok([301, 302, 303, 307, 308].includes(response.status), pathname);
    assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/evaluate");
  }
  const evaluation = await call("/evaluate", { headers: { accept: "text/html" } });
  assert.equal(evaluation.status, 200);
  assert.match(await evaluation.text(), /成人|合成情境/u);
});

test("adult evaluation and the complete synthetic school interface coexist", async () => {
  const bindings = {
    PUBLIC_DEMO_MODE: "true",
    ADULT_EVALUATION_ONLY: "true",
    SANDBOX_MODE: "true",
    SANDBOX_ADMIN_KEY: "sandbox-admin-test-key-123456789",
  };

  for (const pathname of ["/", "/login", "/teacher"]) {
    const response = await call(pathname, { headers: { accept: "text/html" } }, bindings);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, /合成|虚构/u, pathname);
    if (pathname === "/login") assert.match(html, /href="\/evaluate"/u, pathname);
  }

  const evaluation = await call("/evaluate", { headers: { accept: "text/html" } }, bindings);
  assert.equal(evaluation.status, 200);
  const evaluationHtml = await evaluation.text();
  assert.match(evaluationHtml, /心伴双模式演示/u);
  assert.match(evaluationHtml, /href="\/login"/u);
});

test("student consent gate exposes data rights without requiring renewed consent", async () => {
  const source = await readFile(
    new URL("../app/StudentCompanion.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /不同意 AI，也可以管理已有数据/);
  assert.match(source, /fetch\("\/api\/chat\/export"/);
  assert.match(source, /fetch\("\/api\/moods"[\s\S]*method: "DELETE"/);
  assert.match(source, /fetch\("\/api\/chat"[\s\S]*method: "DELETE"/);
});

test("student support hierarchy prioritizes school and psychological support before emergency services", async () => {
  const studentSource = await readFile(new URL("../app/StudentCompanion.tsx", import.meta.url), "utf8");
  const sessionSource = await readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8");
  const supportStart = studentSource.indexOf('id="human-support-card"');
  const supportEnd = studentSource.indexOf("</section>", supportStart);
  const supportBlock = studentSource.slice(supportStart, supportEnd);
  assert.match(supportBlock, /学校心理辅导室/u);
  assert.match(supportBlock, /supportDirectory\.national/u);
  assert.doesNotMatch(supportBlock, /110|120/u);
  assert.match(studentSource, /只有正在发生人身危险或已经受伤时/u);
  assert.match(sessionSource, /phone: "12356"/u);
  assert.match(sessionSource, /LOCAL_MENTAL_HEALTH_PHONE/u);
});

test("student wellbeing tools provide an opt-in breathing exercise and real support circle", async () => {
  const source = await readFile(new URL("../app/StudentCompanion.tsx", import.meta.url), "utf8");
  assert.match(source, /3 分钟能量补给/u);
  assert.match(source, /和小伴呼吸一下/u);
  assert.match(source, /setBreathingSeconds\(60\)/u);
  assert.match(source, /"慢慢吸气"[\s\S]*"停一停"[\s\S]*"缓缓呼气"/u);
  assert.match(source, /开始呼吸[\s\S]*暂停[\s\S]*继续[\s\S]*结束练习/u);
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(source, /aria-live="polite"/u);
  assert.match(source, /不会自动播放声音或打开麦克风/u);
  assert.doesNotMatch(source, /breathing[\s\S]{0,1200}(?:new Audio|speechSynthesis\.speak|startRecording)/iu);

  const circleStart = source.indexOf('className="wellbeing-modal support-circle-modal"');
  const circleEnd = source.indexOf("{withdrawOpen", circleStart);
  const circle = source.slice(circleStart, circleEnd);
  assert.match(circle, /user\?\.safetyContact/u);
  assert.match(circle, /supportDirectory\.local/u);
  assert.match(circle, /supportDirectory\.national/u);
  assert.match(circle, /班主任或任课老师/u);
  assert.match(circle, /监护人或可信任的成年人/u);
  assert.match(circle, /信任的同学或朋友/u);
  assert.match(circle, /只有正在发生人身危险或已经受伤时/u);
  assert.match(circle, /110 或 120/u);
  assert.match(circle, /不会自动拨号或发送消息/u);
});

test("student chat is open-ended with a one-hour rest reminder and two-minute voice clips", async () => {
  const studentSource = await readFile(new URL("../app/StudentCompanion.tsx", import.meta.url), "utf8");
  const conversationSource = await readFile(new URL("../lib/conversations.ts", import.meta.url), "utf8");
  const voiceSource = await readFile(new URL("../lib/voice.ts", import.meta.url), "utf8");
  assert.match(studentSource, /不设固定时长或轮次上限/u);
  assert.match(studentSource, /EYE_BREAK_SECONDS = 60 \* 60/u);
  assert.match(studentSource, /已经聊了约 1 小时/u);
  assert.match(studentSource, /method: "PATCH"[\s\S]*conversationId/u);
  assert.doesNotMatch(studentSource, /剩余时间|剩余轮次|本次 12 轮|本次 15 分钟/u);
  assert.doesNotMatch(conversationSource, /MAX_STUDENT_TURNS|CHAT_REQUESTS_PER_DAY/u);
  assert.match(conversationSource, /CHAT_REQUESTS_PER_MINUTE = 30/u);
  assert.match(conversationSource, /student_turns=CASE WHEN student_turns>0 THEN student_turns-1 ELSE 0 END/u);
  assert.match(studentSource, /RECORDING_LIMIT_SECONDS = 120/u);
  assert.match(studentSource, /没有自动截断。请先删减输入框内容/u);
  assert.doesNotMatch(studentSource, /setNote\([\s\S]{0,160}slice\(0, 600\)/u);
  assert.match(studentSource, /每段最多录 2 分钟/u);
  assert.match(studentSource, /转写并检查后可以继续录下一段/u);
  assert.match(voiceSource, /MAX_AUDIO_DURATION_MS = 120_000/u);
});

test("student restores an unfinished conversation after refresh", async () => {
  const studentSource = await readFile(new URL("../app/StudentCompanion.tsx", import.meta.url), "utf8");
  assert.match(studentSource, /fetch\("\/api\/chat", \{ cache: "no-store" \}\)/u);
  assert.match(studentSource, /conversationId=\$\{encodeURIComponent\(openConversation\.id\)\}/u);
  assert.match(studentSource, /已恢复这段未结束的对话/u);
  assert.match(studentSource, /setPhase\("chat"\)/u);
});

test("three-hour chat creates a separate non-diagnostic teacher attention flow", async () => {
  const conversationSource = await readFile(new URL("../lib/conversations.ts", import.meta.url), "utf8");
  const attentionSource = await readFile(new URL("../lib/attention-events.ts", import.meta.url), "utf8");
  const dashboardSource = await readFile(new URL("../app/teacher/TeacherDashboard.tsx", import.meta.url), "utf8");
  assert.match(conversationSource, /LONG_CHAT_ATTENTION_MILLISECONDS = 3 \* 60 \* 60 \* 1_000/u);
  assert.match(conversationSource, /ON CONFLICT \(kind,source_id\) DO NOTHING/u);
  assert.match(attentionSource, /c\.teacher_user_id=\?/u);
  assert.match(attentionSource, /e\.synthetic=1 AND u\.synthetic=1 AND c\.synthetic=1/u);
  assert.match(dashboardSource, /同一对话持续超过 3 小时/u);
  assert.match(dashboardSource, /学生主动请求支持/u);
  assert.match(dashboardSource, /不代表异常或危机/u);
  assert.match(dashboardSource, /不显示心情或对话原文/u);
});

test("AI care cues are disclosed to students and require teacher verification", async () => {
  const studentSource = await readFile(new URL("../app/StudentCompanion.tsx", import.meta.url), "utf8");
  const dashboardSource = await readFile(new URL("../app/teacher/TeacherDashboard.tsx", import.meta.url), "utf8");
  const studentCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const teacherCss = await readFile(new URL("../app/teacher/teacher.css", import.meta.url), "utf8");
  assert.match(studentSource, /普通对话每 3 个学生回合/u);
  assert.match(studentSource, /老师看不到普通对话原文/u);
  assert.match(studentSource, /原文仍保存在学生账户中，并会由 Qwen 处理/u);
  assert.match(studentSource, /cueCreated\?: boolean/u);
  assert.match(studentSource, /analysisAvailable\?: boolean/u);
  assert.match(dashboardSource, /fetch\(`\/api\/teacher\/conversation-cues/u);
  assert.match(dashboardSource, /cueId: item\.id, status/u);
  assert.match(dashboardSource, /AI 关心线索 · 非危机/u);
  assert.ok(
    dashboardSource.indexOf("紧急人工核对队列") < dashboardSource.indexOf("学生主动支持与休息提示") &&
      dashboardSource.indexOf("学生主动支持与休息提示") < dashboardSource.indexOf('<h2 id="conversation-cue-title">待人工核对'),
    "teacher workbench must present deterministic urgent, explicit/routine, then AI cues",
  );
  assert.match(dashboardSource, /不是诊断或异常判定/u);
  assert.match(dashboardSource, /不能据此写成“学生正常”/u);
  assert.match(dashboardSource, /dismissed_inaccurate/u);
  assert.match(dashboardSource, /safeLabel\(expressionLabels/u);
  assert.match(dashboardSource, /safeLabels\(themeLabels/u);
  assert.doesNotMatch(dashboardSource, /cue\.(?:message|content|transcript|originalText)/u);
  assert.match(studentCss, /\.ai-cue-disclosure/u);
  assert.match(teacherCss, /\.conversation-cue-list/u);
  assert.match(teacherCss, /@media \(max-width: 720px\)[\s\S]*\.conversation-cue-list \{ grid-template-columns: 1fr/u);
});

test("v5 protected APIs reject anonymous sessions", async () => {
  for (const pathname of [
    "/api/moods",
    "/api/chat",
    "/api/chat/export",
    "/api/teacher/summary",
    "/api/teacher/classes",
    "/api/teacher/attention-events",
    "/api/teacher/conversation-cues",
    "/api/teacher/students",
    "/api/teacher/safety-events",
  ]) {
    const response = await call(pathname, {}, { ADULT_EVALUATION_ONLY: "false" });
    assert.equal(response.status, 401, pathname);
  }
  const studentData = await call("/api/student/data", {
    method: "DELETE",
    headers: { origin: "http://localhost" },
  }, { ADULT_EVALUATION_ONLY: "false" });
  assert.equal(studentData.status, 401, "/api/student/data");
});

test("cookie mutations reject missing and cross-site Origin before work", async () => {
  const body = JSON.stringify({ username: "school.user", password: "Example!Pass123" });
  const missing = await call("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(missing.status, 403);

  const crossSite = await call("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.invalid" },
    body: JSON.stringify({ dataUrl: "invalid", mimeType: "audio/wav" }),
  });
  assert.equal(crossSite.status, 403);
});
