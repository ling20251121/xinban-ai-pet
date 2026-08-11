import { ApiError } from "./http";

export interface MoodPayload {
  participantCode: string;
  mood: string;
  moodScore: number;
  note: string;
  goal: string;
  wantsSupport: boolean;
}

export interface ChatPayload {
  participantCode: string;
  mood: string;
  message: string;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "请求内容需要是一个 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function cleanText(value: unknown, fieldLabel: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ApiError(400, `${fieldLabel}格式不正确。`);
  }

  const cleaned = value.replaceAll(String.fromCharCode(0), "").trim();
  if (codePointLength(cleaned) > maxLength) {
    throw new ApiError(400, `${fieldLabel}不能超过 ${maxLength} 个字符。`);
  }
  return cleaned;
}

function requiredText(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
): string {
  const cleaned = cleanText(value, fieldLabel, maxLength);
  if (!cleaned) {
    throw new ApiError(400, `${fieldLabel}不能为空。`);
  }
  return cleaned;
}

function optionalText(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
): string {
  if (value === undefined || value === null) return "";
  return cleanText(value, fieldLabel, maxLength);
}

export function normalizeParticipantCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "请输入匿名编号。");
  }

  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const length = codePointLength(normalized);
  if (length < 4 || length > 64) {
    throw new ApiError(400, "匿名编号需要 4–64 个字符。");
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(normalized)) {
    throw new ApiError(400, "匿名编号只能包含文字、数字、短横线或下划线。");
  }
  return normalized;
}

export function parseMoodPayload(value: unknown): MoodPayload {
  const body = asObject(value);
  const participantCode = normalizeParticipantCode(body.participantCode);
  const mood = requiredText(body.mood, "心情", 24);
  const score = body.moodScore;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 5) {
    throw new ApiError(400, "心情分数需要是 0–5 的整数，其中 0 表示“说不清”。");
  }

  let wantsSupport = false;
  if (body.wantsSupport !== undefined) {
    if (typeof body.wantsSupport !== "boolean") {
      throw new ApiError(400, "支持请求格式不正确。");
    }
    wantsSupport = body.wantsSupport;
  }

  return {
    participantCode,
    mood,
    moodScore: score,
    note: optionalText(body.note, "心情小记", 600),
    goal: optionalText(body.goal, "明日小目标", 300),
    wantsSupport,
  };
}

export function parseChatPayload(value: unknown): ChatPayload {
  const body = asObject(value);
  return {
    participantCode: normalizeParticipantCode(body.participantCode),
    mood: optionalText(body.mood, "心情", 24),
    message: requiredText(body.message, "想说的话", 1_200),
  };
}

export function parseOptionalEntryId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = requiredText(value, "记录编号", 64);
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    throw new ApiError(400, "记录编号格式不正确。");
  }
  return id;
}

export function parseLimit(value: string | null): number {
  if (value === null || value === "") return 30;
  if (!/^\d{1,3}$/.test(value)) {
    throw new ApiError(400, "记录数量格式不正确。");
  }
  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw new ApiError(400, "每次可以读取 1–100 条记录。");
  }
  return limit;
}

export function parseDays(value: string | null): number {
  if (value === null || value === "") return 7;
  if (!/^\d{1,2}$/.test(value)) {
    throw new ApiError(400, "统计天数格式不正确。");
  }
  const days = Number(value);
  if (days < 1 || days > 90) {
    throw new ApiError(400, "统计范围需要在 1–90 天之间。");
  }
  return days;
}
