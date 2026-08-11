import { ApiError } from "@/lib/http";
import { resolveQwenConfig } from "@/lib/qwen";
import { asObject } from "@/lib/validation";

export const MAX_AUDIO_BYTES = 2_500_000;
export const MAX_AUDIO_DURATION_MS = 30_000;
export const MAX_VOICE_REQUEST_BYTES = 3_340_000;

const DURATION_CONTAINER_TOLERANCE_MS = 250;
const PROVIDER_RESPONSE_LIMIT_BYTES = 65_536;
const TRANSCRIPT_LIMIT_CHARACTERS = 600;
const QWEN_ASR_TIMEOUT_MS = 20_000;

type AudioKind = "webm" | "ogg" | "wav" | "mp3";

const MIME_TYPES: Readonly<Record<string, { canonical: string; kind: AudioKind }>> = {
  "audio/webm": { canonical: "audio/webm", kind: "webm" },
  "audio/ogg": { canonical: "audio/ogg", kind: "ogg" },
  "audio/wav": { canonical: "audio/wav", kind: "wav" },
  "audio/x-wav": { canonical: "audio/wav", kind: "wav" },
  "audio/mpeg": { canonical: "audio/mpeg", kind: "mp3" },
  "audio/mp3": { canonical: "audio/mpeg", kind: "mp3" },
};

export interface ValidatedAudio {
  dataUrl: string;
  durationMs: number;
  fingerprint: string;
  mimeType: string;
  sizeBytes: number;
}

interface EbmlValue {
  length: number;
  unknown: boolean;
  value: number;
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function resolveMimeType(value: string): { canonical: string; kind: AudioKind } {
  const resolved = MIME_TYPES[normalizeMimeType(value)];
  if (!resolved) {
    throw new ApiError(
      415,
      "录音格式暂不支持，请使用 WebM、Ogg、MP3 或 WAV 格式，或改用文字输入。",
    );
  }
  return resolved;
}

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new ApiError(400, "录音数据无法识别，请重新录制。");
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength <= 0) {
    throw new ApiError(400, "没有收到录音内容，请重新录制。");
  }
  if (decodedLength > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "录音不能超过 2.5 MB，请缩短后重试。");
  }

  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new ApiError(400, "录音数据无法识别，请重新录制。");
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return "";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index]);
  }
  return value;
}

function audioFingerprint(bytes: Uint8Array): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const byte of bytes) {
    left = Math.imul(left ^ byte, 0x01000193);
    right = Math.imul(right ^ byte, 0x85ebca6b);
  }
  return `${bytes.byteLength.toString(16)}-${(left >>> 0).toString(16)}-${(right >>> 0).toString(16)}`;
}

