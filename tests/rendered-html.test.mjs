import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

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

async function callApi(pathname, init, bindings = {}) {
  globalThis.__CLOUDFLARE_TEST_ENV__ = bindings;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...bindings,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function wavDataUrl(seconds) {
  const sampleRate = 8_000;
  const bytesPerSample = 2;
  const dataSize = Math.floor(seconds * sampleRate * bytesPerSample);
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

test("server-renders the student companion experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /心伴 AI-Pet/);
  assert.match(html, /今天的心情/);
  assert.match(html, /保存今天的记录/);
  assert.match(html, /默认关闭。开启后，本次记录文字会临时发送/);
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

test("voice transcription rejects cross-origin and malformed requests", async () => {
  const crossOrigin = await callApi("/api/voice/transcribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.invalid",
    },
    body: JSON.stringify({ dataUrl: "not-a-data-url", mimeType: "audio/wav" }),
  });
  assert.equal(crossOrigin.status, 403);

  const malformed = await callApi("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl: "not-a-data-url", mimeType: "audio/wav" }),
  });
  assert.equal(malformed.status, 400);
});

test("voice transcription enforces 30 seconds before calling a provider", async () => {
  const response = await callApi("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataUrl: wavDataUrl(31),
      mimeType: "audio/wav",
    }),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /30 秒/);
});

test("voice transcription enforces the decoded 2.5 MB limit", async () => {
  const oversized = Buffer.alloc(2_500_001).toString("base64");
  const response = await callApi("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataUrl: `data:audio/wav;base64,${oversized}`,
      mimeType: "audio/wav",
    }),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /2\.5 MB/);
});

test("valid short audio fails closed when Qwen ASR is not configured", async () => {
  const response = await callApi("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataUrl: wavDataUrl(1),
      mimeType: "audio/wav",
    }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未配置/);
});

test("local crisis handling runs before a configured Qwen provider", async () => {
  const originalFetch = globalThis.fetch;
  let externalFetches = 0;
  globalThis.fetch = async () => {
    externalFetches += 1;
    throw new Error("external fetch must not run");
  };

  try {
    const response = await callApi(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantCode: "XB-0042",
          mood: "难过",
          message: "我现在想死，不知道怎么办。",
        }),
      },
      {
        AI_PROVIDER: "qwen",
        QWEN_API_KEY: "sk-test-only",
        QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        QWEN_MODEL: "qwen3.7-plus-2026-05-26",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.urgent, true);
    assert.equal(body.provider, "local-safety");
    assert.equal(externalFetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("voice transcription applies local crisis handling to provider text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ message: { content: "我现在想死，不知道怎么办。" } }],
      usage: { seconds: 1 },
    });

  try {
    const response = await callApi(
      "/api/voice/transcribe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataUrl: wavDataUrl(1.1),
          mimeType: "audio/wav",
        }),
      },
      {
        QWEN_API_KEY: "sk-test-only",
        QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        QWEN_ASR_MODEL: "qwen3-asr-flash-2026-02-10",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.text, "我现在想死，不知道怎么办。");
    assert.equal(body.urgent, true);
    assert.match(body.message, /可信任的大人/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("voice transcription applies a per-client prototype rate limit", async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await callApi("/api/voice/transcribe", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "content-type": "application/json",
      },
      body: JSON.stringify({ dataUrl: "invalid", mimeType: "audio/wav" }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 6), [400, 400, 400, 400, 400, 400]);
  assert.equal(statuses[6], 429);
});

test("voice transcription fails closed when provider duration is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "今天还好。" } }] });

  try {
    const response = await callApi(
      "/api/voice/transcribe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataUrl: wavDataUrl(1),
          mimeType: "audio/wav",
        }),
      },
      {
        QWEN_API_KEY: "sk-test-only",
        QWEN_ASR_MODEL: "qwen3-asr-flash-2026-02-10",
      },
    );
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
