import { getSystemDatabase } from "@/lib/system-db";
import { handleApiError, jsonResponse } from "@/lib/http";

export async function GET(): Promise<Response> {
  try {
    const database = await getSystemDatabase();
    const row = await database.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    if (Number(row?.ready) !== 1) throw new Error("Database readiness probe failed.");
    return jsonResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
