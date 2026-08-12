import {
  ensureStrictSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";
import { requireVoiceUser } from "@/lib/auth";
import { recordUrgentEvent } from "@/lib/conversations";
import {
  MAX_VOICE_REQUEST_BYTES,
  parseVoicePayload,
  transcribeWithQwen,
} from "@/lib/voice";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";
import {
  reserveVoiceRequest,
  type VoiceRequestLease,
} from "@/lib/voice-rate-limit";
import { getRuntimeEnv } from "@/db";
import { rejectSandboxPersonalInformation } from "@/lib/content-safety";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";

export async function POST(request: Request): Promise<Response> {
  let lease: VoiceRequestLease | undefined;
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireVoiceUser(request);
    lease = reserveVoiceRequest(request);
    const payload = await readJsonBody<unknown>(
      request,
      MAX_VOICE_REQUEST_BYTES,
    );
    const audio = parseVoicePayload(payload);
    const text = await transcribeWithQwen(audio, () =>
      lease?.claimFingerprint(audio.fingerprint),
    );
    if (isSyntheticSchoolSandbox(getRuntimeEnv())) {
      rejectSandboxPersonalInformation(text);
    }
    const safety = analyzeSafety(text);
    if (safety.urgent && user.role === "student") {
      await recordUrgentEvent(user, "voice", null);
    }

    // The audio exists only in request-local memory and is never persisted.
    return jsonResponse({
      text,
      urgent: safety.urgent,
      ...(safety.urgent ? { message: CRISIS_REPLY } : {}),
    });
  } catch (error) {
    return handleApiError(error);
  } finally {
    lease?.release();
  }
}
