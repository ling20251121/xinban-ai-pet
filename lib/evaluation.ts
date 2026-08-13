import { getRuntimeEnv } from "@/db";
import { consumeAuthRateLimit } from "@/lib/auth";
import {
  ACTION_LABELS,
  CONTEXT_JUDGMENT_LABELS,
  CONTEXT_JUDGMENT_OPTIONS,
  CRITICAL_HARM_FLAG_LABELS,
  CRITICAL_HARM_FLAG_OPTIONS,
  DIALOGUE_EVALUATION_CASE_IDS,
  DIALOGUE_PACK_VERSION,
  DIALOGUE_PROMPT_VERSION,
  EVIDENCE_SOURCE_LABELS,
  EVIDENCE_SOURCE_OPTIONS,
  EXPERT_REFERENCE_EVIDENCE_OPTIONS,
  FROZEN_OUTPUT_VERSION,
  PRIVACY_CHOICE_LABELS,
  PRIVACY_CHOICE_OPTIONS,
  PROMPT_VERSION,
  REASON_CODE_LABELS,
  REASON_CODE_OPTIONS,
  SCENARIO_PACK_VERSION,
  SYNTHETIC_EVALUATION_CASES,
  type EvaluationAction,
  isDialogueEvaluationCase,
  publicScenario,
} from "@/lib/evaluation-cases";
import { ApiError } from "@/lib/http";
import { getSystemDatabase } from "@/lib/system-db";
import type { SystemDatabase } from "@/lib/database-types";

export const EVALUATION_CONSENT_VERSION = "adult-evaluation-dialogue-2026-08-v2";
export const STUDENT_UI_ITEMS_VERSION = "student-ui-formative-4-v1";
const COOKIE = "xinban_evaluation";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

type EvaluatorRole = "teacher" | "expert";
type ExperienceBand = "0-2" | "3-5" | "6-10" | "11+";

interface EvaluationRuntime {
  EVALUATION_TEACHER_CODES?: string;
  EVALUATION_EXPERT_CODES?: string;
  RESEARCH_ACCESS_KEY?: string;
  EVALUATION_RESEARCHER_NAME?: string;
  EVALUATION_CONTACT?: string;
  EVALUATION_ETHICS_STATUS?: string;
  EVALUATION_RETENTION_DAYS?: string;
  EVALUATION_DATA_HOST?: string;
}

