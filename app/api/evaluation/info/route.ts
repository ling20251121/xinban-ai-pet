import { publicEvaluationInformation } from "@/lib/evaluation";
import { handleApiError, jsonResponse } from "@/lib/http";

export async function GET(): Promise<Response> {
  try {
    return jsonResponse({ ...publicEvaluationInformation(), syntheticOnly: true });
  } catch (error) {
    return handleApiError(error);
  }
}
