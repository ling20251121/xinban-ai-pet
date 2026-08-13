import type { SessionUser } from "@/lib/auth";
import { getRuntimeEnv } from "@/db";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";
import { getSystemDatabase } from "@/lib/system-db";

/**
 * Deletes student-authored prose and mood rows in one transaction. Structured
 * safety/attention/cue records intentionally remain without source prose so a
 * school can keep the minimum follow-up audit described in the UI.
 */
export async function deleteStudentContent(user: SessionUser) {
  const database = await getSystemDatabase();
  const sandboxOnly = isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0;
  const results = await database.batch([
    database.prepare(`DELETE FROM chat_messages WHERE user_id=?
      AND (?=0 OR synthetic=1)`).bind(user.id, sandboxOnly),
    database.prepare(`DELETE FROM chat_conversations WHERE user_id=?
      AND (?=0 OR synthetic=1)`).bind(user.id, sandboxOnly),
    database.prepare(`DELETE FROM mood_entries WHERE user_id=?
      AND (?=0 OR synthetic=1)`).bind(user.id, sandboxOnly),
  ]);
  return {
    messages: Number(results[0].meta.changes ?? 0),
    conversations: Number(results[1].meta.changes ?? 0),
    moods: Number(results[2].meta.changes ?? 0),
  };
}
