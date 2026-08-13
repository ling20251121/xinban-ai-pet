import type { SessionUser } from "@/lib/auth";
import { prepareStudentText } from "@/lib/content-safety";
import { ApiError } from "@/lib/http";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";
import { resolveQwenConfig } from "@/lib/qwen";
import { getRuntimeEnv } from "@/db";
import { getSystemDatabase } from "@/lib/system-db";

const ANALYSIS_INTERVAL_TURNS = 3;
const ANALYSIS_WINDOW_STUDENT_TURNS = 6;
const PROVIDER_RESPONSE_LIMIT_BYTES = 32_768;
const ANALYZER_VERSION = "conversation-cue-v1";
const PROMPT_VERSION = "conversation-cue-prompt-v1";

const OBSERVED_EXPRESSIONS = ["positive", "neutral", "mixed", "distress", "unclear"] as const;
const THEMES = [
  "school_pressure", "peer_relationship", "family_relationship", "loneliness",
  "anger", "loss", "sleep_or_fatigue", "other",
] as const;
const FOLLOW_UP = ["none", "routine_check_in", "timely_check_in"] as const;
const TRENDS = ["not_enough_data", "stable", "easing", "intensifying", "unclear"] as const;
const CONFIDENCE = ["low", "medium", "high"] as const;
const BASIS = [
  "explicit_support_seeking", "repeated_distress_expression", "change_from_recent_turns",
  "prolonged_session", "unclear_language",
] as const;

export type ObservedExpression = typeof OBSERVED_EXPRESSIONS[number];
export type ConversationTheme = typeof THEMES[number];
export type FollowUp = typeof FOLLOW_UP[number];
export type ConversationTrend = typeof TRENDS[number];
export type CueConfidence = typeof CONFIDENCE[number];
export type CueBasis = typeof BASIS[number];
export type ConversationCueStatus = "new" | "acknowledged" | "resolved" | "dismissed_inaccurate";

export interface ConversationCueAnalysis {
  observedExpression: ObservedExpression;
  themes: ConversationTheme[];
  followUp: FollowUp;
  trend: ConversationTrend;
  confidence: CueConfidence;
  basis: CueBasis[];
}

interface CueRow {
  id: string;
  conversation_id: string;
  window_turn: number;
  observed_expression: ObservedExpression;
  themes_json: string;
  follow_up: Exclude<FollowUp, "none">;
  trend: ConversationTrend;
  confidence: CueConfidence;
  basis_json: string;
  analyzer_version: string;
  prompt_version: string;
  model: string;
  status: ConversationCueStatus;
  assigned_teacher_user_id: string | null;
  student_id: string;
  student_username: string;
  class_id: string;
  class_name: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  dismissed_at: string | null;
}

const CUE_SELECT = `SELECT q.id,q.conversation_id,q.window_turn,q.observed_expression,
  q.themes_json,q.follow_up,q.trend,q.confidence,q.basis_json,q.analyzer_version,
  q.prompt_version,q.model,q.status,q.assigned_teacher_user_id,
  u.id student_id,u.username student_username,c.id class_id,c.name class_name,
  q.created_at,q.acknowledged_at,q.resolved_at,q.dismissed_at
  FROM conversation_cues q JOIN app_users u ON u.id=q.user_id
  JOIN school_classes c ON c.id=q.class_id`;

const SYSTEM_PROMPT = `You are a conservative school wellbeing cue classifier. The inputs are de-identified snippets from ordinary student-AI conversation. Return exactly one JSON object with exactly these six keys and no others: observedExpression, themes, followUp, trend, confidence, basis. observedExpression must be one of positive|neutral|mixed|distress|unclear. themes must contain at most two unique values from school_pressure|peer_relationship|family_relationship|loneliness|anger|loss|sleep_or_fatigue|other. followUp must be none|routine_check_in|timely_check_in. trend must be not_enough_data|stable|easing|intensifying|unclear. confidence must be low|medium|high. basis must contain at most three unique values from explicit_support_seeking|repeated_distress_expression|change_from_recent_turns|prolonged_session|unclear_language. This is not a diagnosis, mental-state score, clinical assessment, or proof. When evidence is insufficient, use unclear/not_enough_data/low and followUp none. Never infer a disease, personality, identity, cause, or risk not explicitly supported. A follow-up means an adult should check in and verify; it never means the classifier is correct. Do not reproduce, quote, summarize, or add any free text from the conversation.`;

function exactEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number]) : null;
}

