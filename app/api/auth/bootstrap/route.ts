import { asObject } from "@/lib/validation";
import {
  bootstrapTeacher,
  consumeAuthRateLimit,
  createSession,
  sessionCookie,
} from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireStudentMode(getRuntimeEnv());
    await consumeAuthRateLimit(request, "bootstrap", "first-teacher", 5, 15 * 60);
    const body = asObject(await readJsonBody<unknown>(request));
    const user = await bootstrapTeacher({
      bootstrapToken: body.bootstrapToken,
      username: body.username,
      password: body.password,
      displayName: body.displayName,
    });
    const token = await createSession(user.id);
    return jsonResponse({ ok: true, user }, 201, { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    return handleApiError(error);
  }
}