function findBytes(
  bytes: Uint8Array,
  needle: readonly number[],
  from = 0,
): number {
  const finalStart = bytes.length - needle.length;
  for (let offset = Math.max(0, from); offset <= finalStart; offset += 1) {
    let matches = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[offset + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset;
  }
  return -1;
}

function readUnsignedBigEndian(
  bytes: Uint8Array,
  offset: number,
  length: number,
): number | null {
  if (length < 1 || length > 7 || offset < 0 || offset + length > bytes.length) {
    return null;
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  return Number.isSafeInteger(value) ? value : null;
}

function readEbmlVint(bytes: Uint8Array, offset: number): EbmlValue | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;

  let length = 1;
  let marker = 0x80;
  while ((first & marker) === 0) {
    marker >>= 1;
    length += 1;
    if (length > 8) return null;
  }
  if (offset + length > bytes.length) return null;

  let value = first & (marker - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  const unknownValue = 2 ** (7 * length) - 1;
  return { length, unknown: value === unknownValue, value };
}

function readEbmlId(bytes: Uint8Array, offset: number): EbmlValue | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;

  let length = 1;
  let marker = 0x80;
  while ((first & marker) === 0) {
    marker >>= 1;
    length += 1;
    if (length > 4) return null;
  }
  if (offset + length > bytes.length) return null;

  const value = readUnsignedBigEndian(bytes, offset, length);
  return value === null ? null : { length, unknown: false, value };
}

function parseWebmInfo(bytes: Uint8Array): {
  durationMs: number | null;
  timecodeScale: number;
} {
  const infoOffset = findBytes(bytes, [0x15, 0x49, 0xa9, 0x66]);
  if (infoOffset < 0) return { durationMs: null, timecodeScale: 1_000_000 };

  const size = readEbmlVint(bytes, infoOffset + 4);
  if (!size || size.unknown) {
    return { durationMs: null, timecodeScale: 1_000_000 };
  }
  let cursor = infoOffset + 4 + size.length;
  const end = Math.min(bytes.length, cursor + size.value);
  let durationUnits: number | null = null;
  let timecodeScale = 1_000_000;

  while (cursor < end) {
    const id = readEbmlId(bytes, cursor);
    if (!id) break;
    const elementSize = readEbmlVint(bytes, cursor + id.length);
    if (!elementSize || elementSize.unknown) break;
    const dataStart = cursor + id.length + elementSize.length;
    const dataEnd = dataStart + elementSize.value;
    if (dataEnd > end) break;

    if (id.value === 0x2ad7b1) {
      const parsed = readUnsignedBigEndian(bytes, dataStart, elementSize.value);
      if (parsed && parsed <= 1_000_000_000) timecodeScale = parsed;
    } else if (id.value === 0x4489 && (elementSize.value === 4 || elementSize.value === 8)) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + dataStart,
        elementSize.value,
      );
      const parsed =
        elementSize.value === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false);
      if (Number.isFinite(parsed) && parsed > 0) durationUnits = parsed;
    }
    cursor = dataEnd;
  }

  return {
    durationMs:
      durationUnits === null ? null : (durationUnits * timecodeScale) / 1_000_000,
    timecodeScale,
  };
}

