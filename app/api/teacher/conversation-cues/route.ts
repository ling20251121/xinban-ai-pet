import { getRuntimeEnv } from "@/db";
import { requireTeacher } from "@/lib/auth";
import { listConversationCues, updateConversationCue } from "@/lib/chat-cues";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { requireStudentMode } from "@/lib/public-demo";
import { asObject, parseOptionalEntryId } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    const { user } = await requireTeacher(request);
    const classId = parseOptionalEntryId(new URL(request.url).searchParams.get("classId")) ?? null;
    return jsonResponse({ cues: await listConversationCues(user.id, classId) });
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
    const cue = await updateConversationCue(user, body.cueId, body.status);
    return jsonResponse({ ok: true, cue });
  } catch (error) {
    return handleApiError(error);
  }
}
