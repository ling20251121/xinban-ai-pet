import { changeOwnPassword, consumeAuthRateLimit, requireSession } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireStudentMode(getRuntimeEnv());
    const session = await requireSession(request);
    await consumeAuthRateLimit(request, "change-password", session.user.id, 5, 15 * 60);
    const body = asObject(await readJsonBody<unknown>(request));
    const user = await changeOwnPassword(session, body.currentPassword, body.newPassword);
    return jsonResponse({ ok: true, user });
  } catch (error) {
    return handleApiError(error);
  }
}
