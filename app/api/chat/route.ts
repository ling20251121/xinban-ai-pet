import { getCompanionReply } from "@/lib/ai";
import {
  ensureSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";
import { parseChatPayload } from "@/lib/validation";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const payload = parseChatPayload(await readJsonBody<unknown>(request));

    // This deterministic check happens before provider configuration or fetch.
    // The participant code and crisis text are never sent to an external model.
    const safety = analyzeSafety(payload.mood, payload.message);
    if (safety.urgent) {
      return jsonResponse({
        reply: CRISIS_REPLY,
        urgent: true,
        provider: "local-safety",
      });
    }

    const companion = await getCompanionReply(payload.mood, payload.message);
    return jsonResponse({
      reply: companion.reply,
      urgent: false,
      provider: companion.provider,
      ...(companion.degraded ? { degraded: true } : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
