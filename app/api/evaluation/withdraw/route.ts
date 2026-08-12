import { clearEvaluationCookie, withdrawEvaluation } from "@/lib/evaluation";
import { ensureStrictSameOrigin, handleApiError, jsonResponse } from "@/lib/http";

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    await withdrawEvaluation(request);
    return jsonResponse({ withdrawn: true, deleted: true }, 200, { "Set-Cookie": clearEvaluationCookie() });
  } catch (error) { return handleApiError(error); }
}
