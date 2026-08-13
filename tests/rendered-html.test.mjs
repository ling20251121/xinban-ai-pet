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

test("v5 protected APIs reject anonymous sessions", async () => {
  for (const pathname of [
    "/api/moods",
    "/api/chat",
    "/api/chat/export",
    "/api/teacher/summary",
    "/api/teacher/classes",
    "/api/teacher/students",
    "/api/teacher/safety-events",
  ]) {
    const response = await call(pathname, {}, { ADULT_EVALUATION_ONLY: "false" });
    assert.equal(response.status, 401, pathname);
  }
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