function exactEnumArray<T extends readonly string[]>(value: unknown, allowed: T, max: number): T[number][] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const result: T[number][] = [];
  for (const item of value) {
    const parsed = exactEnum(item, allowed);
    if (!parsed || result.includes(parsed)) return null;
    result.push(parsed);
  }
  return result;
}

export function parseConversationCueAnalysis(value: unknown): ConversationCueAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.join("|") !== ["basis", "confidence", "followUp", "observedExpression", "themes", "trend"].sort().join("|")) return null;
  const observedExpression = exactEnum(object.observedExpression, OBSERVED_EXPRESSIONS);
  const themes = exactEnumArray(object.themes, THEMES, 2);
  const followUp = exactEnum(object.followUp, FOLLOW_UP);
  const trend = exactEnum(object.trend, TRENDS);
  const confidence = exactEnum(object.confidence, CONFIDENCE);
  const basis = exactEnumArray(object.basis, BASIS, 3);
  if (!observedExpression || !themes || !followUp || !trend || !confidence || !basis) return null;
  return { observedExpression, themes, followUp, trend, confidence, basis };
}

async function extractProviderContent(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > PROVIDER_RESPONSE_LIMIT_BYTES) return null;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > PROVIDER_RESPONSE_LIMIT_BYTES) return null;
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return null; }
  if (!envelope || typeof envelope !== "object") return null;
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return null;
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message : null;
  const content = message && typeof message === "object"
    ? (message as { content?: unknown }).content : null;
  if (typeof content !== "string" || content.length > 4_096) return null;
  try { return JSON.parse(content) as unknown; } catch { return null; }
}

export async function analyzeConversationWindow(
  messages: Array<{ content: string }>,
): Promise<{ analysis: ConversationCueAnalysis; model: string } | null> {
  const config = resolveQwenConfig("chat");
  if (!config || messages.length === 0) return null;
  const deidentified = messages.slice(-ANALYSIS_WINDOW_STUDENT_TURNS).map((item, index) => ({
    turn: index + 1,
    text: prepareStudentText(item.content, 1_200),
  }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ studentTurns: deidentified }) },
        ],
        response_format: { type: "json_object" },
        enable_thinking: false,
        temperature: 0,
        stream: false,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const analysis = parseConversationCueAnalysis(await extractProviderContent(response));
    return analysis ? { analysis, model: config.model } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function recentStudentTurns(conversationId: string, userId: string) {
  const database = await getSystemDatabase();
  const result = await database.prepare(`SELECT content FROM (
    SELECT content,created_at,id FROM chat_messages
    WHERE conversation_id=? AND user_id=? AND role='user' AND safety_level='normal'
      AND (?=0 OR synthetic=1) ORDER BY created_at DESC,id DESC LIMIT ?
  ) ORDER BY created_at ASC,id ASC`).bind(
      conversationId, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0,
      ANALYSIS_WINDOW_STUDENT_TURNS,
    ).all<{ content: string }>();
  return result.results;
}

export function shouldAnalyzeConversationTurn(studentTurns: number): boolean {
  return studentTurns > 0 && studentTurns % ANALYSIS_INTERVAL_TURNS === 0;
}

/** The classifier may propose a cue; the server owns the queue threshold. */
export function isQueueableConversationCue(analysis: ConversationCueAnalysis): boolean {
  if (
    analysis.followUp === "none" || analysis.confidence === "low" ||
    analysis.observedExpression === "positive" || analysis.observedExpression === "neutral"
  ) return false;
  if (analysis.followUp === "timely_check_in") {
    return analysis.confidence === "high" && analysis.observedExpression === "distress" &&
      analysis.basis.some((basis) =>
        basis === "repeated_distress_expression" || basis === "change_from_recent_turns" ||
        basis === "explicit_support_seeking",
      );
  }
  return (analysis.confidence === "medium" || analysis.confidence === "high") &&
    (analysis.observedExpression === "mixed" || analysis.observedExpression === "distress" ||
      analysis.observedExpression === "unclear") && analysis.basis.length > 0;
}

