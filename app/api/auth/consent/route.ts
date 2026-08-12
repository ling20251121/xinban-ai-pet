import {
  clearSessionCookie,
  requireSession,
  revokeSession,
  setStudentConsent,
} from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireStudentMode(getRuntimeEnv());
    const session = await requireSession(request);
    const body = asObject(await readJsonBody<unknown>(request));
    const user = await setStudentConsent(session, body.accepted);
    if (body.accepted === false) {
      await revokeSession(session.tokenHash);
      return jsonResponse({ ok: true, user }, 200, { "Set-Cookie": clearSessionCookie() });
    }
    return jsonResponse({ ok: true, user });
  } catch (error) {
    return handleApiError(error);
  }
}
