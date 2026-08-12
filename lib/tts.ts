import { validateSpeechText } from "@/lib/content-safety";
import { ApiError } from "@/lib/http";
import {
  normalizeQwenAudioUrl,
  resolveQwenTtsConfig,
} from "@/lib/qwen";
import { CRISIS_REPLY, analyzeSafety } from "@/lib/safety";
import { asObject } from "@/lib/validation";

const TTS_TIMEOUT_MS = 20_000;
const MAX_TTS_JSON_BYTES = 3_400_000;
const MAX_TTS_AUDIO_BYTES = 2_500_000;
const MAX_TTS_TEXT_CHARACTERS = 240;

export interface TtsPayload {
  text: string;
  userInitiated: true;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "朗读内容格式不正确。");
  }
  const cleaned = value.replaceAll(String.fromCharCode(0), "").trim();
  if (!cleaned || Array.from(cleaned).length > MAX_TTS_TEXT_CHARACTERS) {
    throw new ApiError(400, `朗读内容需要在 1–${MAX_TTS_TEXT_CHARACTERS} 个字符之间。`);
  }
  return cleaned;
}

export function parseTtsPayload(value: unknown): TtsPayload {
  const body = asObject(value);
  if (Object.keys(body).some((key) => key !== "text" && key !== "userInitiated")) {
    throw new ApiError(400, "朗读请求包含无法识别的字段。");
  }
  if (body.userInitiated !== true) {
    throw new ApiError(400, "只有在你主动点击朗读后才会生成语音。");
  }

  const text = cleanText(body.text);
  if (text !== CRISIS_REPLY && analyzeSafety(text).urgent) {
    throw new ApiError(422, "这段内容涉及紧急安全风险，请先阅读页面上的真人求助提示。");
  }
  return { text: text === CRISIS_REPLY ? text : validateSpeechText(text), userInitiated: true };
}

export function speechFingerprint(text: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const codePoint of text) {
    const code = codePoint.codePointAt(0) ?? 0;
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${Array.from(text).length.toString(16)}-${(left >>> 0).toString(16)}-${(right >>> 0).toString(16)}`;
}

async function readBoundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  }
  if (!response.body) throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function decodeBase64Audio(value: string): Uint8Array {
  const marker = ";base64,";
  const base64 = value.startsWith("data:")
    ? value.slice(value.indexOf(marker) + marker.length)
    : value;
  if (
    !base64 ||
    (value.startsWith("data:") && !value.startsWith("data:audio/wav;base64,")) ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const decodedLength = (base64.length / 4) * 3 - padding;
  if (decodedLength <= 0 || decodedLength > MAX_TTS_AUDIO_BYTES) {
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  }

  try {
    const decoded = atob(base64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  }
}

function validateWav(bytes: Uint8Array): Uint8Array {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.byteLength < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  }
  return bytes;
}

function extractAudio(payload: unknown): { data?: string; url?: string } {
  if (!payload || typeof payload !== "object") return {};
  const output = (payload as { output?: unknown }).output;
  if (!output || typeof output !== "object") return {};
  const audio = (output as { audio?: unknown }).audio;
  if (!audio || typeof audio !== "object") return {};
  const data = (audio as { data?: unknown }).data;
  const url = (audio as { url?: unknown }).url;
  return {
    ...(typeof data === "string" ? { data } : {}),
    ...(typeof url === "string" ? { url } : {}),
  };
}

export async function synthesizeWithQwen(text: string): Promise<Uint8Array> {
  const config = resolveQwenTtsConfig();
  if (!config) {
    throw new ApiError(503, "语音朗读尚未配置，请直接阅读文字或联系项目管理员。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: {
          text,
          voice: config.voice,
          language_type: "Chinese",
          instructions: "使用温和、平静、清晰、自然的普通话朗读，不夸张，不模仿任何真实人物。",
          optimize_instructions: false,
        },
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");

    const jsonBytes = await readBoundedBytes(response, MAX_TTS_JSON_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
    } catch {
      throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
    }
    const audio = extractAudio(payload);
    if (audio.data) return validateWav(decodeBase64Audio(audio.data));
    const audioUrl = audio.url ? normalizeQwenAudioUrl(audio.url) : null;
    if (!audioUrl) {
      throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
    }

    const audioResponse = await fetch(audioUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!audioResponse.ok) throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
    return validateWav(await readBoundedBytes(audioResponse, MAX_TTS_AUDIO_BYTES));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "语音朗读超时了，请稍后再试。");
    }
    throw new ApiError(502, "语音朗读暂时不可用，请稍后再试。");
  } finally {
    clearTimeout(timeout);
  }
}
