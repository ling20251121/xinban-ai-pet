import { getCompanionReply } from "@/lib/ai";
import { requireStudentIdentity, requireStudentReady } from "@/lib/auth";
import {
  deleteConversations,
  finishConversation,
  getConversation,
  getOrCreateConversation,
  listConversations,
  recentHistory,
  releaseFailedTurn,
  reserveTurn,
  saveAssistantAndFinish,
  saveUrgentConversation,
} from "@/lib/conversations";
import {
  ensureStrictSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";
import { asObject, parseChatPayload, parseOptionalEntryId } from "@/lib/validation";
import { getRuntimeEnv } from "@/db";
import { rejectSandboxPersonalInformation } from "@/lib/content-safety";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";
import {
  analyzeConversationWindow,
  recentStudentTurns,
  saveConversationCue,
  shouldAnalyzeConversationTurn,
} from "@/lib/chat-cues";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireStudentIdentity(request);
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (conversationId) return jsonResponse(await getConversation(user.id, conversationId));
    return jsonResponse({ conversations: await listConversations(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  let reservedConversation: { id: string } | undefined;
  let reservedUserId: string | undefined;
  let leaseToken: string | undefined;
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentReady(request);
    const payload = parseChatPayload(await readJsonBody<unknown>(request));
    if (isSyntheticSchoolSandbox(getRuntimeEnv())) {
      rejectSandboxPersonalInformation(payload.mood, payload.message);
    }
    const conversation = await getOrCreateConversation(user, payload.conversationId);
    const reservation = await reserveTurn(user, conversation, request);
    const { studentTurns } = reservation;
    leaseToken = reservation.leaseToken;
    reservedConversation = conversation;
    reservedUserId = user.id;

    // Local deterministic safety runs before storing/sending any model input.
    const safety = analyzeSafety(payload.mood, payload.message);
    const history = safety.urgent
      ? []
      : await recentHistory(conversation.id, user.id);
    if (safety.urgent) {
      const updated = await saveUrgentConversation(
        user,
        conversation.id,
        reservation.leaseToken,
        payload.message,
        CRISIS_REPLY,
      );
      return jsonResponse({
        reply: CRISIS_REPLY,
        urgent: true,
        provider: "local-safety",
        conversationId: conversation.id,
        studentTurns,
        startedAt: updated.started_at,
        ended: true,
      });
    }

    // Exactly six prior user/assistant pairs at most; getCompanionReply applies
    // a second per-message de-identification pass before the Qwen request.
    const companion = await getCompanionReply(payload.mood, payload.message, history);
    const updated = await saveAssistantAndFinish(
      user,
      conversation.id,
      reservation.leaseToken,
      payload.message,
      companion.reply,
      false,
    );
    let analysisAvailable: boolean | undefined;
    let cueCreated = false;
    if (shouldAnalyzeConversationTurn(studentTurns)) {
      // The reply is already committed. Cue analysis is deliberately
      // best-effort: a timeout, malformed JSON or storage failure must never
      // roll back the student's already committed conversation turn.
      try {
        const window = await recentStudentTurns(conversation.id, user.id);
        const analyzed = await analyzeConversationWindow(window);
        if (analyzed) {
          analysisAvailable = true;
          cueCreated = await saveConversationCue({
            user,
            conversationId: conversation.id,
            windowTurn: studentTurns,
            analysis: analyzed.analysis,
            model: analyzed.model,
          }).catch(() => false);
        } else {
          analysisAvailable = false;
        }
      } catch {
        analysisAvailable = false;
      }
    }
    return jsonResponse({
      reply: companion.reply,
      urgent: false,
      provider: companion.provider,
      conversationId: conversation.id,
      studentTurns,
      startedAt: updated.started_at,
      ended: Boolean(updated.ended_at),
      ...(analysisAvailable === undefined ? {} : { analysisAvailable, cueCreated }),
    });
  } catch (error) {
    if (reservedConversation && reservedUserId && leaseToken) {
      await releaseFailedTurn(
        reservedUserId,
        reservedConversation.id,
        leaseToken,
      ).catch(() => undefined);
    }
    return handleApiError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentIdentity(request);
    const body = asObject(await readJsonBody<unknown>(request, 4_096));
    const conversationId = parseOptionalEntryId(body.conversationId);
    const conversation = await finishConversation(user, conversationId);
    return jsonResponse({ ok: true, conversation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentIdentity(request);
    const body = asObject(await readJsonBody<unknown>(request, 4_096));
    const conversationId = parseOptionalEntryId(body.conversationId);
    const deleted = await deleteConversations(user.id, conversationId);
    return jsonResponse({ ok: true, deleted });
  } catch (error) {
    return handleApiError(error);
  }
}
