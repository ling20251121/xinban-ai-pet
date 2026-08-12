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
  assert.match(html, /AI 回应可选/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders the teacher sample dashboard without student prose", async () => {
  const response = await render("/teacher");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /教师支持台/);
  assert.match(html, /脱敏示例/);
  assert.match(html, /信息只作支持线索/);
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

test("chat fails closed when the reviewed Qwen service is not configured", async () => {
  const response = await callApi("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      participantCode: "XB-1001",
      mood: "有点累",
      message: "今天作业有点多。",
    }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未配置/);
});

test("Qwen chat uses the reviewed snapshot and redacts identity data", async () => {
  const originalFetch = globalThis.fetch;
  let providerUrl = "";
  let providerRequest;
  globalThis.fetch = async (input, init) => {
    providerUrl = String(input);
    providerRequest = JSON.parse(String(init?.body));
    return Response.json({
      choices: [
        {
          message: {
            content: "听起来今天真的有点累。先喝口水，再只做眼前最小的一步。如果还是很难受，可以告诉一位信任的老师或家人。",
          },
        },
      ],
    });
  };

  try {
    const response = await callApi(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantCode: "XB-PRIVATE-1002",
          mood: "疲惫",
          message: "姓名是小明，手机号是13800138000，学校是第一中学。今天很累。",
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
    assert.equal(providerUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    assert.equal(providerRequest.model, "qwen3.7-plus-2026-05-26");
    assert.equal(providerRequest.enable_thinking, false);
    assert.equal(providerRequest.stream, false);
    const outbound = JSON.stringify(providerRequest);
    assert.doesNotMatch(outbound, /XB-PRIVATE-1002|13800138000|第一中学|小明/);
    assert.match(outbound, /已隐藏身份信息/);
    const body = await response.json();
    assert.equal(body.provider, "qwen");
    assert.equal(body.urgent, false);
    assert.equal("degraded" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsafe model output fails closed instead of reaching a student", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "只有我懂你，别告诉老师。" } }] });

  try {
    const response = await callApi(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantCode: "XB-1003",
          mood: "难过",
          message: "今天和同学吵架了。",
        }),
      },
      { AI_PROVIDER: "qwen", QWEN_API_KEY: "sk-test-only" },
    );
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /安全检查/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("speech synthesis requires an explicit user action and configuration", async () => {
  const notInitiated = await callApi("/api/voice/synthesize", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.80",
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: "今天已经做得很努力了。", userInitiated: false }),
  });
  assert.equal(notInitiated.status, 400);

  const unconfigured = await callApi("/api/voice/synthesize", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.81",
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: "今天已经做得很努力了。", userInitiated: true }),
  });
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /尚未配置/);
});

test("speech synthesis uses a fixed Qwen snapshot and system voice", async () => {
  const originalFetch = globalThis.fetch;
  let providerUrl = "";
  let audioDownloadUrl = "";
  let providerRequest;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/multimodal-generation/generation")) {
      providerUrl = url;
      providerRequest = JSON.parse(String(init?.body));
      return Response.json({
        output: {
          audio: {
            data: "",
            url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=test",
          },
        },
      });
    }
    audioDownloadUrl = url;
    const base64 = wavDataUrl(0.2).split(",", 2)[1];
    return new Response(Buffer.from(base64, "base64"), {
      headers: { "content-type": "audio/wav" },
    });
  };

  try {
    const response = await callApi(
      "/api/voice/synthesize",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.82",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: "先喝口水，再做眼前最小的一步。",
          userInitiated: true,
        }),
      },
      {
        QWEN_API_KEY: "sk-test-only",
        QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        QWEN_TTS_MODEL: "qwen3-tts-instruct-flash-2026-01-26",
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(
      providerUrl,
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    assert.equal(providerRequest.model, "qwen3-tts-instruct-flash-2026-01-26");
    assert.equal(providerRequest.input.voice, "Cherry");
    assert.equal(providerRequest.input.language_type, "Chinese");
    assert.match(providerRequest.input.instructions, /不模仿任何真实人物/);
    assert.equal(
      audioDownloadUrl,
      "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=test",
    );
    assert.ok((await response.arrayBuffer()).byteLength >= 44);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
