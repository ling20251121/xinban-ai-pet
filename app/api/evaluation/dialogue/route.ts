import { advanceEvaluationDialogue } from "@/lib/evaluation-dialogue";
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
    const input = await readJsonBody<Record<string, unknown>>(request, 2_048);
    const keys = Object.keys(input).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== "expectedTurn" ||
      keys[1] !== "scenarioId"
    ) {
      throw new ApiError(
        400,
        "正式多轮评估只接收案例编号和预期轮次；不接收自由文本或客户端对话历史。",
      );
    }
    return jsonResponse(await advanceEvaluationDialogue(request, {
      scenarioId: input.scenarioId,
      expectedTurn: input.expectedTurn,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
