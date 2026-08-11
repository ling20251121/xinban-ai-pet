import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the student companion experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /心伴 AI-Pet/);
  assert.match(html, /今天的心情/);
  assert.match(html, /仅保存记录/);
  assert.match(html, /AI 生成/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders the teacher sample dashboard without student prose", async () => {
  const response = await render("/teacher");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /教师支持台/);
  assert.match(html, /脱敏示例/);
  assert.match(html, /数据只作支持线索/);
  assert.match(html, /日常聊天原文不会在教师端呈现/);
});
