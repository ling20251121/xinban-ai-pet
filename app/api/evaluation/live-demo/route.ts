import { getCompanionReply } from "@/lib/ai";
import { requireCompletedEvaluationLiveDemo } from "@/lib/evaluation";
import { SYNTHETIC_EVALUATION_CASES } from "@/lib/evaluation-cases";
import {
  ApiError,
  ensureStrictSameOrigin,
  handleApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    await requireCompletedEvaluationLiveDemo(request);
    const { scenarioId } =
      await readJsonBody<Record<string, unknown>>(request);
    const scenario = SYNTHETIC_EVALUATION_CASES.find(
      (item) => item.id === scenarioId,
    );
    if (!scenario) throw new ApiError(404, "合成案例不存在。");

    try {
      const companion = await getCompanionReply(
        scenario.mood,
        scenario.studentMessage,
      );
      return jsonResponse({
        reply: companion.reply,
        provider: companion.provider,
        syntheticOnly: true,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 502 ||
          error.status === 503 ||
          error.status === 504)
      ) {
        throw new ApiError(503, error.publicMessage);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
