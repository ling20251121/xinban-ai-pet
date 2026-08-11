import { getRuntimeEnv } from "@/db";

export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_QWEN_CHAT_MODEL = "qwen3.7-plus-2026-05-26";
export const DEFAULT_QWEN_ASR_MODEL = "qwen3-asr-flash-2026-02-10";

export interface QwenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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

function validModel(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:/-]+$/.test(value)
  );
}

/**
 * Resolve only China (Beijing) Model Studio endpoints. This is deliberately
 * strict so an environment-variable typo cannot forward student content to an
 * arbitrary host.
 */
export function resolveQwenConfig(purpose: "chat" | "asr"): QwenConfig | null {
  const runtime = getRuntimeEnv();
  const apiKey =
    runtime.QWEN_API_KEY?.trim() || runtime.DASHSCOPE_API_KEY?.trim() || "";
  const baseUrl = normalizeQwenBaseUrl(
    runtime.QWEN_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL,
  );
  const model =
    purpose === "chat"
      ? runtime.QWEN_MODEL?.trim() || DEFAULT_QWEN_CHAT_MODEL
      : runtime.QWEN_ASR_MODEL?.trim() || DEFAULT_QWEN_ASR_MODEL;

  if (!validSecret(apiKey) || !baseUrl || !validModel(model)) return null;
  if (
    purpose === "asr" &&
    !/^qwen3-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
  ) {
    return null;
  }

  return { apiKey, baseUrl, model };
}
