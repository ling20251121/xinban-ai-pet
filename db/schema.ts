import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Anonymous daily check-ins. `participantCode` is a pseudonym rather than a
 * real-world identity; `participantHash` is used for ownership lookups.
 *
 * `supportEvidence` is deliberately separate from the private note/goal. It is
 * populated only for a support request or an urgent safety signal, allowing the
 * teacher endpoint to aggregate ordinary entries without selecting their text.
 */
export const moodEntries = sqliteTable(
  "mood_entries",
  {
    id: text("id").primaryKey(),
    participantHash: text("participant_hash").notNull(),
    participantCode: text("participant_code").notNull(),
    mood: text("mood").notNull(),
    moodScore: integer("mood_score").notNull(),
    note: text("note").notNull().default(""),
    goal: text("goal").notNull().default(""),
    wantsSupport: integer("wants_support", { mode: "boolean" })
      .notNull()
      .default(false),
    safetyLevel: text("safety_level", { enum: ["normal", "urgent"] })
      .notNull()
      .default("normal"),
    supportEvidence: text("support_evidence"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    check(
      "mood_entries_score_check",
      sql`${table.moodScore} BETWEEN 0 AND 5`,
    ),
    check(
      "mood_entries_support_check",
      sql`${table.wantsSupport} IN (0, 1)`,
    ),
    check(
      "mood_entries_safety_check",
      sql`${table.safetyLevel} IN ('normal', 'urgent')`,
    ),
    index("idx_mood_entries_participant_created").on(
      table.participantHash,
      table.createdAt,
    ),
    index("idx_mood_entries_created").on(table.createdAt),
    index("idx_mood_entries_flagged_created")
      .on(table.createdAt)
      .where(
        sql`${table.wantsSupport} = 1 OR ${table.safetyLevel} = 'urgent'`,
      ),
  ],
);

export type MoodEntry = typeof moodEntries.$inferSelect;
