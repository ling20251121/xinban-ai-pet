import {
  ApiError,
  ensureStrictSameOrigin,
  handleApiError,
} from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    throw new ApiError(410, "独立演示区已停用；请在正式案例内完成固定合成多轮对话评价。");
  } catch (error) {
    return handleApiError(error);
  }
}
