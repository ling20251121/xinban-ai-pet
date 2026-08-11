import { getD1 } from "@/db";
import type { SafetyLevel } from "./safety";

const CREATE_MOOD_ENTRIES_SQL = `
  CREATE TABLE IF NOT EXISTS mood_entries (
    id TEXT PRIMARY KEY,
    participant_hash TEXT NOT NULL,
    participant_code TEXT NOT NULL,
    mood TEXT NOT NULL,
    mood_score INTEGER NOT NULL CHECK (mood_score BETWEEN 0 AND 5),
    note TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    wants_support INTEGER NOT NULL DEFAULT 0 CHECK (wants_support IN (0, 1)),
    safety_level TEXT NOT NULL DEFAULT 'normal' CHECK (safety_level IN ('normal', 'urgent')),
    support_evidence TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`;

const CREATE_PARTICIPANT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_mood_entries_participant_created
  ON mood_entries (participant_hash, created_at)
`;

const CREATE_CREATED_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_mood_entries_created
  ON mood_entries (created_at)
`;

const CREATE_FLAGGED_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_mood_entries_flagged_created
  ON mood_entries (created_at)
  WHERE wants_support = 1 OR safety_level = 'urgent'
`;

let schemaReady: Promise<void> | undefined;

async function getReadyDatabase(): Promise<D1Database> {
  const database = getD1();
  schemaReady ??= (async () => {
    await database.batch([
      database.prepare(CREATE_MOOD_ENTRIES_SQL),
      database.prepare(CREATE_PARTICIPANT_INDEX_SQL),
      database.prepare(CREATE_CREATED_INDEX_SQL),
      database.prepare(CREATE_FLAGGED_INDEX_SQL),
      database.prepare("PRAGMA optimize"),
    ]);
  })();

  try {
    await schemaReady;
  } catch (error) {
    schemaReady = undefined;
    throw error;
  }
  return database;
}

interface MoodRow {
  id: string;
  mood: string;
  mood_score: number;
  note: string;
  goal: string;
  wants_support: number;
  safety_level: SafetyLevel;
  created_at: string;
}

export interface PublicMoodEntry {
  id: string;
  mood: string;
  moodScore: number;
  note: string;
  goal: string;
  wantsSupport: boolean;
  safetyLevel: SafetyLevel;
  createdAt: string;
}

export interface NewMoodEntry {
  participantHash: string;
  participantCode: string;
  mood: string;
  moodScore: number;
  note: string;
  goal: string;
  wantsSupport: boolean;
  safetyLevel: SafetyLevel;
  supportEvidence: string | null;
}

function mapMoodRow(row: MoodRow): PublicMoodEntry {
  return {
    id: row.id,
    mood: row.mood,
    moodScore: Number(row.mood_score),
    note: row.note,
    goal: row.goal,
    wantsSupport: Number(row.wants_support) === 1,
    safetyLevel: row.safety_level === "urgent" ? "urgent" : "normal",
    createdAt: row.created_at,
  };
}

export async function createMoodEntry(input: NewMoodEntry): Promise<PublicMoodEntry> {
  const database = await getReadyDatabase();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await database
    .prepare(`
      INSERT INTO mood_entries (
        id, participant_hash, participant_code, mood, mood_score, note, goal,
        wants_support, safety_level, support_evidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      input.participantHash,
      input.participantCode,
      input.mood,
      input.moodScore,
      input.note,
      input.goal,
      input.wantsSupport ? 1 : 0,
      input.safetyLevel,
      input.supportEvidence,
      createdAt,
    )
    .run();

  return {
    id,
    mood: input.mood,
    moodScore: input.moodScore,
    note: input.note,
    goal: input.goal,
    wantsSupport: input.wantsSupport,
    safetyLevel: input.safetyLevel,
    createdAt,
  };
}

