import {
  ensureStrictSameOrigin,
  handleApiError,
  readJsonBody,
} from "@/lib/http";
import { requireVoiceUser } from "@/lib/auth";
import {
  parseTtsPayload,
  speechFingerprint,
  synthesizeWithQwen,
} from "@/lib/tts";
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
    await requireVoiceUser(request);
    lease = reserveVoiceRequest(request);
    const payload = parseTtsPayload(await readJsonBody<unknown>(request));
    if (isSyntheticSchoolSandbox(getRuntimeEnv())) {
      rejectSandboxPersonalInformation(payload.text.normalize("NFKC"));
    }
    lease.claimFingerprint(`tts-${speechFingerprint(payload.text)}`);
    const audio = await synthesizeWithQwen(payload.text);
    const responseBody = new Uint8Array(audio.byteLength);
    responseBody.set(audio);

    return new Response(responseBody.buffer, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": "inline; filename=companion.wav",
        "Content-Type": "audio/wav",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  } finally {
    lease?.release();
  }
}