function parseBlockRelativeTimecode(
  bytes: Uint8Array,
  offset: number,
  size: number,
): number | null {
  const track = readEbmlVint(bytes, offset);
  if (!track || size < track.length + 3 || offset + track.length + 2 > bytes.length) {
    return null;
  }
  const unsigned = bytes[offset + track.length] * 256 + bytes[offset + track.length + 1];
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

function parseWebmCluster(
  bytes: Uint8Array,
  start: number,
  end: number,
): number | null {
  let cursor = start;
  let clusterTimecode = 0;
  let maximumTimecode: number | null = null;

  while (cursor < end) {
    const id = readEbmlId(bytes, cursor);
    if (!id) break;
    const size = readEbmlVint(bytes, cursor + id.length);
    if (!size || size.unknown) break;
    const dataStart = cursor + id.length + size.length;
    const dataEnd = dataStart + size.value;
    if (dataEnd > end) break;

    if (id.value === 0xe7) {
      const parsed = readUnsignedBigEndian(bytes, dataStart, size.value);
      if (parsed !== null) clusterTimecode = parsed;
    } else if (id.value === 0xa3) {
      const relative = parseBlockRelativeTimecode(bytes, dataStart, size.value);
      if (relative !== null) {
        maximumTimecode = Math.max(maximumTimecode ?? 0, clusterTimecode + relative + 20);
      }
    } else if (id.value === 0xa0) {
      let groupCursor = dataStart;
      let relative: number | null = null;
      let blockDuration = 20;
      while (groupCursor < dataEnd) {
        const childId = readEbmlId(bytes, groupCursor);
        if (!childId) break;
        const childSize = readEbmlVint(bytes, groupCursor + childId.length);
        if (!childSize || childSize.unknown) break;
        const childStart = groupCursor + childId.length + childSize.length;
        const childEnd = childStart + childSize.value;
        if (childEnd > dataEnd) break;
        if (childId.value === 0xa1) {
          relative = parseBlockRelativeTimecode(bytes, childStart, childSize.value);
        } else if (childId.value === 0x9b) {
          const parsed = readUnsignedBigEndian(bytes, childStart, childSize.value);
          if (parsed !== null) blockDuration = parsed;
        }
        groupCursor = childEnd;
      }
      if (relative !== null) {
        maximumTimecode = Math.max(
          maximumTimecode ?? 0,
          clusterTimecode + relative + blockDuration,
        );
      }
    }
    cursor = dataEnd;
  }

  return maximumTimecode;
}

function webmDurationMs(bytes: Uint8Array): number | null {
  const info = parseWebmInfo(bytes);
  if (info.durationMs !== null) return info.durationMs;

  const marker = [0x1f, 0x43, 0xb6, 0x75] as const;
  let clusterOffset = findBytes(bytes, marker);
  let maximumUnits: number | null = null;

  while (clusterOffset >= 0) {
    const size = readEbmlVint(bytes, clusterOffset + marker.length);
    if (!size) break;
    const dataStart = clusterOffset + marker.length + size.length;
    const nextCluster = findBytes(bytes, marker, dataStart);
    const declaredEnd = size.unknown ? bytes.length : dataStart + size.value;
    const clusterEnd = Math.min(
      bytes.length,
      nextCluster >= 0 ? nextCluster : declaredEnd,
      declaredEnd,
    );
    const parsed = parseWebmCluster(bytes, dataStart, clusterEnd);
    if (parsed !== null) maximumUnits = Math.max(maximumUnits ?? 0, parsed);
    if (nextCluster < 0) break;
    clusterOffset = nextCluster;
  }

  return maximumUnits === null
    ? null
    : (maximumUnits * info.timecodeScale) / 1_000_000;
}

function oggDurationMs(bytes: Uint8Array): number | null {
  let cursor = 0;
  let preSkip: number | null = null;
  let lastGranule: number | null = null;

  while (cursor + 27 <= bytes.length) {
    if (ascii(bytes, cursor, 4) !== "OggS" || bytes[cursor + 4] !== 0) return null;
    const segmentCount = bytes[cursor + 26];
    const tableStart = cursor + 27;
    const dataStart = tableStart + segmentCount;
    if (dataStart > bytes.length) return null;
    let dataLength = 0;
    for (let index = 0; index < segmentCount; index += 1) {
      dataLength += bytes[tableStart + index];
    }
    const pageEnd = dataStart + dataLength;
    if (pageEnd > bytes.length) return null;

    const low =
      bytes[cursor + 6] +
      bytes[cursor + 7] * 256 +
      bytes[cursor + 8] * 65_536 +
      bytes[cursor + 9] * 16_777_216;
    const high =
      bytes[cursor + 10] +
      bytes[cursor + 11] * 256 +
      bytes[cursor + 12] * 65_536 +
      bytes[cursor + 13] * 16_777_216;
    if (low !== 0xffffffff || high !== 0xffffffff) {
      lastGranule = high * 4_294_967_296 + (low >>> 0);
    }

    if (preSkip === null) {
      const opusHead = findBytes(bytes.subarray(dataStart, pageEnd), [79, 112, 117, 115, 72, 101, 97, 100]);
      if (opusHead >= 0 && dataStart + opusHead + 12 <= pageEnd) {
        const absolute = dataStart + opusHead;
        preSkip = bytes[absolute + 10] + bytes[absolute + 11] * 256;
      }
    }
    cursor = pageEnd;
  }

  if (preSkip === null || lastGranule === null || lastGranule <= preSkip) return null;
  return ((lastGranule - preSkip) / 48_000) * 1_000;
}

function wavDurationMs(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;

  while (cursor + 8 <= bytes.length) {
    const id = ascii(bytes, cursor, 4);
    const size = view.getUint32(cursor + 4, true);
    const dataStart = cursor + 8;
    if (dataStart + size > bytes.length) break;
    if (id === "fmt " && size >= 16) byteRate = view.getUint32(dataStart + 8, true);
    if (id === "data") dataSize = size;
    cursor = dataStart + size + (size % 2);
  }

  if (!byteRate || dataSize === null) return null;
  return (dataSize / byteRate) * 1_000;
}

function synchsafeSize(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  const values = bytes.subarray(offset, offset + 4);
  if (values.some((value) => value > 0x7f)) return null;
  return values[0] * 2_097_152 + values[1] * 16_384 + values[2] * 128 + values[3];
}

function mp3DurationMs(bytes: Uint8Array): number | null {
  let cursor = 0;
  if (ascii(bytes, 0, 3) === "ID3") {
    const tagSize = synchsafeSize(bytes, 6);
    if (tagSize === null) return null;
    cursor = 10 + tagSize;
  }

  const mpeg1Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = [44_100, 48_000, 32_000];
  let durationSeconds = 0;
  let frames = 0;
  let searched = 0;

  while (cursor + 4 <= bytes.length) {
    const first = bytes[cursor];
    const second = bytes[cursor + 1];
    const third = bytes[cursor + 2];
    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleIndex = (third >> 2) & 0x03;
    const isHeader =
      first === 0xff &&
      (second & 0xe0) === 0xe0 &&
      versionBits !== 1 &&
      layerBits === 1 &&
      bitrateIndex > 0 &&
      bitrateIndex < 15 &&
      sampleIndex < 3;

    if (!isHeader) {
      if (frames > 0 || searched > 4_096) break;
      cursor += 1;
      searched += 1;
      continue;
    }

    const isMpeg1 = versionBits === 3;
    const divisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
    const sampleRate = sampleRates[sampleIndex] / divisor;
    const bitrate = (isMpeg1 ? mpeg1Rates : mpeg2Rates)[bitrateIndex] * 1_000;
    const padding = (third >> 1) & 1;
    const samplesPerFrame = isMpeg1 ? 1_152 : 576;
    const frameLength = Math.floor(
      ((isMpeg1 ? 144 : 72) * bitrate) / sampleRate + padding,
    );
    if (frameLength < 4 || cursor + frameLength > bytes.length) break;
    durationSeconds += samplesPerFrame / sampleRate;
    frames += 1;
    cursor += frameLength;
  }

  return frames > 0 ? durationSeconds * 1_000 : null;
}

function validateSignature(bytes: Uint8Array, kind: AudioKind): void {
  const valid =
    (kind === "webm" &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3) ||
    (kind === "ogg" && ascii(bytes, 0, 4) === "OggS") ||
    (kind === "wav" && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") ||
    (kind === "mp3" &&
      (ascii(bytes, 0, 3) === "ID3" ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)));

  if (!valid) throw new ApiError(400, "录音内容与文件格式不一致，请重新录制。");
}

function measureDuration(bytes: Uint8Array, kind: AudioKind): number | null {
  if (kind === "webm") return webmDurationMs(bytes);
  if (kind === "ogg") return oggDurationMs(bytes);
  if (kind === "wav") return wavDurationMs(bytes);
  return mp3DurationMs(bytes);
}

export function parseVoicePayload(value: unknown): ValidatedAudio {
  const body = asObject(value);
  if (Object.keys(body).some((key) => key !== "dataUrl" && key !== "mimeType")) {
    throw new ApiError(400, "录音请求包含无法识别的字段。");
  }
  if (typeof body.dataUrl !== "string") {
    throw new ApiError(400, "没有收到可识别的录音，请重新录制。");
  }
  if (typeof body.mimeType !== "string" || !body.mimeType.trim()) {
    throw new ApiError(400, "录音格式信息不正确，请重新录制。");
  }

  const comma = body.dataUrl.indexOf(",");
  if (comma < 0 || !body.dataUrl.startsWith("data:")) {
    throw new ApiError(400, "录音数据无法识别，请重新录制。");
  }
  const metadata = body.dataUrl.slice(5, comma).split(";");
  const declaredMime = metadata.shift() ?? "";
  const finalParameter = metadata.pop()?.toLowerCase();
  if (finalParameter !== "base64") {
    throw new ApiError(400, "录音数据需要使用 Base64 格式。");
  }
  if (
    metadata.some(
      (parameter) =>
        parameter.length > 80 || !/^codecs=[A-Za-z0-9._,+-]+$/i.test(parameter),
    )
  ) {
    throw new ApiError(400, "录音格式参数无法识别，请重新录制。");
  }

  const resolved = resolveMimeType(declaredMime);
  const bodyMime = resolveMimeType(body.mimeType);
  if (bodyMime.canonical !== resolved.canonical) {
    throw new ApiError(400, "录音格式信息不一致，请重新录制。");
  }

  const base64 = body.dataUrl.slice(comma + 1);
  const bytes = decodeBase64(base64);
  validateSignature(bytes, resolved.kind);
  const durationMs = measureDuration(bytes, resolved.kind);
  if (!durationMs || !Number.isFinite(durationMs)) {
    throw new ApiError(
      400,
      "无法确认这段录音的时长，请使用浏览器默认录音格式重新录制。",
    );
  }
  if (durationMs > MAX_AUDIO_DURATION_MS + DURATION_CONTAINER_TOLERANCE_MS) {
    throw new ApiError(413, "每次录音最长 30 秒，请缩短后重试。");
  }

  return {
    dataUrl: `data:${resolved.canonical};base64,${base64}`,
    durationMs,
    fingerprint: audioFingerprint(bytes),
    mimeType: resolved.canonical,
    sizeBytes: bytes.byteLength,
  };
}

async function readProviderJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PROVIDER_RESPONSE_LIMIT_BYTES
  ) {
    throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > PROVIDER_RESPONSE_LIMIT_BYTES) {
    throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
  }
}

