const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.name = "ApiError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: { ...JSON_HEADERS, ...Object.fromEntries(new Headers(headers)) },
  });
}

export function handleApiError(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.publicMessage }, error.status);
  }

  if (
    error instanceof Error &&
    error.name === "DatabaseUnavailableError"
  ) {
    return jsonResponse({ error: "心情记录服务暂时不可用，请稍后再试。" }, 503);
  }

  // Never return database, provider, or request-body details to the browser.
  return jsonResponse({ error: "服务暂时开小差了，请稍后再试。" }, 500);
}

export function ensureSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new ApiError(403, "这个请求不是从当前网站发出的。");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, "请求来源无效。");
  }
}

/** Cookie-authenticated mutations require an explicit, exact Origin. */
export function ensureStrictSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "缺少请求来源，已拒绝此次操作。");

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new ApiError(403, "这个请求不是从当前网站发出的。");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, "请求来源无效。");
  }
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = 16_384,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "请使用 JSON 格式提交。");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "提交的内容太长了。");
  }

  if (!request.body) {
    throw new ApiError(400, "请求内容不能为空。");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "提交的内容太长了。");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "JSON 内容无法识别。");
  }
}