export async function saveConversationCue(input: {
  user: SessionUser;
  conversationId: string;
  windowTurn: number;
  analysis: ConversationCueAnalysis;
  model: string;
}): Promise<boolean> {
  if (!input.user.classId || !isQueueableConversationCue(input.analysis)) return false;
  const database = await getSystemDatabase();
  const result = await database.prepare(`INSERT INTO conversation_cues (
    id,conversation_id,user_id,class_id,window_turn,observed_expression,themes_json,
    follow_up,trend,confidence,basis_json,analyzer_version,prompt_version,model,status,
    assigned_teacher_user_id,acknowledged_at,resolved_at,dismissed_at,synthetic,created_at
  ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',NULL,NULL,NULL,NULL,?,?
    WHERE EXISTS (SELECT 1 FROM chat_conversations WHERE id=? AND user_id=? AND class_id=?
      AND student_turns>=? AND (?=0 OR synthetic=1))
    ON CONFLICT (conversation_id,window_turn) DO NOTHING`).bind(
      crypto.randomUUID(), input.conversationId, input.user.id, input.user.classId,
      input.windowTurn, input.analysis.observedExpression, JSON.stringify(input.analysis.themes),
      input.analysis.followUp, input.analysis.trend, input.analysis.confidence,
      JSON.stringify(input.analysis.basis), ANALYZER_VERSION, PROMPT_VERSION, input.model,
      input.user.synthetic ? 1 : 0, new Date().toISOString(),
      input.conversationId, input.user.id, input.user.classId, input.windowTurn,
      input.user.synthetic ? 1 : 0,
    ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

function parseCueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(value)) {
    throw new ApiError(400, "关心线索编号格式不正确。");
  }
  return value;
}

function mapCue(row: CueRow) {
  return {
    id: row.id, conversationId: row.conversation_id, windowTurn: Number(row.window_turn),
    observedExpression: row.observed_expression,
    themes: JSON.parse(row.themes_json) as ConversationTheme[], followUp: row.follow_up,
    trend: row.trend, confidence: row.confidence,
    basis: JSON.parse(row.basis_json) as CueBasis[], analyzerVersion: row.analyzer_version,
    promptVersion: row.prompt_version, model: row.model, status: row.status,
    assignedTeacherUserId: row.assigned_teacher_user_id, studentId: row.student_id,
    studentUsername: row.student_username, classId: row.class_id, className: row.class_name,
    createdAt: row.created_at, acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at, dismissedAt: row.dismissed_at,
  };
}

export async function listConversationCues(teacherId: string, classId: string | null) {
  const database = await getSystemDatabase();
  const sandboxOnly = isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0;
  if (classId) {
    const owned = await database.prepare(
      "SELECT id FROM school_classes WHERE id=? AND teacher_user_id=? AND (?=0 OR synthetic=1)",
    ).bind(classId, teacherId, sandboxOnly).first();
    if (!owned) throw new ApiError(404, "没有找到这个班级。");
  }
  const result = await database.prepare(`${CUE_SELECT}
    WHERE c.teacher_user_id=? AND (? IS NULL OR q.class_id=?)
      AND (?=0 OR (q.synthetic=1 AND u.synthetic=1 AND c.synthetic=1))
    ORDER BY CASE q.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
      CASE q.follow_up WHEN 'timely_check_in' THEN 0 ELSE 1 END,q.created_at DESC LIMIT 100`)
    .bind(teacherId, classId, classId, sandboxOnly).all<CueRow>();
  return result.results.map(mapCue);
}

export async function updateConversationCue(teacher: SessionUser, value: unknown, status: unknown) {
  const id = parseCueId(value);
  if (status !== "acknowledged" && status !== "resolved" && status !== "dismissed_inaccurate") {
    throw new ApiError(400, "关心线索状态不正确。");
  }
  const database = await getSystemDatabase();
  const sandboxOnly = isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0;
  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE conversation_cues SET status=?,
    assigned_teacher_user_id=?,acknowledged_at=CASE WHEN ?='acknowledged' THEN COALESCE(acknowledged_at,?) ELSE acknowledged_at END,
    resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END,
    dismissed_at=CASE WHEN ?='dismissed_inaccurate' THEN ? ELSE dismissed_at END
    WHERE id=? AND ((status='new' AND ? IN ('acknowledged','resolved','dismissed_inaccurate'))
      OR (status='acknowledged' AND ? IN ('resolved','dismissed_inaccurate')))
      AND (?=0 OR synthetic=1) AND class_id IN (SELECT id FROM school_classes
        WHERE teacher_user_id=? AND (?=0 OR synthetic=1))`).bind(
      status, teacher.id, status, now, status, now, status, now, id, status, status,
      sandboxOnly, teacher.id, sandboxOnly,
    ).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new ApiError(404, "没有找到可更新的关心线索。");
  const row = await database.prepare(`${CUE_SELECT} WHERE q.id=? AND c.teacher_user_id=?
    AND (?=0 OR (q.synthetic=1 AND u.synthetic=1 AND c.synthetic=1))`)
    .bind(id, teacher.id, sandboxOnly).first<CueRow>();
  if (!row) throw new ApiError(500, "关心线索更新失败。");
  return mapCue(row);
}
