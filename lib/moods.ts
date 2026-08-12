import { ApiError } from "@/lib/http";
import type { SafetyLevel } from "@/lib/safety";
import { getSystemDatabase } from "@/lib/system-db";

interface MoodRow {
  id: string; mood: string; mood_score: number; note: string; goal: string;
  wants_support: number; safety_level: SafetyLevel; created_at: string;
}

export interface PublicMoodEntry {
  id: string; mood: string; moodScore: number; note: string; goal: string;
  wantsSupport: boolean; safetyLevel: SafetyLevel; createdAt: string;
}

export interface NewMoodEntry {
  userId: string; classId: string; username: string; mood: string;
  moodScore: number; note: string; goal: string; wantsSupport: boolean;
  safetyLevel: SafetyLevel; supportEvidence: string | null;
}

function mapMood(row: MoodRow): PublicMoodEntry {
  return {
    id: row.id, mood: row.mood, moodScore: Number(row.mood_score),
    note: row.note, goal: row.goal, wantsSupport: Number(row.wants_support) === 1,
    safetyLevel: row.safety_level === "urgent" ? "urgent" : "normal",
    createdAt: row.created_at,
  };
}

export async function createMoodEntry(input: NewMoodEntry): Promise<PublicMoodEntry> {
  const database = await getSystemDatabase();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const statements = [database.prepare(`INSERT INTO mood_entries (
    id,participant_hash,participant_code,user_id,class_id,mood,mood_score,note,goal,
    wants_support,safety_level,support_evidence,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, `user:${input.userId}`, input.username, input.userId, input.classId,
    input.mood, input.moodScore, input.note, input.goal, input.wantsSupport ? 1 : 0,
    input.safetyLevel, input.supportEvidence, createdAt,
  )];
  if (input.safetyLevel === "urgent") {
    statements.push(database.prepare(`INSERT INTO support_events (
      id,user_id,class_id,source_type,source_id,safety_level,evidence_code,status,
      assigned_teacher_user_id,acknowledged_at,resolved_at,created_at
    ) VALUES (?,?,?,'mood',?,'urgent','local_crisis_rule','new',NULL,NULL,NULL,?)`)
      .bind(crypto.randomUUID(), input.userId, input.classId, id, createdAt));
  }
  await database.batch(statements);
  return mapMood({
    id, mood: input.mood, mood_score: input.moodScore, note: input.note,
    goal: input.goal, wants_support: input.wantsSupport ? 1 : 0,
    safety_level: input.safetyLevel, created_at: createdAt,
  });
}

export async function listMoodEntries(userId: string, limit: number): Promise<PublicMoodEntry[]> {
  const database = await getSystemDatabase();
  const result = await database.prepare(`SELECT id,mood,mood_score,note,goal,
    wants_support,safety_level,created_at FROM mood_entries
    WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(userId, limit).all<MoodRow>();
  return result.results.map(mapMood);
}

export async function deleteMoodEntries(userId: string, id?: string): Promise<number> {
  const database = await getSystemDatabase();
  const result = id
    ? await database.prepare("DELETE FROM mood_entries WHERE user_id=? AND id=?")
        .bind(userId, id).run()
    : await database.prepare("DELETE FROM mood_entries WHERE user_id=?").bind(userId).run();
  return Number(result.meta.changes ?? 0);
}

function num(value: unknown): number {
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0;
}
function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null;
}

export async function getTeacherSummary(
  teacherId: string,
  days: number,
  classId: string | null,
) {
  const database = await getSystemDatabase();
  if (classId) {
    const owned = await database.prepare(
      "SELECT id FROM school_classes WHERE id=? AND teacher_user_id=?",
    ).bind(classId, teacherId).first();
    if (!owned) throw new ApiError(404, "没有找到这个班级。");
  }
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 86_400_000).toISOString();
  const filter = `m.created_at>=? AND c.teacher_user_id=? AND m.user_id IS NOT NULL
    AND (? IS NULL OR m.class_id=?)`;
  const bind = (statement: string) => database.prepare(statement)
    .bind(since, teacherId, classId, classId);
  const results = await database.batch([
    bind(`SELECT COUNT(*) entries,COUNT(DISTINCT m.user_id) participants,
      ROUND(AVG(NULLIF(m.mood_score,0)),2) average_mood_score,
      COALESCE(SUM(CASE WHEN m.wants_support=1 THEN 1 ELSE 0 END),0) wants_support,
      COALESCE(SUM(CASE WHEN m.safety_level='urgent' THEN 1 ELSE 0 END),0) urgent
      FROM mood_entries m JOIN school_classes c ON c.id=m.class_id WHERE ${filter}`),
    bind(`SELECT m.mood,COUNT(*) count FROM mood_entries m
      JOIN school_classes c ON c.id=m.class_id WHERE ${filter}
      GROUP BY m.mood ORDER BY count DESC,m.mood ASC`),
    bind(`SELECT substr(m.created_at,1,10) date,COUNT(*) count,
      ROUND(AVG(NULLIF(m.mood_score,0)),2) average_mood_score,
      COALESCE(SUM(CASE WHEN m.wants_support=1 THEN 1 ELSE 0 END),0) wants_support,
      COALESCE(SUM(CASE WHEN m.safety_level='urgent' THEN 1 ELSE 0 END),0) urgent
      FROM mood_entries m JOIN school_classes c ON c.id=m.class_id WHERE ${filter}
      GROUP BY substr(m.created_at,1,10) ORDER BY date ASC`),
    bind(`SELECT m.id,u.id student_id,u.username,m.class_id,m.mood,m.mood_score,
      m.wants_support,m.safety_level,m.created_at
      FROM mood_entries m JOIN school_classes c ON c.id=m.class_id
      JOIN app_users u ON u.id=m.user_id WHERE ${filter}
      AND (m.wants_support=1 OR m.safety_level='urgent')
      ORDER BY m.created_at DESC,m.id DESC LIMIT 50`),
  ]);
  const totals = (results[0].results as Array<Record<string, unknown>>)[0] ?? {};
  return {
    generatedAt: generatedAt.toISOString(),
    range: { days, since },
    ...(classId ? { classId } : {}),
    totals: {
      entries: num(totals.entries), participants: num(totals.participants),
      averageMoodScore: nullableNum(totals.average_mood_score),
      wantsSupport: num(totals.wants_support), urgent: num(totals.urgent),
    },
    moodCounts: (results[1].results as Array<Record<string, unknown>>).map((row) => ({
      mood: String(row.mood), count: num(row.count),
    })),
    daily: (results[2].results as Array<Record<string, unknown>>).map((row) => ({
      date: String(row.date), count: num(row.count),
      averageMoodScore: nullableNum(row.average_mood_score),
      wantsSupport: num(row.wants_support), urgent: num(row.urgent),
    })),
    alerts: (results[3].results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id),
      participantCode: String(row.username), classId: String(row.class_id),
      sourceType: "mood" as const, mood: String(row.mood),
      moodScore: num(row.mood_score), wantsSupport: num(row.wants_support) === 1,
      safetyLevel: row.safety_level === "urgent" ? "urgent" as const : "normal" as const,
      createdAt: String(row.created_at),
    })),
  };
}
