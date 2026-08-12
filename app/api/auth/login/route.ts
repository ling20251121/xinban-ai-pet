import { asObject } from "@/lib/validation";
import {
  consumeAuthRateLimit,
  createSession,
  login,
  normalizeSchoolUsername,
  sessionCookie,
} from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const body = asObject(await readJsonBody<unknown>(request));
    const username = normalizeSchoolUsername(body.username);
    await consumeAuthRateLimit(request, "login", username, 10, 15 * 60);
    const user = await login(username, body.password);
    const token = await createSession(user.id);
    return jsonResponse(
      {
        ok: true,
        user,
        requiresPasswordChange: user.mustChangePassword,
        requiresStudentConsent: user.role === "student" && !user.studentConsented,
      },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
