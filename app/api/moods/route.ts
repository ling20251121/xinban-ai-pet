import { hashParticipantCode } from "@/lib/identity";
import {
  createMoodEntry,
  deleteMoodEntries,
  listMoodEntries,
} from "@/lib/moods";
import {
  ensureSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";
import {
  analyzeSafety,
  buildSupportEvidence,
  CRISIS_REPLY,
} from "@/lib/safety";
import {
  asObject,
  normalizeParticipantCode,
  parseLimit,
  parseMoodPayload,
  parseOptionalEntryId,
} from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const participantCode = normalizeParticipantCode(
      url.searchParams.get("participantCode"),
    );
    const limit = parseLimit(url.searchParams.get("limit"));
    const participantHash = await hashParticipantCode(participantCode);
    const entries = await listMoodEntries(participantHash, limit);
    return jsonResponse({ entries });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const payload = parseMoodPayload(await readJsonBody<unknown>(request));
    const participantHash = await hashParticipantCode(payload.participantCode);
    const safety = analyzeSafety(payload.note, payload.goal);
    const supportEvidence = buildSupportEvidence(
      payload.wantsSupport,
      safety.evidence,
      payload.note,
      payload.goal,
    );
    const entry = await createMoodEntry({
      ...payload,
      participantHash,
      safetyLevel: safety.safetyLevel,
      supportEvidence,
    });

    return jsonResponse(
      {
        ok: true,
        entry,
        urgent: safety.urgent,
        ...(safety.urgent ? { message: CRISIS_REPLY } : {}),
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const body = asObject(await readJsonBody<unknown>(request, 4_096));
    const participantCode = normalizeParticipantCode(body.participantCode);
    const id = parseOptionalEntryId(body.id);
    const participantHash = await hashParticipantCode(participantCode);
    const deleted = await deleteMoodEntries(participantHash, id);
    return jsonResponse({ ok: true, deleted });
  } catch (error) {
    return handleApiError(error);
  }
}
