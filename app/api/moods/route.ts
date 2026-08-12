import { requireStudentIdentity, requireStudentReady } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { createMoodEntry, deleteMoodEntries, listMoodEntries } from "@/lib/moods";
import { analyzeSafety, CRISIS_REPLY } from "@/lib/safety";
import { asObject, parseLimit, parseMoodPayload, parseOptionalEntryId } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireStudentIdentity(request);
    const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
    return jsonResponse({ entries: await listMoodEntries(user.id, limit) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentReady(request);
    if (!user.classId) throw new Error("Missing authenticated class");
    const payload = parseMoodPayload(await readJsonBody<unknown>(request));
    const safety = analyzeSafety(payload.note, payload.goal);
    const entry = await createMoodEntry({
      ...payload, userId: user.id, classId: user.classId, username: user.username,
      safetyLevel: safety.safetyLevel,
      supportEvidence: safety.urgent
        ? "local_crisis_rule"
        : payload.wantsSupport
          ? "student_requested_support"
          : null,
    });
    return jsonResponse({
      ok: true, entry, urgent: safety.urgent,
      ...(safety.urgent ? { message: CRISIS_REPLY } : {}),
    }, 201);
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentIdentity(request);
    const body = asObject(await readJsonBody<unknown>(request, 4_096));
    const deleted = await deleteMoodEntries(user.id, parseOptionalEntryId(body.id));
    return jsonResponse({ ok: true, deleted });
  } catch (error) { return handleApiError(error); }
}
