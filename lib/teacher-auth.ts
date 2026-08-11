import { getRuntimeEnv } from "@/db";
import { ApiError } from "./http";

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

export async function requireTeacherAccess(request: Request): Promise<void> {
  const configuredKey = getRuntimeEnv().TEACHER_ACCESS_KEY;
  if (!configuredKey || configuredKey.length < 12) {
    throw new ApiError(503, "教师查看功能尚未配置。");
  }

  const suppliedKey = request.headers.get("x-teacher-key") ?? "";
  if (suppliedKey.length > 256 || !(await secureEqual(suppliedKey, configuredKey))) {
    throw new ApiError(401, "教师访问密钥不正确。");
  }
}