function extractTranscript(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;

  // Deliberately read content only. Qwen-ASR may return language/emotion
  // annotations, but they are neither reliable risk signals nor needed here.
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  const cleaned = content.replaceAll(String.fromCharCode(0), "").trim();
  if (!cleaned) return null;
  const characters = Array.from(cleaned);
  if (characters.length > TRANSCRIPT_LIMIT_CHARACTERS) return null;
  return characters.join("");
}

function extractProviderDurationSeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const seconds = (usage as { seconds?: unknown }).seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : null;
}

export async function transcribeWithQwen(
  audio: ValidatedAudio,
  beforeProviderRequest?: () => void,
): Promise<string> {
  const config = resolveQwenConfig("asr");
  if (!config) {
    throw new ApiError(
      503,
      "语音转文字尚未配置，请先使用文字输入或联系项目管理员。",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_ASR_TIMEOUT_MS);
  try {
    beforeProviderRequest?.();
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: audio.dataUrl },
              },
            ],
          },
        ],
        stream: false,
        asr_options: { enable_itn: false },
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
    }
    const providerPayload = await readProviderJson(response);
    const providerSeconds = extractProviderDurationSeconds(providerPayload);
    if (providerSeconds === null) {
      throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
    }
    if (providerSeconds > MAX_AUDIO_DURATION_MS / 1_000) {
      throw new ApiError(413, "每次录音最长 30 秒，请缩短后重试。");
    }
    const transcript = extractTranscript(providerPayload);
    if (!transcript) {
      throw new ApiError(422, "没有听清这段录音，请靠近麦克风再试一次。");
    }
    return transcript;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "语音识别超时了，请缩短录音后重试。");
    }
    throw new ApiError(502, "语音转文字暂时不可用，请稍后再试。");
  } finally {
    clearTimeout(timeout);
  }
}
