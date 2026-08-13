import { getRuntimeEnv } from "@/db";
import { listAttentionEvents, updateAttentionEvent } from "@/lib/attention-events";
import { requireTeacher } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { requireStudentMode } from "@/lib/public-demo";
import { asObject, parseOptionalEntryId } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    const { user } = await requireTeacher(request);
    const classId = parseOptionalEntryId(
      new URL(request.url).searchParams.get("classId"),
    ) ?? null;
    return jsonResponse({ events: await listAttentionEvents(user.id, classId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const body = asObject(await readJsonBody<unknown>(request));
    const event = await updateAttentionEvent(user, body.eventId, body.status);
    return jsonResponse({ ok: true, event });
  } catch (error) {
    return handleApiError(error);
  }
}
