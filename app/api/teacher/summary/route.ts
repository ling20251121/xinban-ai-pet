import { handleApiError, jsonResponse } from "@/lib/http";
import { getTeacherSummary } from "@/lib/moods";
import { requireTeacherAccess } from "@/lib/teacher-auth";
import { parseDays } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireTeacherAccess(request);
    const days = parseDays(new URL(request.url).searchParams.get("days"));
    const summary = await getTeacherSummary(days);
    return jsonResponse(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
