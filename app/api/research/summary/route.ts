import { researchSummary } from "@/lib/evaluation";
import { handleApiError, jsonResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try { return jsonResponse(await researchSummary(request)); }
  catch (error) { return handleApiError(error); }
}
