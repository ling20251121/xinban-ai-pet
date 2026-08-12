import { requireTeacher } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { listSafetyEvents, updateSafetyEvent } from "@/lib/safety-events";
import { asObject, parseOptionalEntryId } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireTeacher(request);
    const classId = parseOptionalEntryId(
      new URL(request.url).searchParams.get("classId"),
    ) ?? null;
    return jsonResponse({ events: await listSafetyEvents(user.id, classId) });
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const body = asObject(await readJsonBody<unknown>(request));
    const event = await updateSafetyEvent(user, body.eventId, body.status);
    return jsonResponse({ ok: true, event });
  } catch (error) { return handleApiError(error); }
}
