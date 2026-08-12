import { getOptionalSession } from "@/lib/auth";
import { handleApiError, jsonResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getOptionalSession(request);
    if (!session) return jsonResponse({ authenticated: false });
    const { user } = session;
    return jsonResponse({
      authenticated: true,
      user,
      requiresPasswordChange: user.mustChangePassword,
      requiresStudentConsent: user.role === "student" && !user.studentConsented,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