export interface ParticipantRow {
  id: string;
  participant_code: string;
  role: EvaluatorRole;
  experience_band: ExperienceBand;
  sequence_group: "A" | "B";
  consent_version: string;
  quote_consent: number;
  started_at: string;
  submitted_at: string | null;
  withdrawn_at: string | null;
  data_deleted_at: string | null;
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS evaluation_participants (
    id TEXT PRIMARY KEY, participant_code TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('teacher','expert')),
    experience_band TEXT NOT NULL CHECK (experience_band IN ('0-2','3-5','6-10','11+')),
    sequence_group TEXT NOT NULL CHECK (sequence_group IN ('A','B')),
    consent_version TEXT NOT NULL, quote_consent INTEGER NOT NULL DEFAULT 0 CHECK (quote_consent IN (0,1)),
    scenario_pack_version TEXT NOT NULL,
    output_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    access_code_hash TEXT NOT NULL UNIQUE, session_token_hash TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, submitted_at TEXT,
    withdrawn_at TEXT, data_deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS evaluation_used_codes (
    access_code_hash TEXT PRIMARY KEY, used_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evaluation_expert_references (
    participant_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
    reference_action TEXT NOT NULL, reference_evidence_json TEXT NOT NULL,
    reference_context_judgment TEXT NOT NULL, reference_reason_codes_json TEXT NOT NULL,
    reference_privacy_choice TEXT NOT NULL,
    reference_confidence INTEGER NOT NULL CHECK (reference_confidence BETWEEN 1 AND 5),
    frozen_at TEXT NOT NULL,
    PRIMARY KEY(participant_id,scenario_id)
  )`,
  `CREATE TABLE IF NOT EXISTS evaluation_scenario_responses (
    id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
    study_condition TEXT NOT NULL CHECK (study_condition IN ('dashboard_only','dashboard_cccr','expert_blind')),
    scenario_pack_version TEXT NOT NULL, output_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
    chosen_action TEXT NOT NULL,
    evidence_selected_json TEXT, context_judgment TEXT, reason_codes_json TEXT,
    privacy_choice TEXT, confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
    quality_json TEXT NOT NULL DEFAULT '{}',
    must_revise INTEGER CHECK (must_revise IS NULL OR must_revise IN (0,1)),
    critical_harm_flags_json TEXT,
    decision_time_ms INTEGER NOT NULL CHECK (decision_time_ms BETWEEN 250 AND 3600000),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(participant_id, scenario_id)
  )`,
  `CREATE TABLE IF NOT EXISTS evaluation_surveys (
    participant_id TEXT PRIMARY KEY, sus_json TEXT NOT NULL,
    trust_score INTEGER NOT NULL CHECK (trust_score BETWEEN 1 AND 5),
    appropriateness_score INTEGER NOT NULL CHECK (appropriateness_score BETWEEN 1 AND 5),
    usability_score INTEGER NOT NULL CHECK (usability_score BETWEEN 1 AND 5),
    safety_boundary_score INTEGER NOT NULL CHECK (safety_boundary_score BETWEEN 1 AND 5),
    student_ui_presentation_fidelity_score INTEGER CHECK (student_ui_presentation_fidelity_score IS NULL OR student_ui_presentation_fidelity_score BETWEEN 1 AND 5),
    student_ui_potential_usefulness_score INTEGER CHECK (student_ui_potential_usefulness_score IS NULL OR student_ui_potential_usefulness_score BETWEEN 1 AND 5),
    student_ui_perceived_comprehensibility_score INTEGER CHECK (student_ui_perceived_comprehensibility_score IS NULL OR student_ui_perceived_comprehensibility_score BETWEEN 1 AND 5),
    student_ui_age_context_fit_score INTEGER CHECK (student_ui_age_context_fit_score IS NULL OR student_ui_age_context_fit_score BETWEEN 1 AND 5),
    student_ui_items_version TEXT,
    workload_score INTEGER NOT NULL CHECK (workload_score BETWEEN 0 AND 100),
    feedback TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evaluation_dialogues (
    participant_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
    dialogue_pack_version TEXT NOT NULL, dialogue_prompt_version TEXT NOT NULL,
    model_id TEXT, status TEXT NOT NULL DEFAULT 'ready'
      CHECK (status IN ('ready','in_flight','completed')),
    next_turn INTEGER NOT NULL DEFAULT 0 CHECK (next_turn BETWEEN 0 AND 3),
    lease_token TEXT, lease_started_at TEXT,
    transcript_json TEXT NOT NULL DEFAULT '[]', provider_metadata_json TEXT NOT NULL DEFAULT '[]',
    total_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
    safety_ended INTEGER NOT NULL DEFAULT 0 CHECK (safety_ended IN (0,1)),
    rating_json TEXT, rating_token TEXT,
    must_revise INTEGER CHECK (must_revise IS NULL OR must_revise IN (0,1)),
    harm_flags_json TEXT, started_at TEXT, completed_at TEXT, rated_at TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY(participant_id,scenario_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_eval_response_participant ON evaluation_scenario_responses (participant_id,scenario_id)",
  "CREATE INDEX IF NOT EXISTS idx_eval_participant_role ON evaluation_participants (role,submitted_at)",
  "CREATE INDEX IF NOT EXISTS idx_eval_dialogue_participant ON evaluation_dialogues (participant_id,scenario_id)",
] as const;

const ready = new WeakMap<object, Promise<void>>();

export async function evaluationDatabase(): Promise<SystemDatabase> {
  const value = await getSystemDatabase();
  // PostgreSQL schema changes are applied only by the reviewed 0001/0002
  // administrative migrations. The restricted application role must never
  // need CREATE privileges at request time.
  if (value.dialect === "postgres") return value;
  let initializing = ready.get(value as object);
  if (!initializing) {
    initializing = value.batch(TABLES.map((sql) => value.prepare(sql))).then(() => undefined);
    ready.set(value as object, initializing);
  }
  try { await initializing; } catch (error) { ready.delete(value as object); throw error; }
  return value;
}

function runtime(): EvaluationRuntime {
  const cloud = getRuntimeEnv() as EvaluationRuntime;
  if (typeof process === "undefined") return cloud;
  return {
    EVALUATION_TEACHER_CODES: cloud.EVALUATION_TEACHER_CODES ?? process.env.EVALUATION_TEACHER_CODES,
    EVALUATION_EXPERT_CODES: cloud.EVALUATION_EXPERT_CODES ?? process.env.EVALUATION_EXPERT_CODES,
    RESEARCH_ACCESS_KEY: cloud.RESEARCH_ACCESS_KEY ?? process.env.RESEARCH_ACCESS_KEY,
    EVALUATION_RESEARCHER_NAME: cloud.EVALUATION_RESEARCHER_NAME ?? process.env.EVALUATION_RESEARCHER_NAME,
    EVALUATION_CONTACT: cloud.EVALUATION_CONTACT ?? process.env.EVALUATION_CONTACT,
    EVALUATION_ETHICS_STATUS: cloud.EVALUATION_ETHICS_STATUS ?? process.env.EVALUATION_ETHICS_STATUS,
    EVALUATION_RETENTION_DAYS: cloud.EVALUATION_RETENTION_DAYS ?? process.env.EVALUATION_RETENTION_DAYS,
    EVALUATION_DATA_HOST: cloud.EVALUATION_DATA_HOST ?? process.env.EVALUATION_DATA_HOST,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hash(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function token(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

function cookieToken(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...values] = part.trim().split("=");
    const value = values.join("=");
    if (name === COOKIE && /^[A-Za-z0-9_-]{43}$/u.test(value)) return value;
  }
  return null;
}

export function evaluationCookie(value: string): string {
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearEvaluationCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function roleValue(value: unknown): EvaluatorRole {
  if (value !== "teacher" && value !== "expert") throw new ApiError(400, "请选择教师或专家评估者角色。");
  return value;
}

function experienceValue(value: unknown): ExperienceBand {
  if (!["0-2", "3-5", "6-10", "11+"].includes(String(value))) {
    throw new ApiError(400, "请选择工作经验区间。");
  }
  return value as ExperienceBand;
}

function actionValue(value: unknown): EvaluationAction {
  if (!["monitor", "brief_check_in", "counselor_consult", "referral"].includes(String(value))) {
    throw new ApiError(400, "请选择一项行动。");
  }
  return value as EvaluationAction;
}

type EvidenceSource = (typeof EVIDENCE_SOURCE_OPTIONS)[number];
type ContextJudgment = (typeof CONTEXT_JUDGMENT_OPTIONS)[number];
type ReasonCode = (typeof REASON_CODE_OPTIONS)[number];
type PrivacyChoice = (typeof PRIVACY_CHOICE_OPTIONS)[number];
type CriticalHarmFlag = (typeof CRITICAL_HARM_FLAG_OPTIONS)[number];

function enumValue<T extends string>(value: unknown, values: readonly T[], message: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new ApiError(400, message);
  return value as T;
}

function enumList<T extends string>(
  value: unknown,
  values: readonly T[],
  message: string,
  maximum = values.length,
): T[] {
  if (!Array.isArray(value)) throw new ApiError(400, message);
  const unique = [...new Set(value)];
  if (unique.length < 1 || unique.length > maximum || unique.some((item) => typeof item !== "string" || !values.includes(item as T))) {
    throw new ApiError(400, message);
  }
  return values.filter((item) => unique.includes(item)) as T[];
}

function evidenceList(value: unknown, expertReference = false): EvidenceSource[] {
  return enumList(
    value,
    expertReference ? EXPERT_REFERENCE_EVIDENCE_OPTIONS : EVIDENCE_SOURCE_OPTIONS,
    "请从固定合成证据来源中至少选择一项。",
  ) as EvidenceSource[];
}

function contextJudgment(value: unknown): ContextJudgment {
  return enumValue(value, CONTEXT_JUDGMENT_OPTIONS, "请选择固定的情境判断选项。");
}

function reasonCodes(value: unknown): ReasonCode[] {
  return enumList(value, REASON_CODE_OPTIONS, "请至少选择一项固定判断理由。", 4);
}

function privacyChoice(value: unknown): PrivacyChoice {
  return enumValue(value, PRIVACY_CHOICE_OPTIONS, "请选择最小必要的隐私处理范围。");
}

function harmFlags(value: unknown): CriticalHarmFlag[] {
  const flags = enumList(value, CRITICAL_HARM_FLAG_OPTIONS, "请完成关键伤害风险选择。", 7);
  if (flags.includes("none") && flags.length !== 1) throw new ApiError(400, "“未发现风险”不能与其他风险同时选择。");
  return flags;
}

function boundedText(value: unknown, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (!required) return "";
    throw new ApiError(400, "请完成必填说明。");
  }
  const text = value.replaceAll(String.fromCharCode(0), "").trim();
  if ((required && text.length < 2) || Array.from(text).length > max) {
    throw new ApiError(400, `说明需为 ${required ? "2–" : "0–"}${max} 个字符。`);
  }
  if (/1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|我叫.{1,12}|(?:小学|中学|学校)名称/u.test(text)) {
    throw new ApiError(400, "请删除姓名、电话、邮箱或学校名称后再提交。");
  }
  return text;
}

function configuredCodes(role: EvaluatorRole): string[] {
  const source = role === "teacher" ? runtime().EVALUATION_TEACHER_CODES : runtime().EVALUATION_EXPERT_CODES;
  return (source ?? "").split(",").map((value) => value.trim()).filter((value) => value.length >= 8);
}

export function publicEvaluationInformation() {
  const values = runtime();
  const researcher = values.EVALUATION_RESEARCHER_NAME?.trim() ?? "";
  const contact = values.EVALUATION_CONTACT?.trim() ?? "";
  const ethicsStatus = values.EVALUATION_ETHICS_STATUS?.trim() ?? "";
  const storage = values.EVALUATION_DATA_HOST?.trim() ?? "";
  const retentionDays = Number(values.EVALUATION_RETENTION_DAYS);
  if (researcher.length < 2 || contact.length < 5 || ethicsStatus.length < 2 || storage.length < 5 || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new ApiError(503, "成人评估研究说明尚未完整配置，暂不开放数据收集。");
  }
  // Approval records and researcher identity stay in the controlled study file.
  // They are deliberately not returned by the public API during double-blind review.
  return { retentionDays, purpose: "评估心伴 AI-Pet 在固定合成学生情境中的多轮对话质量、情绪表达与梳理支持的适切性、学生端只读原型、教师决策支持和安全边界", duration: "约 30–45 分钟", compensation: "无报酬", risks: "需要查看并评价实际生成的 AI 回应和本地安全接管结果，可能产生疲劳，或因阅读危机类合成情境感到不适；可跳出页面或撤回", benefits: "不保证直接获益；反馈将用于改进研究原型", storage, withdrawalBoundary: "在研究团队执行不可逆匿名化或汇总前，可凭当前评估会话撤回并删除" };
}

export async function startEvaluation(request: Request, input: {
  role?: unknown; experienceBand?: unknown; accessCode?: unknown;
  adultConfirmed?: unknown; syntheticOnlyConfirmed?: unknown;
  dataUseConfirmed?: unknown; voluntaryConfirmed?: unknown; quoteConsent?: unknown;
}): Promise<{ participant: ParticipantRow; sessionToken: string; study: ReturnType<typeof publicEvaluationInformation> }> {
  if (![input.adultConfirmed, input.syntheticOnlyConfirmed, input.dataUseConfirmed, input.voluntaryConfirmed].every((value) => value === true)) {
    throw new ApiError(400, "请分别确认成年、合成情境、数据用途和自愿参与四项说明。");
  }
  const study = publicEvaluationInformation();
  const experienceBand = experienceValue(input.experienceBand);
  const supplied = typeof input.accessCode === "string" ? input.accessCode.trim() : "";
  // One fixed bucket limits code spraying even when an attacker changes the
  // guessed code on every request. The existing helper also includes the
  // trusted client-IP signal in the bucket key.
  await consumeAuthRateLimit(request, "evaluation-access", "invite-code", 8, 15 * 60);
  const matchedRoles = (["teacher", "expert"] as const).filter((candidate) => configuredCodes(candidate).includes(supplied));
  if (matchedRoles.length !== 1) throw new ApiError(403, "评估访问码无效或配置冲突；请向研究者领取对应角色的一次性访问码。");
  const role = matchedRoles[0];
  if (input.role != null && roleValue(input.role) !== role) throw new ApiError(403, "评估者角色由访问码决定，不能手动更改。");
  const accessHash = await hash(`${role}:${supplied}`);
  const db = await evaluationDatabase();
  const alreadyUsed = await db.prepare("SELECT access_code_hash FROM evaluation_used_codes WHERE access_code_hash=?").bind(accessHash).first();
  if (alreadyUsed) throw new ApiError(409, "这个一次性访问码已使用；请向研究者领取新码。已开始的评估可在本设备继续。");

  const id = crypto.randomUUID();
  const prefix = role === "teacher" ? "T" : "E";
  const participantCode = `${prefix}-${token(5).slice(0, 7).toUpperCase()}`;
  const sequenceGroup = (new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(id)))[0] & 1) === 0 ? "A" : "B";
  const sessionToken = token();
  const sessionHash = await hash(sessionToken);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO evaluation_used_codes (access_code_hash,used_at) VALUES (?,?)").bind(accessHash, now),
    db.prepare(`INSERT INTO evaluation_participants
    (id,participant_code,role,experience_band,sequence_group,consent_version,
      quote_consent,scenario_pack_version,output_version,prompt_version,access_code_hash,session_token_hash,
      started_at,last_seen_at,submitted_at,withdrawn_at,data_deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`)
    .bind(id, participantCode, role, experienceBand, sequenceGroup, EVALUATION_CONSENT_VERSION,
      input.quoteConsent === true ? 1 : 0, SCENARIO_PACK_VERSION, FROZEN_OUTPUT_VERSION, PROMPT_VERSION, accessHash, sessionHash, now, now),
  ]);
  return { participant: { id, participant_code: participantCode, role, experience_band: experienceBand, sequence_group: sequenceGroup, consent_version: EVALUATION_CONSENT_VERSION, quote_consent: input.quoteConsent === true ? 1 : 0, started_at: now, submitted_at: null, withdrawn_at: null, data_deleted_at: null }, sessionToken, study };
}

export async function requireEvaluation(request: Request, updateLastSeen = true): Promise<ParticipantRow> {
  const raw = cookieToken(request);
  if (!raw) throw new ApiError(401, "请使用评估访问码进入。");
  const db = await evaluationDatabase();
  const row = await db.prepare(`SELECT id,participant_code,role,experience_band,sequence_group,
      consent_version,quote_consent,started_at,submitted_at,withdrawn_at,data_deleted_at
    FROM evaluation_participants WHERE session_token_hash=?`).bind(await hash(raw)).first<ParticipantRow>();
  if (!row || row.withdrawn_at || row.data_deleted_at) throw new ApiError(401, "评估会话无效或数据已撤回。");
  if (updateLastSeen) {
    await db.prepare("UPDATE evaluation_participants SET last_seen_at=? WHERE id=?").bind(new Date().toISOString(), row.id).run();
  }
  return row;
}

export function requireCurrentEvaluationConsent(participant: ParticipantRow): void {
  if (participant.consent_version !== EVALUATION_CONSENT_VERSION) {
    throw new ApiError(409, "评估说明已更新并新增多轮 Qwen 对话保存与评价。旧会话不能继续写入；请联系研究者领取新版访问码。你仍可撤回旧数据。");
  }
}

export function conditionFor(sequence: "A" | "B", order: number): "dashboard_only" | "dashboard_cccr" {
  return (sequence === "A") === (order % 2 === 1) ? "dashboard_cccr" : "dashboard_only";
}

export async function evaluationState(request: Request) {
  const participant = await requireEvaluation(request);
  const db = await evaluationDatabase();
  const responses = await db.prepare(`SELECT scenario_id,study_condition,chosen_action,
      evidence_selected_json,context_judgment,reason_codes_json,privacy_choice,confidence,
      quality_json,must_revise,critical_harm_flags_json,decision_time_ms,updated_at
    FROM evaluation_scenario_responses WHERE participant_id=? ORDER BY scenario_id`).bind(participant.id).all();
  const done = new Set(responses.results.map((row) => String((row as { scenario_id: string }).scenario_id)));
  const references = participant.role === "expert"
    ? await db.prepare(`SELECT scenario_id,reference_action,reference_evidence_json,
        reference_context_judgment,reference_reason_codes_json,reference_privacy_choice,
        reference_confidence,frozen_at FROM evaluation_expert_references WHERE participant_id=?`)
      .bind(participant.id).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const referenceMap = new Map(references.results.map((row) => [String(row.scenario_id), row]));
  const dialogueRows = await db.prepare(`SELECT scenario_id,dialogue_pack_version,dialogue_prompt_version,
      model_id,status,next_turn,transcript_json,total_latency_ms,safety_ended,rating_json,
      must_revise,harm_flags_json,completed_at,rated_at
    FROM evaluation_dialogues WHERE participant_id=?`).bind(participant.id).all<Record<string, unknown>>();
  const dialogueMap = new Map(dialogueRows.results.map((row) => [String(row.scenario_id), row]));
  const scenarios = SYNTHETIC_EVALUATION_CASES.map((scenario) => ({
    ...publicScenario(scenario, participant.role === "teacher" || referenceMap.has(scenario.id)),
    condition: participant.role === "expert" ? "expert_blind" : conditionFor(participant.sequence_group, scenario.order),
    completed: done.has(scenario.id),
    dialogueRequired: isDialogueEvaluationCase(scenario.id),
    dialogue: isDialogueEvaluationCase(scenario.id) ? (() => {
      const row = dialogueMap.get(scenario.id);
      const transcript = row ? JSON.parse(String(row.transcript_json ?? "[]")) : [];
      return {
        messages: transcript,
        nextTurn: Number(row?.next_turn ?? 0),
        completed: row?.status === "completed",
        sealed: Boolean(row?.rated_at),
        modelId: row?.model_id ?? null,
        dialoguePackVersion: String(row?.dialogue_pack_version ?? DIALOGUE_PACK_VERSION),
        promptVersion: String(row?.dialogue_prompt_version ?? DIALOGUE_PROMPT_VERSION),
        totalLatencyMs: Number(row?.total_latency_ms ?? 0),
        safetyEnded: Boolean(row?.safety_ended),
        rating: row?.rating_json ? JSON.parse(String(row.rating_json)) : null,
        mustRevise: row?.must_revise == null ? null : Boolean(row.must_revise),
        harmFlags: row?.harm_flags_json ? JSON.parse(String(row.harm_flags_json)) : null,
      };
    })() : null,
    expertReference: referenceMap.has(scenario.id) ? {
      action: referenceMap.get(scenario.id)?.reference_action,
      evidenceSelected: JSON.parse(String(referenceMap.get(scenario.id)?.reference_evidence_json ?? "[]")),
      contextJudgment: referenceMap.get(scenario.id)?.reference_context_judgment,
      reasonCodes: JSON.parse(String(referenceMap.get(scenario.id)?.reference_reason_codes_json ?? "[]")),
      privacyChoice: referenceMap.get(scenario.id)?.reference_privacy_choice,
      confidence: referenceMap.get(scenario.id)?.reference_confidence,
      frozenAt: referenceMap.get(scenario.id)?.frozen_at,
    } : null,
  }));
  return {
    participant: {
      code: participant.participant_code,
      role: participant.role,
      experienceBand: participant.experience_band,
      submitted: Boolean(participant.submitted_at),
      consentCurrent: participant.consent_version === EVALUATION_CONSENT_VERSION,
    },
    versions: { scenarioPack: SCENARIO_PACK_VERSION, output: FROZEN_OUTPUT_VERSION, prompt: PROMPT_VERSION,
      dialoguePack: DIALOGUE_PACK_VERSION, dialoguePrompt: DIALOGUE_PROMPT_VERSION,
      dialogueCases: DIALOGUE_EVALUATION_CASE_IDS },
    scenarios,
    responses: responses.results,
    actionLabels: ACTION_LABELS,
    optionLabels: {
      evidence: EVIDENCE_SOURCE_LABELS,
      context: CONTEXT_JUDGMENT_LABELS,
      reasons: REASON_CODE_LABELS,
      privacy: PRIVACY_CHOICE_LABELS,
      criticalHarm: CRITICAL_HARM_FLAG_LABELS,
    },
    study: publicEvaluationInformation(),
  };
}

export async function freezeExpertReference(request: Request, input: Record<string, unknown>) {
  const participant = await requireEvaluation(request);
  requireCurrentEvaluationConsent(participant);
  if (participant.submitted_at) throw new ApiError(409, "评估已经提交，不能再修改。");
  if (participant.role !== "expert") throw new ApiError(403, "仅专家评估流需要冻结独立参考行动。");
  const scenario = SYNTHETIC_EVALUATION_CASES.find((item) => item.id === input.scenarioId);
  if (!scenario) throw new ApiError(404, "合成案例不存在。");
  const referenceAction = actionValue(input.referenceAction);
  const referenceEvidence = evidenceList(input.referenceEvidence, true);
  const referenceContext = contextJudgment(input.referenceContextJudgment);
  const referenceReasons = reasonCodes(input.referenceReasonCodes);
  const referencePrivacy = privacyChoice(input.referencePrivacyChoice);
  const referenceConfidence = likert(input.referenceConfidence);
  const db = await evaluationDatabase();
  const existing = await db.prepare(`SELECT reference_action,reference_evidence_json,
      reference_context_judgment,reference_reason_codes_json,reference_privacy_choice,reference_confidence
    FROM evaluation_expert_references WHERE participant_id=? AND scenario_id=?`)
    .bind(participant.id, scenario.id).first<Record<string, unknown>>();
  const proposed = [referenceAction, JSON.stringify(referenceEvidence), referenceContext,
    JSON.stringify(referenceReasons), referencePrivacy, referenceConfidence];
  const stored = existing ? [existing.reference_action, existing.reference_evidence_json,
    existing.reference_context_judgment, existing.reference_reason_codes_json,
    existing.reference_privacy_choice, Number(existing.reference_confidence)] : null;
  if (stored && JSON.stringify(stored) !== JSON.stringify(proposed)) {
    throw new ApiError(409, "独立参考判断已经完整冻结，不能在查看 AI 输出后修改。");
  }
  if (!existing) {
    await db.prepare(`INSERT INTO evaluation_expert_references
      (participant_id,scenario_id,reference_action,reference_evidence_json,
       reference_context_judgment,reference_reason_codes_json,reference_privacy_choice,
       reference_confidence,frozen_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(participant.id, scenario.id, ...proposed, new Date().toISOString()).run();
  }
  return { frozen: true, scenarioId: scenario.id, frozenOutput: scenario.frozenOutput };
}

export async function saveScenarioResponse(request: Request, input: Record<string, unknown>) {
  const participant = await requireEvaluation(request);
  requireCurrentEvaluationConsent(participant);
  if (participant.submitted_at) throw new ApiError(409, "评估已经提交，不能再修改。");
  const scenario = SYNTHETIC_EVALUATION_CASES.find((item) => item.id === input.scenarioId);
  if (!scenario) throw new ApiError(404, "合成案例不存在。");
  if ("contextCheck" in input || "rationale" in input) {
    throw new ApiError(400, "正式案例不接收自由文本判断；请使用固定证据、理由和隐私选项。");
  }
  const chosenAction = actionValue(input.chosenAction);
  const db = await evaluationDatabase();
  const expertReference = participant.role === "expert"
    ? await db.prepare("SELECT reference_action FROM evaluation_expert_references WHERE participant_id=? AND scenario_id=?").bind(participant.id, scenario.id).first<{ reference_action: string }>()
    : null;
  if (participant.role === "expert" && !expertReference) throw new ApiError(409, "请先冻结独立参考行动，再评价 AI 输出。");
  let dialogueRating: Record<string, number> | null = null;
  let dialogueMustRevise: number | null = null;
  let dialogueHarmFlags: CriticalHarmFlag[] | null = null;
  if (isDialogueEvaluationCase(scenario.id)) {
    const dialogue = await db.prepare(`SELECT status,rated_at FROM evaluation_dialogues
      WHERE participant_id=? AND scenario_id=?`).bind(participant.id, scenario.id)
      .first<{ status: string; rated_at: string | null }>();
    if (!dialogue || dialogue.status !== "completed") {
      throw new ApiError(409, "请先完成本案例的固定合成 AI-Pet 多轮对话，再提交案例评价。");
    }
    const dialogueQualityKeys = ["warmth", "relevance", "continuity", "expressionSupport",
      "emotionClarification", "ageAppropriate", "boundaryAndHumanSupport"] as const;
    dialogueRating = Object.fromEntries(dialogueQualityKeys.map((key) => [
      key,
      likert((input.dialogueQuality as Record<string, unknown> | undefined)?.[key]),
    ]));
    if (typeof input.dialogueMustRevise !== "boolean") {
      throw new ApiError(400, "请选择该多轮对话是否必须修改。");
    }
    dialogueMustRevise = input.dialogueMustRevise ? 1 : 0;
    dialogueHarmFlags = harmFlags(input.dialogueHarmFlags);
    if (dialogue.rated_at) throw new ApiError(409, "该多轮对话评价已经封存，不能修改。");
  }
  const condition = participant.role === "expert" ? "expert_blind" : conditionFor(participant.sequence_group, scenario.order);
  const time = Number(input.decisionTimeMs);
  if (!Number.isInteger(time) || time < 250 || time > 3_600_000) throw new ApiError(400, "案例用时无效。");
  const qualityKeys = ["warmth", "relevance", "ageAppropriate", "nonDiagnostic", "evidence", "privacySafety", "actionProportionality"] as const;
  const quality = participant.role === "expert"
    ? Object.fromEntries(qualityKeys.map((key) => [key, likert((input.quality as Record<string, unknown> | undefined)?.[key])]))
    : {};
  const evidence = participant.role === "teacher" ? evidenceList(input.evidenceSelected) : null;
  const context = participant.role === "teacher" ? contextJudgment(input.contextJudgment) : null;
  const reasons = participant.role === "teacher" ? reasonCodes(input.reasonCodes) : null;
  const privacy = participant.role === "teacher" ? privacyChoice(input.privacyChoice) : null;
  const confidence = participant.role === "teacher" ? likert(input.confidence) : null;
  const mustRevise = participant.role === "expert"
    ? (typeof input.mustRevise === "boolean" ? (input.mustRevise ? 1 : 0) : null)
    : null;
  if (participant.role === "expert" && mustRevise === null) throw new ApiError(400, "请选择冻结 AI 输出是否必须修改。");
  const criticalFlags = participant.role === "expert" ? harmFlags(input.criticalHarmFlags) : null;
  const now = new Date().toISOString();
  const responseStatement = db.prepare(`INSERT INTO evaluation_scenario_responses
    (id,participant_id,scenario_id,study_condition,scenario_pack_version,output_version,prompt_version,
      chosen_action,evidence_selected_json,context_judgment,reason_codes_json,privacy_choice,confidence,
      quality_json,must_revise,critical_harm_flags_json,decision_time_ms,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(participant_id,scenario_id) DO UPDATE SET
      chosen_action=excluded.chosen_action,evidence_selected_json=excluded.evidence_selected_json,
      context_judgment=excluded.context_judgment,reason_codes_json=excluded.reason_codes_json,
      privacy_choice=excluded.privacy_choice,confidence=excluded.confidence,quality_json=excluded.quality_json,
      must_revise=excluded.must_revise,critical_harm_flags_json=excluded.critical_harm_flags_json,
      decision_time_ms=excluded.decision_time_ms,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), participant.id, scenario.id, condition, SCENARIO_PACK_VERSION,
      FROZEN_OUTPUT_VERSION, PROMPT_VERSION, chosenAction, evidence ? JSON.stringify(evidence) : null,
      context, reasons ? JSON.stringify(reasons) : null, privacy, confidence, JSON.stringify(quality),
      mustRevise, criticalFlags ? JSON.stringify(criticalFlags) : null, time, now, now);
  if (isDialogueEvaluationCase(scenario.id)) {
    const ratingToken = crypto.randomUUID();
    const responseFromSealedDialogue = db.prepare(`INSERT INTO evaluation_scenario_responses
      (id,participant_id,scenario_id,study_condition,scenario_pack_version,output_version,prompt_version,
       chosen_action,evidence_selected_json,context_judgment,reason_codes_json,privacy_choice,confidence,
       quality_json,must_revise,critical_harm_flags_json,decision_time_ms,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM evaluation_dialogues
      WHERE participant_id=? AND scenario_id=? AND rating_token=?`)
      .bind(crypto.randomUUID(), participant.id, scenario.id, condition, SCENARIO_PACK_VERSION,
        FROZEN_OUTPUT_VERSION, PROMPT_VERSION, chosenAction, evidence ? JSON.stringify(evidence) : null,
        context, reasons ? JSON.stringify(reasons) : null, privacy, confidence, JSON.stringify(quality),
        mustRevise, criticalFlags ? JSON.stringify(criticalFlags) : null, time, now, now,
        participant.id, scenario.id, ratingToken);
    const results = await db.batch([
      db.prepare(`UPDATE evaluation_dialogues SET rating_json=?,rating_token=?,must_revise=?,
      harm_flags_json=?,rated_at=?,updated_at=? WHERE participant_id=? AND scenario_id=?
      AND status='completed' AND rated_at IS NULL`).bind(
        JSON.stringify(dialogueRating), ratingToken, dialogueMustRevise, JSON.stringify(dialogueHarmFlags),
        now, now, participant.id, scenario.id,
      ),
      responseFromSealedDialogue,
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, "该多轮对话评价已封存或尚未完成。");
    }
  } else {
    await responseStatement.run();
  }
  return { saved: true, scenarioId: scenario.id };
}

function likert(value: unknown): number {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new ApiError(400, "请完成 1–5 分量表。");
  return score;
}

export function calculateSus(items: number[]): number {
  if (items.length !== 10 || items.some((item) => !Number.isInteger(item) || item < 1 || item > 5)) {
    throw new ApiError(400, "请完成 SUS 10 个题目。");
  }
  return items.reduce((sum, item, index) => sum + (index % 2 === 0 ? item - 1 : 5 - item), 0) * 2.5;
}

export async function submitSurvey(request: Request, input: Record<string, unknown>) {
  const participant = await requireEvaluation(request);
  requireCurrentEvaluationConsent(participant);
  if (participant.submitted_at) throw new ApiError(409, "评估已经提交，不能重复提交。");
  const sus = Array.isArray(input.sus) ? input.sus.map(Number) : [];
  calculateSus(sus);
  const db = await evaluationDatabase();
  const completed = await db.prepare("SELECT COUNT(*) count FROM evaluation_scenario_responses WHERE participant_id=?").bind(participant.id).first<{ count: number }>();
  if (Number(completed?.count ?? 0) !== SYNTHETIC_EVALUATION_CASES.length) throw new ApiError(409, "请先完成全部 12 个合成案例。");
  const dialogueCompleted = await db.prepare(`SELECT COUNT(*) count FROM evaluation_dialogues
    WHERE participant_id=? AND status='completed' AND rated_at IS NOT NULL`)
    .bind(participant.id).first<{ count: number }>();
  if (Number(dialogueCompleted?.count ?? 0) !== DIALOGUE_EVALUATION_CASE_IDS.length) {
    throw new ApiError(409, "请先完成并评价 5 个固定合成多轮对话案例。");
  }
  const now = new Date().toISOString();
  const workload = Number(input.workload);
  if (!Number.isInteger(workload) || workload < 0 || workload > 100) throw new ApiError(400, "工作负荷需为 0–100 的整数。");
  const studentUiPresentationFidelity = likert(input.studentUiPresentationFidelity);
  const studentUiPotentialUsefulness = likert(input.studentUiPotentialUsefulness);
  const studentUiPerceivedComprehensibility = likert(input.studentUiPerceivedComprehensibility);
  const studentUiAgeContextFit = likert(input.studentUiAgeContextFit);
  await db.prepare(`INSERT INTO evaluation_surveys
    (participant_id,sus_json,trust_score,appropriateness_score,usability_score,safety_boundary_score,
      student_ui_presentation_fidelity_score,student_ui_potential_usefulness_score,
      student_ui_perceived_comprehensibility_score,student_ui_age_context_fit_score,student_ui_items_version,
      workload_score,feedback,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(participant_id) DO UPDATE SET
      sus_json=excluded.sus_json,trust_score=excluded.trust_score,
      appropriateness_score=excluded.appropriateness_score,usability_score=excluded.usability_score,
      safety_boundary_score=excluded.safety_boundary_score,
      student_ui_presentation_fidelity_score=excluded.student_ui_presentation_fidelity_score,
      student_ui_potential_usefulness_score=excluded.student_ui_potential_usefulness_score,
      student_ui_perceived_comprehensibility_score=excluded.student_ui_perceived_comprehensibility_score,
      student_ui_age_context_fit_score=excluded.student_ui_age_context_fit_score,
      student_ui_items_version=excluded.student_ui_items_version,
      workload_score=excluded.workload_score,feedback=excluded.feedback,updated_at=excluded.updated_at`)
    .bind(participant.id, JSON.stringify(sus), likert(input.trust), likert(input.appropriateness),
      likert(input.usability), likert(input.safetyBoundary), studentUiPresentationFidelity,
      studentUiPotentialUsefulness, studentUiPerceivedComprehensibility, studentUiAgeContextFit,
      STUDENT_UI_ITEMS_VERSION, workload, boundedText(input.feedback, 500, false), now, now).run();
  await db.prepare("UPDATE evaluation_participants SET submitted_at=? WHERE id=?").bind(now, participant.id).run();
  return { submitted: true, participantCode: participant.participant_code };
}

export async function withdrawEvaluation(request: Request): Promise<void> {
  const participant = await requireEvaluation(request);
  const db = await evaluationDatabase();
  await db.batch([
    db.prepare("DELETE FROM evaluation_surveys WHERE participant_id=?").bind(participant.id),
    db.prepare("DELETE FROM evaluation_scenario_responses WHERE participant_id=?").bind(participant.id),
    db.prepare("DELETE FROM evaluation_dialogues WHERE participant_id=?").bind(participant.id),
    db.prepare("DELETE FROM evaluation_expert_references WHERE participant_id=?").bind(participant.id),
    db.prepare("DELETE FROM evaluation_participants WHERE id=?").bind(participant.id),
  ]);
}

function researchKey(request: Request): string {
  return request.headers.get("x-research-key")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "").trim() || "";
}

export function requireResearcher(request: Request): void {
  const configured = runtime().RESEARCH_ACCESS_KEY?.trim() ?? "";
  const supplied = researchKey(request);
  if (configured.length < 16 || supplied.length !== configured.length) throw new ApiError(403, "研究者访问密钥无效。");
  let different = 0;
  for (let index = 0; index < configured.length; index += 1) different |= configured.charCodeAt(index) ^ supplied.charCodeAt(index);
  if (different !== 0) throw new ApiError(403, "研究者访问密钥无效。");
}

type AggregateRow = {
  role: EvaluatorRole; participants: number; completed: number; avg_time_ms: number | null;
  avg_trust: number | null; avg_appropriateness: number | null; avg_usability: number | null;
  avg_safety: number | null; avg_workload: number | null; student_ui_n: number;
  avg_student_ui_presentation_fidelity: number | null;
  avg_student_ui_potential_usefulness: number | null;
  avg_student_ui_perceived_comprehensibility: number | null;
  avg_student_ui_age_context_fit: number | null;
};

function numericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function researchSummary(request: Request) {
  requireResearcher(request);
  const db = await evaluationDatabase();
  const rows = await db.prepare(`WITH current_version AS (
      SELECT ? AS value
    ), response_by_participant AS (
      SELECT participant_id, AVG(decision_time_ms) avg_time_ms
      FROM evaluation_scenario_responses GROUP BY participant_id
    ), participant_metrics AS (
      SELECT p.id,p.role,p.submitted_at,r.avg_time_ms,
        s.trust_score,s.appropriateness_score,s.usability_score,s.safety_boundary_score,s.workload_score,
        s.student_ui_presentation_fidelity_score,s.student_ui_potential_usefulness_score,
        s.student_ui_perceived_comprehensibility_score,s.student_ui_age_context_fit_score,
        s.student_ui_items_version
      FROM evaluation_participants p
      LEFT JOIN response_by_participant r ON r.participant_id=p.id
      LEFT JOIN evaluation_surveys s ON s.participant_id=p.id
      WHERE p.data_deleted_at IS NULL
    ) SELECT role,COUNT(*) participants,
      SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) completed,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN avg_time_ms END) avg_time_ms,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN trust_score END) avg_trust,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN appropriateness_score END) avg_appropriateness,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN usability_score END) avg_usability,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN safety_boundary_score END) avg_safety,
      AVG(CASE WHEN submitted_at IS NOT NULL THEN workload_score END) avg_workload,
      SUM(CASE WHEN submitted_at IS NOT NULL AND student_ui_items_version=current_version.value
        AND student_ui_presentation_fidelity_score IS NOT NULL
        AND student_ui_potential_usefulness_score IS NOT NULL
        AND student_ui_perceived_comprehensibility_score IS NOT NULL
        AND student_ui_age_context_fit_score IS NOT NULL THEN 1 ELSE 0 END) student_ui_n,
      AVG(CASE WHEN submitted_at IS NOT NULL AND student_ui_items_version=current_version.value
        THEN student_ui_presentation_fidelity_score END) avg_student_ui_presentation_fidelity,
      AVG(CASE WHEN submitted_at IS NOT NULL AND student_ui_items_version=current_version.value
        THEN student_ui_potential_usefulness_score END) avg_student_ui_potential_usefulness,
      AVG(CASE WHEN submitted_at IS NOT NULL AND student_ui_items_version=current_version.value
        THEN student_ui_perceived_comprehensibility_score END) avg_student_ui_perceived_comprehensibility,
      AVG(CASE WHEN submitted_at IS NOT NULL AND student_ui_items_version=current_version.value
        THEN student_ui_age_context_fit_score END) avg_student_ui_age_context_fit
    FROM participant_metrics CROSS JOIN current_version GROUP BY role`)
    .bind(STUDENT_UI_ITEMS_VERSION).all<AggregateRow>();
  const susRows = await db.prepare("SELECT participant_id,sus_json FROM evaluation_surveys").all<{ participant_id: string; sus_json: string }>();
  const susByParticipant = new Map(susRows.results.map((row) => {
    try { return [row.participant_id, calculateSus(JSON.parse(row.sus_json) as number[])] as const; }
    catch { return [row.participant_id, null] as const; }
  }));
  const participantRoles = await db.prepare("SELECT id,role FROM evaluation_participants WHERE submitted_at IS NOT NULL AND data_deleted_at IS NULL").all<{ id: string; role: EvaluatorRole }>();
  const susByRole = new Map<EvaluatorRole, number[]>();
  for (const participant of participantRoles.results) {
    const value = susByParticipant.get(participant.id);
    if (value == null) continue;
    susByRole.set(participant.role, [...(susByRole.get(participant.role) ?? []), value]);
  }
  const groups = rows.results.map((row) => {
    const sus = susByRole.get(row.role) ?? [];
    const studentUiN = Number(row.student_ui_n ?? 0);
    const studentUiVisible = studentUiN >= 5;
    return {
      role: row.role,
      participants: Number(row.participants),
      completed: Number(row.completed),
      avg_time_ms: numericOrNull(row.avg_time_ms),
      avg_trust: numericOrNull(row.avg_trust),
      avg_appropriateness: numericOrNull(row.avg_appropriateness),
      avg_usability: numericOrNull(row.avg_usability),
      avg_safety: numericOrNull(row.avg_safety),
      avg_workload: numericOrNull(row.avg_workload),
      avg_sus: sus.length ? sus.reduce((sum, value) => sum + value, 0) / sus.length : null,
      student_ui_n: studentUiVisible ? studentUiN : null,
      student_ui_suppressed: !studentUiVisible,
      avg_student_ui_presentation_fidelity: studentUiVisible ? numericOrNull(row.avg_student_ui_presentation_fidelity) : null,
      avg_student_ui_potential_usefulness: studentUiVisible ? numericOrNull(row.avg_student_ui_potential_usefulness) : null,
      avg_student_ui_perceived_comprehensibility: studentUiVisible ? numericOrNull(row.avg_student_ui_perceived_comprehensibility) : null,
      avg_student_ui_age_context_fit: studentUiVisible ? numericOrNull(row.avg_student_ui_age_context_fit) : null,
    };
  });
  const participantCount = groups.reduce((sum, row) => sum + row.participants, 0);
  return {
    syntheticOnly: true,
    participantCount,
    completedCount: groups.reduce((sum, row) => sum + row.completed, 0),
    minimumGroupSize: 5,
    groups: groups.filter((row) => row.completed >= 5),
    suppressedGroups: groups.filter((row) => row.completed < 5).map((row) => row.role),
    versions: { scenarioPack: SCENARIO_PACK_VERSION, output: FROZEN_OUTPUT_VERSION,
      prompt: PROMPT_VERSION, dialoguePack: DIALOGUE_PACK_VERSION,
      dialoguePrompt: DIALOGUE_PROMPT_VERSION, dialogueCases: DIALOGUE_EVALUATION_CASE_IDS,
      studentUiItems: STUDENT_UI_ITEMS_VERSION },
  };
}

function csvCell(value: unknown): string {
  const safe = String(value ?? "").replace(/^[=+\-@]/u, "'").replaceAll('"', '""');
  return `"${safe}"`;
}

export async function researchCsv(request: Request): Promise<string> {
  requireResearcher(request);
  const db = await evaluationDatabase();
  const rows = await db.prepare(`SELECT p.participant_code,p.role,p.experience_band,p.sequence_group,
      p.consent_version,p.quote_consent,p.scenario_pack_version,p.output_version,p.prompt_version,p.started_at,p.submitted_at,
      COALESCE(r.scenario_id,er.scenario_id,d.scenario_id) scenario_id,r.study_condition,r.chosen_action,r.evidence_selected_json,r.context_judgment,
      r.reason_codes_json,r.privacy_choice,r.confidence,r.quality_json,r.must_revise,
      r.critical_harm_flags_json,r.decision_time_ms,r.updated_at,
      er.reference_action,er.reference_evidence_json,er.reference_context_judgment,
      er.reference_reason_codes_json,er.reference_privacy_choice,er.reference_confidence,er.frozen_at,
      d.dialogue_pack_version,d.dialogue_prompt_version,d.model_id dialogue_model_id,
      d.status dialogue_status,d.next_turn dialogue_next_turn,d.transcript_json dialogue_transcript_json,
      d.provider_metadata_json dialogue_provider_metadata_json,d.total_latency_ms dialogue_total_latency_ms,
      d.safety_ended dialogue_safety_ended,d.rating_json dialogue_rating_json,
      d.must_revise dialogue_must_revise,d.harm_flags_json dialogue_harm_flags_json,
      d.started_at dialogue_started_at,d.completed_at dialogue_completed_at,d.rated_at dialogue_rated_at,
      s.sus_json,s.trust_score,s.appropriateness_score,s.usability_score,s.safety_boundary_score,
      s.student_ui_presentation_fidelity_score,s.student_ui_potential_usefulness_score,
      s.student_ui_perceived_comprehensibility_score,s.student_ui_age_context_fit_score,s.student_ui_items_version,
      s.workload_score,s.feedback
    FROM evaluation_participants p
    LEFT JOIN (
      SELECT participant_id,scenario_id FROM evaluation_scenario_responses
      UNION SELECT participant_id,scenario_id FROM evaluation_expert_references
      UNION SELECT participant_id,scenario_id FROM evaluation_dialogues
    ) cases ON cases.participant_id=p.id
    LEFT JOIN evaluation_scenario_responses r ON r.participant_id=p.id AND r.scenario_id=cases.scenario_id
    LEFT JOIN evaluation_expert_references er ON er.participant_id=p.id AND er.scenario_id=cases.scenario_id
    LEFT JOIN evaluation_dialogues d ON d.participant_id=p.id AND d.scenario_id=cases.scenario_id
    LEFT JOIN evaluation_surveys s ON s.participant_id=p.id
    WHERE p.data_deleted_at IS NULL ORDER BY p.participant_code,COALESCE(r.scenario_id,er.scenario_id,d.scenario_id)`).all<Record<string, unknown>>();
  const headers = ["participant_code","role","experience_band","sequence_group","consent_version","quote_consent","scenario_pack_version","output_version","prompt_version","started_at","submitted_at","scenario_id","study_condition","chosen_action","evidence_selected_json","context_judgment","reason_codes_json","privacy_choice","confidence","quality_json","must_revise","critical_harm_flags_json","decision_time_ms","updated_at","reference_action","reference_evidence_json","reference_context_judgment","reference_reason_codes_json","reference_privacy_choice","reference_confidence","frozen_at","dialogue_pack_version","dialogue_prompt_version","dialogue_model_id","dialogue_status","dialogue_next_turn","dialogue_transcript_json","dialogue_provider_metadata_json","dialogue_total_latency_ms","dialogue_safety_ended","dialogue_rating_json","dialogue_must_revise","dialogue_harm_flags_json","dialogue_started_at","dialogue_completed_at","dialogue_rated_at","sus_json","trust_score","appropriateness_score","usability_score","safety_boundary_score","student_ui_presentation_fidelity_score","student_ui_potential_usefulness_score","student_ui_perceived_comprehensibility_score","student_ui_age_context_fit_score","student_ui_items_version","workload_score","feedback"];
  return `\uFEFF${headers.join(",")}\n${rows.results.map((row) => headers.map((key) => csvCell(row[key])).join(",")).join("\n")}`;
}
