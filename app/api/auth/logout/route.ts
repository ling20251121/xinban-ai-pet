import { clearSessionCookie, getOptionalSession, revokeSession } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse } from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const session = await getOptionalSession(request);
    if (session) await revokeSession(session.tokenHash);
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  } catch (error) {
    return handleApiError(error);
  }
}
