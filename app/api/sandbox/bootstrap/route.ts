import { ensureStrictSameOrigin, handleApiError, jsonResponse } from "@/lib/http";
import {
  initializeSyntheticSchool,
  requireSandboxAdministrator,
  sandboxStatus,
} from "@/lib/sandbox";

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(await sandboxStatus());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    requireSandboxAdministrator(request);
    return jsonResponse(await initializeSyntheticSchool(), 201);
  } catch (error) {
    return handleApiError(error);
  }
}
