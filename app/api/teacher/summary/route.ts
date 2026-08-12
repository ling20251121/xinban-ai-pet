import { requireTeacher } from "@/lib/auth";
import { handleApiError, jsonResponse } from "@/lib/http";
import { getTeacherSummary } from "@/lib/moods";
import { parseDays, parseOptionalEntryId } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireTeacher(request);
    const url = new URL(request.url);
    const days = parseDays(url.searchParams.get("days"));
    const classId = parseOptionalEntryId(url.searchParams.get("classId")) ?? null;
    return jsonResponse(await getTeacherSummary(user.id, days, classId));
  } catch (error) { return handleApiError(error); }
}
