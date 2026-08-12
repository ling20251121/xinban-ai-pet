import { asObject } from "@/lib/validation";
import {
  consumeAuthRateLimit,
  createSession,
  login,
  normalizeSchoolUsername,
  sessionCookie,
} from "@/lib/auth";
import { ApiError, ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireStudentMode(getRuntimeEnv());
    const body = asObject(await readJsonBody<unknown>(request));
    const runtime = getRuntimeEnv();
    if (
      runtime.SANDBOX_MODE?.trim().toLowerCase() === "true" &&
      (body.adultConfirmed !== true || body.syntheticOnlyConfirmed !== true)
    ) {
      throw new ApiError(
        400,
        "进入合成学校沙盒前，必须确认已满 18 周岁且不会输入真实学生信息。",
      );
    }
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