export async function listMoodEntries(
  participantHash: string,
  limit: number,
): Promise<PublicMoodEntry[]> {
  const database = await getReadyDatabase();
  const result = await database
    .prepare(`
      SELECT id, mood, mood_score, note, goal, wants_support, safety_level, created_at
      FROM mood_entries
      WHERE participant_hash = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .bind(participantHash, limit)
    .all<MoodRow>();

  return result.results.map(mapMoodRow);
}

export async function deleteMoodEntries(
  participantHash: string,
  id?: string,
): Promise<number> {
  const database = await getReadyDatabase();
  const statement = id
    ? database
        .prepare("DELETE FROM mood_entries WHERE participant_hash = ? AND id = ?")
        .bind(participantHash, id)
    : database
        .prepare("DELETE FROM mood_entries WHERE participant_hash = ?")
        .bind(participantHash);
  const result = await statement.run();
  return Number(result.meta.changes ?? 0);
}

interface TotalsRow {
  entries: number;
  participants: number;
  average_mood_score: number | null;
  wants_support: number;
  urgent: number;
}

interface MoodCountRow {
  mood: string;
  count: number;
}

interface DailyRow {
  date: string;
  count: number;
  average_mood_score: number | null;
  wants_support: number;
  urgent: number;
}

interface AlertRow {
  id: string;
  participant_code: string;
  mood: string;
  mood_score: number;
  wants_support: number;
  safety_level: SafetyLevel;
  support_evidence: string | null;
  created_at: string;
}

export interface TeacherSummary {
  generatedAt: string;
  range: { days: number; since: string };
  totals: {
    entries: number;
    participants: number;
    averageMoodScore: number | null;
    wantsSupport: number;
    urgent: number;
  };
  moodCounts: Array<{ mood: string; count: number }>;
  daily: Array<{
    date: string;
    count: number;
    averageMoodScore: number | null;
    wantsSupport: number;
    urgent: number;
  }>;
  alerts: Array<{
    id: string;
    participantCode: string;
    mood: string;
    moodScore: number;
    wantsSupport: boolean;
    safetyLevel: SafetyLevel;
    evidence: string | null;
    createdAt: string;
  }>;
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getTeacherSummary(days: number): Promise<TeacherSummary> {
  const database = await getReadyDatabase();
  const generatedAt = new Date();
  const sinceDate = new Date(generatedAt.getTime() - days * 86_400_000);
  const since = sinceDate.toISOString();

  const batchResults = await database.batch([
    database.prepare(`
      SELECT
        COUNT(*) AS entries,
        COUNT(DISTINCT participant_hash) AS participants,
        ROUND(AVG(NULLIF(mood_score, 0)), 2) AS average_mood_score,
        COALESCE(SUM(CASE WHEN wants_support = 1 THEN 1 ELSE 0 END), 0) AS wants_support,
        COALESCE(SUM(CASE WHEN safety_level = 'urgent' THEN 1 ELSE 0 END), 0) AS urgent
      FROM mood_entries
      WHERE created_at >= ?
    `).bind(since),
    database.prepare(`
      SELECT mood, COUNT(*) AS count
      FROM mood_entries
      WHERE created_at >= ?
      GROUP BY mood
      ORDER BY count DESC, mood ASC
    `).bind(since),
    database.prepare(`
      SELECT
        substr(created_at, 1, 10) AS date,
        COUNT(*) AS count,
        ROUND(AVG(NULLIF(mood_score, 0)), 2) AS average_mood_score,
        COALESCE(SUM(CASE WHEN wants_support = 1 THEN 1 ELSE 0 END), 0) AS wants_support,
        COALESCE(SUM(CASE WHEN safety_level = 'urgent' THEN 1 ELSE 0 END), 0) AS urgent
      FROM mood_entries
      WHERE created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).bind(since),
    database.prepare(`
      SELECT
        id, participant_code, mood, mood_score, wants_support, safety_level,
        support_evidence, created_at
      FROM mood_entries
      WHERE created_at >= ?
        AND (wants_support = 1 OR safety_level = 'urgent')
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `).bind(since),
  ]);

  const totalsRows = batchResults[0].results as unknown as TotalsRow[];
  const moodRows = batchResults[1].results as unknown as MoodCountRow[];
  const dailyRows = batchResults[2].results as unknown as DailyRow[];
  const alertRows = batchResults[3].results as unknown as AlertRow[];
  const totals = totalsRows[0];

  return {
    generatedAt: generatedAt.toISOString(),
    range: { days, since },
    totals: {
      entries: numberOrZero(totals?.entries),
      participants: numberOrZero(totals?.participants),
      averageMoodScore: nullableNumber(totals?.average_mood_score),
      wantsSupport: numberOrZero(totals?.wants_support),
      urgent: numberOrZero(totals?.urgent),
    },
    moodCounts: moodRows.map((row) => ({
      mood: row.mood,
      count: numberOrZero(row.count),
    })),
    daily: dailyRows.map((row) => ({
      date: row.date,
      count: numberOrZero(row.count),
      averageMoodScore: nullableNumber(row.average_mood_score),
      wantsSupport: numberOrZero(row.wants_support),
      urgent: numberOrZero(row.urgent),
    })),
    alerts: alertRows.map((row) => ({
      id: row.id,
      participantCode: row.participant_code,
      mood: row.mood,
      moodScore: numberOrZero(row.mood_score),
      wantsSupport: numberOrZero(row.wants_support) === 1,
      safetyLevel: row.safety_level === "urgent" ? "urgent" : "normal",
      evidence: row.support_evidence,
      createdAt: row.created_at,
    })),
  };
}
