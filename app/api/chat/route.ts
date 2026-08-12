import { getCompanionReply } from "@/lib/ai";
import { requireStudentIdentity, requireStudentReady } from "@/lib/auth";
import {
  deleteConversations,
  getConversation,
  getOrCreateConversation,
  listConversations,
  recentHistory,
  releaseFailedTurn,
  reserveTurn,
  saveAssistantAndFinish,
  saveUrgentConversation,
  saveUserMessage,
} from "@/lib/conversations";
import {
  ensureStrictSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";
import { asObject, parseChatPayload, parseOptionalEntryId } from "@/lib/validation";

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
    const conversation = await getOrCreateConversation(user, payload.conversationId);
    const reservation = await reserveTurn(user, conversation);
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
        expiresAt: updated.expires_at,
        ended: true,
      });
    }

    await saveUserMessage(
      user.id,
      conversation.id,
      reservation.leaseToken,
      payload.message,
      false,
    );
    // Exactly six prior user/assistant pairs at most; getCompanionReply applies
    // a second per-message de-identification pass before the Qwen request.
    const companion = await getCompanionReply(payload.mood, payload.message, history);
    const updated = await saveAssistantAndFinish(
      user,
      conversation.id,
      reservation.leaseToken,
      companion.reply,
      false,
    );
    return jsonResponse({
      reply: companion.reply,
      urgent: false,
      provider: companion.provider,
      conversationId: conversation.id,
      studentTurns,
      expiresAt: updated.expires_at,
      ended: Boolean(updated.ended_at),
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
