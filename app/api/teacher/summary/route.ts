import { requireTeacher } from "@/lib/auth";
import { handleApiError, jsonResponse } from "@/lib/http";
import { getTeacherSummary } from "@/lib/moods";
import { parseDays, parseOptionalEntryId } from "@/lib/validation";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function GET(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    const { user } = await requireTeacher(request);
    const url = new URL(request.url);
    const days = parseDays(url.searchParams.get("days"));
    const classId = parseOptionalEntryId(url.searchParams.get("classId")) ?? null;
    return jsonResponse(await getTeacherSummary(user.id, days, classId));
  } catch (error) { return handleApiError(error); }
}
