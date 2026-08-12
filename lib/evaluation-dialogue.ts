import { getCompanionReply } from "@/lib/ai";
import {
  DIALOGUE_PACK_VERSION,
  DIALOGUE_PROMPT_VERSION,
  SYNTHETIC_DIALOGUE_TURNS,
  SYNTHETIC_EVALUATION_CASES,
  isDialogueEvaluationCase,
} from "@/lib/evaluation-cases";
import {
  evaluationDatabase,
  requireEvaluation,
  requireCurrentEvaluationConsent,
} from "@/lib/evaluation";
import { ApiError } from "@/lib/http";
import { DEFAULT_QWEN_CHAT_MODEL } from "@/lib/qwen";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";

const MAX_TURNS = 3;
const STALE_LEASE_MILLISECONDS = 30_000;

type DialogueRole = "user" | "assistant";

export interface EvaluationDialogueMessage {
  turnIndex: number;
  role: DialogueRole;
  content: string;
  provider?: "qwen" | "local-safety";
  modelId?: string;
  promptVersion?: string;
  latencyMs?: number;
  safetyLevel?: "normal" | "urgent";
}

interface DialogueRow {
  participant_id: string;
  scenario_id: string;
  status: "ready" | "in_flight" | "completed";
  next_turn: number;
  lease_token: string | null;
  transcript_json: string;
  provider_metadata_json: string;
  total_latency_ms: number;
  rated_at: string | null;
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function publicDialogue(row: DialogueRow, transcript: EvaluationDialogueMessage[]) {
  const assistants = transcript.filter((message) => message.role === "assistant");
  return {
    messages: transcript,
    nextTurn: Number(row.next_turn),
    completed: row.status === "completed",
    sealed: Boolean(row.rated_at),
    modelId: assistants.at(-1)?.modelId ?? null,
    dialoguePackVersion: DIALOGUE_PACK_VERSION,
    promptVersion: DIALOGUE_PROMPT_VERSION,
    totalLatencyMs: Number(row.total_latency_ms),
    safetyEnded: assistants.some((message) => message.safetyLevel === "urgent"),
  };
}

/**
 * Advances exactly one server-owned fictional student turn. The caller never
 * supplies student content or chat history. A lease/CAS prevents duplicate
 * provider calls when a button is double-clicked or two tabs race.
 */
export async function advanceEvaluationDialogue(
  request: Request,
  input: { scenarioId: unknown; expectedTurn: unknown },
) {
  const participant = await requireEvaluation(request);
  requireCurrentEvaluationConsent(participant);
  if (participant.submitted_at) {
    throw new ApiError(409, "评估已经提交，不能继续运行正式对话。");
  }
  if (typeof input.scenarioId !== "string" || !isDialogueEvaluationCase(input.scenarioId)) {
    throw new ApiError(404, "该案例不属于固定多轮对话评估子集。");
  }
  const expectedTurn = Number(input.expectedTurn);
  if (!Number.isInteger(expectedTurn) || expectedTurn < 0 || expectedTurn >= MAX_TURNS) {
    throw new ApiError(400, "对话轮次无效，请刷新页面后重试。");
  }

  const scenario = SYNTHETIC_EVALUATION_CASES.find((item) => item.id === input.scenarioId);
  if (!scenario) throw new ApiError(404, "合成案例不存在。");
  const db = await evaluationDatabase();
  if (participant.role === "expert") {
    const reference = await db.prepare(`SELECT frozen_at FROM evaluation_expert_references
      WHERE participant_id=? AND scenario_id=?`).bind(participant.id, scenario.id)
      .first<{ frozen_at: string }>();
    if (!reference?.frozen_at) {
      throw new ApiError(409, "请先完整冻结本案例的独立参考判断，再查看和评价 AI 对话。");
    }
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  await db.prepare(`INSERT INTO evaluation_dialogues
    (participant_id,scenario_id,dialogue_pack_version,dialogue_prompt_version,
      model_id,status,next_turn,lease_token,lease_started_at,transcript_json,
      provider_metadata_json,total_latency_ms,safety_ended,rating_json,must_revise,
      harm_flags_json,started_at,completed_at,rated_at,updated_at)
    VALUES (?,?,?,?,NULL,'ready',0,NULL,NULL,'[]','[]',0,0,NULL,NULL,NULL,NULL,NULL,NULL,?)
    ON CONFLICT(participant_id,scenario_id) DO NOTHING`)
    .bind(participant.id, scenario.id, DIALOGUE_PACK_VERSION, DIALOGUE_PROMPT_VERSION, now).run();

  const leaseToken = crypto.randomUUID();
  const staleBefore = new Date(nowDate.getTime() - STALE_LEASE_MILLISECONDS).toISOString();
  const reservation = await db.prepare(`UPDATE evaluation_dialogues SET status='in_flight',
      lease_token=?,lease_started_at=?,started_at=COALESCE(started_at,?),updated_at=?
    WHERE participant_id=? AND scenario_id=? AND next_turn=? AND rated_at IS NULL
      AND status<>'completed' AND (status='ready' OR (status='in_flight' AND lease_started_at<?))`)
    .bind(leaseToken, now, now, now, participant.id, scenario.id, expectedTurn, staleBefore).run();
  if (Number(reservation.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "此轮对话正在生成、已经完成，或页面轮次已过期；请刷新后查看。");
  }

  const reserved = await db.prepare(`SELECT participant_id,scenario_id,status,next_turn,lease_token,
      transcript_json,provider_metadata_json,total_latency_ms,rated_at
    FROM evaluation_dialogues WHERE participant_id=? AND scenario_id=? AND lease_token=?`)
    .bind(participant.id, scenario.id, leaseToken).first<DialogueRow>();
  if (!reserved) throw new ApiError(409, "对话请求已失效，请刷新页面后重试。");

  const transcript = parseArray<EvaluationDialogueMessage>(reserved.transcript_json);
  const metadata = parseArray<Record<string, unknown>>(reserved.provider_metadata_json);
  const studentMessage = SYNTHETIC_DIALOGUE_TURNS[input.scenarioId][expectedTurn];
  // C08 is an authored crisis-case invariant even if future wording no longer
  // happens to match one exact lexical pattern in the general student gate.
  const safety = scenario.id === "C08"
    ? { safetyLevel: "urgent" as const, urgent: true, evidence: "fixed_crisis_case_C08" }
    : analyzeSafety(studentMessage);
  const started = Date.now();
  try {
    let reply: string;
    let provider: "qwen" | "local-safety";
    let modelId: string;
    if (safety.urgent) {
      reply = CRISIS_REPLY;
      provider = "local-safety";
      modelId = "local_crisis_rule";
    } else {
      const history = transcript.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const companion = await getCompanionReply(scenario.mood, studentMessage, history);
      reply = companion.reply;
      provider = companion.provider;
      modelId = DEFAULT_QWEN_CHAT_MODEL;
    }
    const latencyMs = Math.max(0, Date.now() - started);
    transcript.push(
      { turnIndex: expectedTurn, role: "user", content: studentMessage },
      {
        turnIndex: expectedTurn,
        role: "assistant",
        content: reply,
        provider,
        modelId,
        promptVersion: DIALOGUE_PROMPT_VERSION,
        latencyMs,
        safetyLevel: safety.urgent ? "urgent" : "normal",
      },
    );
    metadata.push({
      turnIndex: expectedTurn,
      provider,
      modelId,
      promptVersion: DIALOGUE_PROMPT_VERSION,
      dialoguePackVersion: DIALOGUE_PACK_VERSION,
      latencyMs,
      safetyLevel: safety.urgent ? "urgent" : "normal",
    });
    const nextTurn = expectedTurn + 1;
    const completed = safety.urgent || nextTurn >= MAX_TURNS;
    const finishedAt = new Date().toISOString();
    const saved = await db.prepare(`UPDATE evaluation_dialogues SET model_id=?,status=?,next_turn=?,
        lease_token=NULL,lease_started_at=NULL,transcript_json=?,provider_metadata_json=?,
        total_latency_ms=total_latency_ms+?,safety_ended=?,completed_at=?,updated_at=?
      WHERE participant_id=? AND scenario_id=? AND status='in_flight' AND lease_token=? AND next_turn=?`)
      .bind(modelId, completed ? "completed" : "ready", nextTurn, JSON.stringify(transcript),
        JSON.stringify(metadata), latencyMs, safety.urgent ? 1 : 0,
        completed ? finishedAt : null, finishedAt, participant.id, scenario.id, leaseToken, expectedTurn).run();
    if (Number(saved.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, "此轮对话的保存租约已失效，请刷新页面查看是否已完成。");
    }
    const resultRow: DialogueRow = {
      ...reserved,
      status: completed ? "completed" : "ready",
      next_turn: nextTurn,
      transcript_json: JSON.stringify(transcript),
      provider_metadata_json: JSON.stringify(metadata),
      total_latency_ms: Number(reserved.total_latency_ms) + latencyMs,
      lease_token: null,
    };
    return {
      syntheticOnly: true,
      nonClinicalBoundary: "情绪表达与梳理型 AI chatbot，不是心理咨询、诊断、治疗或危机服务。",
      dialogue: publicDialogue(resultRow, transcript),
    };
  } catch (error) {
    await db.prepare(`UPDATE evaluation_dialogues SET status='ready',lease_token=NULL,
      lease_started_at=NULL,updated_at=? WHERE participant_id=? AND scenario_id=?
      AND status='in_flight' AND lease_token=?`).bind(
      new Date().toISOString(), participant.id, scenario.id, leaseToken,
    ).run().catch(() => undefined);
    throw error;
  }
}
