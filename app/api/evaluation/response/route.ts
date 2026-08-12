import { freezeExpertReference, saveScenarioResponse, submitSurvey } from "@/lib/evaluation";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request);
    if (input.kind === "survey") return jsonResponse(await submitSurvey(request, input));
    if (input.kind === "expert-reference") return jsonResponse(await freezeExpertReference(request, input));
    return jsonResponse(await saveScenarioResponse(request, input));
  } catch (error) { return handleApiError(error); }
}
