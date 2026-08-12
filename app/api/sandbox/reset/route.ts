import { ensureStrictSameOrigin, handleApiError, jsonResponse } from "@/lib/http";
import { requireSandboxAdministrator, resetSyntheticSchool } from "@/lib/sandbox";

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireSandboxAdministrator(request);
    return jsonResponse(await resetSyntheticSchool());
  } catch (error) {
    return handleApiError(error);
  }
}
