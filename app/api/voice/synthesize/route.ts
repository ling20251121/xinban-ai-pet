import {
  ensureSameOrigin,
  handleApiError,
  readJsonBody,
} from "@/lib/http";
import {
  parseTtsPayload,
  speechFingerprint,
  synthesizeWithQwen,
} from "@/lib/tts";
import {
  reserveVoiceRequest,
  type VoiceRequestLease,
} from "@/lib/voice-rate-limit";

export async function POST(request: Request): Promise<Response> {
  let lease: VoiceRequestLease | undefined;
  try {
    ensureSameOrigin(request);
    lease = reserveVoiceRequest(request);
    const payload = parseTtsPayload(await readJsonBody<unknown>(request));
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
