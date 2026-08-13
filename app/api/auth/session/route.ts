import { getOptionalSession } from "@/lib/auth";
import { getRuntimeEnv } from "@/db";
import { handleApiError, jsonResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getOptionalSession(request);
    if (!session) return jsonResponse({ authenticated: false });
    const { user } = session;
    const runtime = getRuntimeEnv();
    const localName = runtime.LOCAL_MENTAL_HEALTH_NAME?.trim() ?? "";
    const localPhone = runtime.LOCAL_MENTAL_HEALTH_PHONE?.trim() ?? "";
    const local = localName && /^[0-9+() -]{5,24}$/u.test(localPhone) && /[1-9]/u.test(localPhone)
      ? { name: localName.slice(0, 60), phone: localPhone }
      : null;
    return jsonResponse({
      authenticated: true,
      user,
      requiresPasswordChange: user.mustChangePassword,
      requiresStudentConsent: user.role === "student" && !user.studentConsented,
      supportDirectory: {
        national: { name: "全国统一心理援助热线", phone: "12356" },
        local,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
