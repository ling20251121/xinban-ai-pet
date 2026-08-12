import {
  clearSessionCookie,
  requireSession,
  revokeSession,
  setStudentConsent,
} from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
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
