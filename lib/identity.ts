import { getRuntimeEnv } from "@/db";

const encoder = new TextEncoder();

/**
 * The normalized code remains a student-facing pseudonym. A peppered digest is
 * used in ownership predicates so the lookup key is not stored directly.
 */
export async function hashParticipantCode(normalizedCode: string): Promise<string> {
  const pepper = getRuntimeEnv().PARTICIPANT_HASH_PEPPER ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${pepper}\u0000${normalizedCode}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
