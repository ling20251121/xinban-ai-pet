import { evaluationCookie, evaluationState, startEvaluation } from "@/lib/evaluation";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try { return jsonResponse(await evaluationState(request)); }
  catch (error) { return handleApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request);
    const started = await startEvaluation(request, input);
    return jsonResponse(
      { participant: { code: started.participant.participant_code, role: started.participant.role } },
      201,
      { "Set-Cookie": evaluationCookie(started.sessionToken) },
    );
  } catch (error) { return handleApiError(error); }
}
