import { getRuntimeEnv, type RuntimeEnv } from "@/db";
import { resolveQwenConfig } from "@/lib/qwen";

export type ProviderName = "qwen" | "deepseek" | "doubao" | "kimi";
export type ChatProvider = ProviderName | "demo";

interface ProviderDefinition {
  defaultBaseUrl: string;
  allowedBaseUrls: readonly string[];
  getApiKey: (runtime: RuntimeEnv) => string | undefined;
  getBaseUrl: (runtime: RuntimeEnv) => string | undefined;
  getModel: (runtime: RuntimeEnv) => string | undefined;
}

interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const PROVIDERS: Record<
  Exclude<ProviderName, "qwen">,
  ProviderDefinition
> = {
  deepseek: {
    defaultBaseUrl: "https://api.deepseek.com",
    allowedBaseUrls: [
      "https://api.deepseek.com",
      "https://api.deepseek.com/v1",
    ],
    getApiKey: (runtime) => runtime.DEEPSEEK_API_KEY,
    getBaseUrl: (runtime) => runtime.DEEPSEEK_BASE_URL,
    getModel: (runtime) => runtime.DEEPSEEK_MODEL,
  },
  doubao: {
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    allowedBaseUrls: ["https://ark.cn-beijing.volces.com/api/v3"],
    getApiKey: (runtime) => runtime.DOUBAO_API_KEY,
    getBaseUrl: (runtime) => runtime.DOUBAO_BASE_URL,
    getModel: (runtime) => runtime.DOUBAO_MODEL,
  },
  kimi: {
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    allowedBaseUrls: ["https://api.moonshot.cn/v1"],
    getApiKey: (runtime) => runtime.KIMI_API_KEY,
    getBaseUrl: (runtime) => runtime.KIMI_BASE_URL,
    getModel: (runtime) => runtime.KIMI_MODEL,
  },
};

const SYSTEM_PROMPT = `你是面向中国中小学生的 AI 心情整理助手“心伴”。
用温暖、尊重、适龄的简体中文给一次性回应，通常 60–120 个汉字，最多三句、最多一个容易回答的小问题。
按“接住一句／一个今天能做的小步骤／连接现实支持”组织。不要诊断疾病，不要说教、羞辱或承诺保密，不要索取姓名、学校、电话、住址等身份信息。
不要说“我永远陪你”“只有我懂你”“别告诉别人”“我会等你”等制造依赖或排斥真人关系的话，也不要因为学生结束会话而表达难过。
你不是老师、医生或心理治疗师。若内容涉及人身安全、自伤、他伤或虐待，明确建议学生立刻联系身边可信任的大人；有即时危险时联系 110 或 120。不要提供任何伤害方法或规避成年人帮助的建议。`;

function normalizeBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveProvider(): ProviderConfig | null {
  const runtime = getRuntimeEnv();
  const requested = runtime.AI_PROVIDER?.trim().toLowerCase();
  if (requested === "qwen") {
    const qwen = resolveQwenConfig("chat");
    return qwen ? { provider: "qwen", ...qwen } : null;
  }
  if (!requested || !(requested in PROVIDERS)) return null;

  const provider = requested as keyof typeof PROVIDERS;
  const definition = PROVIDERS[provider];
  const apiKey = definition.getApiKey(runtime)?.trim() ?? "";
  const model = definition.getModel(runtime)?.trim() ?? "";
  const requestedBase =
    definition.getBaseUrl(runtime)?.trim() || definition.defaultBaseUrl;
  const baseUrl = normalizeBaseUrl(requestedBase);
  const allowed = baseUrl
    ? definition.allowedBaseUrls.some(
        (candidate) => normalizeBaseUrl(candidate) === baseUrl,
      )
    : false;

  if (
    !apiKey ||
    apiKey.length > 512 ||
    !model ||
    model.length > 128 ||
    !/^[A-Za-z0-9._:/-]+$/.test(model) ||
    !baseUrl ||
    !allowed
  ) {
    return null;
  }

  return { provider, apiKey, baseUrl, model };
}

function demoReply(mood: string): string {
  const moodText = mood
    ? `我看见你记录了“${mood}”` 
    : "我在认真听你说";
  return `${moodText}。谢谢你愿意把感受告诉我。先把肩膀放松，慢慢呼吸三次，再想一件现在能让自己舒服一点的小事。你愿意先从哪一步开始？`;
}

async function readLimitedResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 65_536) throw new Error("Provider response is too large");
  return JSON.parse(text) as unknown;
}

function extractReply(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;

  let reply = "";
  if (typeof content === "string") {
    reply = content;
  } else if (Array.isArray(content)) {
    reply = content
      .map((item) =>
        item && typeof item === "object" &&
        typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : "",
      )
      .join("");
  }

  const cleaned = reply.replaceAll(String.fromCharCode(0), "").trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, 240).join("");
}

export interface CompanionReply {
  reply: string;
  provider: ChatProvider;
  degraded?: boolean;
}

export async function getCompanionReply(
  mood: string,
  message: string,
): Promise<CompanionReply> {
  const config = resolveProvider();
  if (!config) {
    return { reply: demoReply(mood), provider: "demo" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `当前心情标签：${mood || "未选择"}\n学生想说：${message}`,
          },
        ],
        max_tokens: 260,
        temperature: 0.6,
        stream: false,
        ...(config.provider === "qwen" ? { enable_thinking: false } : {}),
      }),
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("Provider request failed");
    const reply = extractReply(await readLimitedResponse(response));
    if (!reply) throw new Error("Provider returned no reply");
    return { reply, provider: config.provider };
  } catch {
    // Keep the student experience available without exposing provider errors.
    return { reply: demoReply(mood), provider: "demo", degraded: true };
  } finally {
    clearTimeout(timeout);
  }
}
