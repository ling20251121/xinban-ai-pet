import { getRuntimeEnv } from "@/db";

export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_QWEN_CHAT_MODEL = "qwen3.7-plus-2026-05-26";
export const DEFAULT_QWEN_ASR_MODEL = "qwen3-asr-flash-2026-02-10";
export const DEFAULT_QWEN_TTS_MODEL =
  "qwen3-tts-instruct-flash-2026-01-26";
export const QWEN_TTS_VOICE = "Cherry";

export interface QwenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface QwenTtsConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  voice: typeof QWEN_TTS_VOICE;
}

function normalizeQwenBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "");
    const isLegacyBeijingHost = parsed.hostname === "dashscope.aliyuncs.com";
    const isWorkspaceBeijingHost =
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/i.test(
        parsed.hostname,
      );

    if (
      parsed.protocol !== "https:" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      path !== "/compatible-mode/v1" ||
      (!isLegacyBeijingHost && !isWorkspaceBeijingHost)
    ) {
      return null;
    }

    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

function validSecret(value: string): boolean {
  return value.length > 0 && value.length <= 512;
}

function configuredApiKey(): string {
  const runtime = getRuntimeEnv();
  return runtime.QWEN_API_KEY?.trim() || runtime.DASHSCOPE_API_KEY?.trim() || "";
}

/**
 * Resolve only Model Studio endpoints in China (Beijing) and exact model
 * snapshots reviewed for this research prototype. An invalid environment
 * value fails closed instead of forwarding student content elsewhere.
 */
export function resolveQwenConfig(purpose: "chat" | "asr"): QwenConfig | null {
  const runtime = getRuntimeEnv();
  const apiKey = configuredApiKey();
  const baseUrl = normalizeQwenBaseUrl(
    runtime.QWEN_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL,
  );
  const expectedModel =
    purpose === "chat" ? DEFAULT_QWEN_CHAT_MODEL : DEFAULT_QWEN_ASR_MODEL;
  const configuredModel =
    purpose === "chat" ? runtime.QWEN_MODEL : runtime.QWEN_ASR_MODEL;
  const model = configuredModel?.trim() || expectedModel;

  if (!validSecret(apiKey) || !baseUrl || model !== expectedModel) return null;
  return { apiKey, baseUrl, model };
}

export function resolveQwenTtsConfig(): QwenTtsConfig | null {
  const runtime = getRuntimeEnv();
  const apiKey = configuredApiKey();
  const baseUrl = normalizeQwenBaseUrl(
    runtime.QWEN_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL,
  );
  const model = runtime.QWEN_TTS_MODEL?.trim() || DEFAULT_QWEN_TTS_MODEL;
  if (!validSecret(apiKey) || !baseUrl || model !== DEFAULT_QWEN_TTS_MODEL) {
    return null;
  }

  const origin = new URL(baseUrl).origin;
  return {
    apiKey,
    endpoint: `${origin}/api/v1/services/aigc/multimodal-generation/generation`,
    model,
    voice: QWEN_TTS_VOICE,
  };
}

export function normalizeQwenAudioUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.hostname !== "dashscope-result-bj.oss-cn-beijing.aliyuncs.com"
    ) {
      return null;
    }

    // The official response example currently uses an http:// signed URL.
    // OSS supports TLS on the same Beijing host, so always upgrade it before
    // downloading instead of allowing a plaintext audio transfer.
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}
