import type { SessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getSystemDatabase } from "@/lib/system-db";
import { getRuntimeEnv } from "@/db";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";

const SESSION_MILLISECONDS = 15 * 60_000;
const MAX_STUDENT_TURNS = 12;
const STALE_PENDING_MILLISECONDS = 30_000;

interface ConversationRow {
  id: string;
  user_id: string;
  class_id: string;
  started_at: string;
  expires_at: string;
  student_turns: number;
  in_flight: number;
  lease_token: string | null;
  ended_reason: "expired" | "turn_limit" | "urgent" | "student_deleted" | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "local_safety";
  content: string;
  safety_level: "normal" | "urgent";
  created_at: string;
}

function mapConversation(row: ConversationRow) {
  return {
    id: row.id,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    studentTurns: Number(row.student_turns),
    ended: Boolean(row.ended_at),
    endedReason: row.ended_reason,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    safetyLevel: row.safety_level,
    createdAt: row.created_at,
  };
}

function validConversationId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(value)) {
    throw new ApiError(400, "对话编号格式不正确。");
  }
  return value;
}

async function closeExpiredOpenConversation(userId: string, now: string): Promise<void> {
  const database = await getSystemDatabase();
  await database.prepare(`UPDATE chat_conversations SET ended_reason='expired',
    ended_at=?,updated_at=?,in_flight=0,pending_since=NULL,lease_token=NULL
    WHERE user_id=? AND ended_at IS NULL AND expires_at<=? AND (?=0 OR synthetic=1)`)
    .bind(now, now, userId, now, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).run();
}

export async function getOrCreateConversation(
  user: SessionUser,
  requestedId: unknown,
): Promise<ConversationRow> {
  if (!user.classId) throw new ApiError(403, "学生账号尚未分配班级。");
  const database = await getSystemDatabase();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  await closeExpiredOpenConversation(user.id, now);
  const requested = validConversationId(requestedId);
  let row: ConversationRow | null = null;
  if (requested) {
    row = await database
      .prepare("SELECT * FROM chat_conversations WHERE id=? AND user_id=? AND (?=0 OR synthetic=1)")
      .bind(requested, user.id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0)
      .first<ConversationRow>();
    if (!row) throw new ApiError(404, "没有找到这段对话。");
  } else {
    row = await database.prepare(`SELECT * FROM chat_conversations
      WHERE user_id=? AND ended_at IS NULL AND (?=0 OR synthetic=1)
      ORDER BY created_at DESC LIMIT 1`)
      .bind(user.id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).first<ConversationRow>();
  }
  if (row) {
    if (row.ended_at || row.expires_at <= now || Number(row.student_turns) >= MAX_STUDENT_TURNS) {
      throw new ApiError(409, "这段对话已经结束，请开始一段新对话。");
    }
    return row;
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(nowDate.getTime() + SESSION_MILLISECONDS).toISOString();
  try {
    await database.prepare(`INSERT INTO chat_conversations (
      id,user_id,class_id,started_at,expires_at,student_turns,in_flight,pending_since,lease_token,
    ended_reason,ended_at,synthetic,created_at,updated_at
    ) VALUES (?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,?,?,?)`)
      .bind(id, user.id, user.classId, now, expiresAt, user.synthetic ? 1 : 0, now, now).run();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/iu.test(error.message)) {
      const raced = await database.prepare(`SELECT * FROM chat_conversations
        WHERE user_id=? AND ended_at IS NULL AND (?=0 OR synthetic=1)
        ORDER BY created_at DESC LIMIT 1`)
        .bind(user.id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).first<ConversationRow>();
      if (raced) return raced;
    }
    throw error;
  }
  const created = await database.prepare("SELECT * FROM chat_conversations WHERE id=? AND (?=0 OR synthetic=1)")
    .bind(id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).first<ConversationRow>();
  if (!created) throw new ApiError(500, "对话创建失败。");
  return created;
}

/** Atomically reserves one provider call. Failed calls still consume the slot. */
export async function reserveTurn(
  user: SessionUser,
  conversation: ConversationRow,
): Promise<{ studentTurns: number; leaseToken: string }> {
  const database = await getSystemDatabase();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const staleBefore = new Date(nowDate.getTime() - STALE_PENDING_MILLISECONDS).toISOString();
  const leaseToken = crypto.randomUUID();
  const result = await database.prepare(`UPDATE chat_conversations SET
    student_turns=student_turns+1,in_flight=1,pending_since=?,lease_token=?,updated_at=?
    WHERE id=? AND user_id=? AND class_id=? AND ended_at IS NULL AND expires_at>?
      AND student_turns<? AND (in_flight=0 OR pending_since<?)
      AND (?=0 OR synthetic=1)`)
    .bind(
      now,
      leaseToken,
      now,
      conversation.id,
      user.id,
      user.classId,
      now,
      MAX_STUDENT_TURNS,
      staleBefore,
      isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0,
    ).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "对话正在回复或已经达到时长/轮次限制。");
  }
  const row = await database.prepare("SELECT student_turns FROM chat_conversations WHERE id=? AND (?=0 OR synthetic=1)")
    .bind(conversation.id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0)
    .first<{ student_turns: number }>();
  return { studentTurns: Number(row?.student_turns ?? MAX_STUDENT_TURNS), leaseToken };
}

export async function saveUserMessage(
  user: SessionUser,
  conversationId: string,
  leaseToken: string,
  content: string,
  urgent: boolean,
): Promise<void> {
  const database = await getSystemDatabase();
  const result = await database.prepare(`INSERT INTO chat_messages
    (id,conversation_id,user_id,role,content,safety_level,synthetic,created_at)
    SELECT ?,?,?,'user',?,?,?,? WHERE EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id=? AND user_id=? AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1)
    )`)
    .bind(
      crypto.randomUUID(), conversationId, user.id, content,
      urgent ? "urgent" : "normal", user.synthetic ? 1 : 0,
      new Date().toISOString(),
      conversationId, user.id, leaseToken, user.synthetic ? 1 : 0,
    ).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "This conversation request is no longer active.");
  }
}

export async function saveUrgentConversation(
  user: SessionUser,
  conversationId: string,
  leaseToken: string,
  studentContent: string,
  localReply: string,
): Promise<ConversationRow> {
  if (!user.classId) throw new ApiError(403, "Student class is unavailable.");
  const database = await getSystemDatabase();
  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare(`INSERT INTO chat_messages
      (id,conversation_id,user_id,role,content,safety_level,synthetic,created_at)
      SELECT ?,?,?,'user',?,'urgent',?,? WHERE EXISTS (
        SELECT 1 FROM chat_conversations WHERE id=? AND user_id=?
          AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1)
      )`).bind(
        crypto.randomUUID(), conversationId, user.id, studentContent, user.synthetic ? 1 : 0, now,
        conversationId, user.id, leaseToken, user.synthetic ? 1 : 0,
      ),
    database.prepare(`INSERT INTO support_events (
      id,user_id,class_id,source_type,source_id,safety_level,evidence_code,status,
      assigned_teacher_user_id,acknowledged_at,resolved_at,synthetic,created_at
    ) SELECT ?,?,?,'chat',?,'urgent','local_crisis_rule','new',NULL,NULL,NULL,?,?
      WHERE EXISTS (SELECT 1 FROM chat_conversations WHERE id=? AND user_id=?
        AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1))`)
      .bind(
        crypto.randomUUID(), user.id, user.classId, conversationId, user.synthetic ? 1 : 0, now,
        conversationId, user.id, leaseToken, user.synthetic ? 1 : 0,
      ),
    database.prepare(`INSERT INTO chat_messages
      (id,conversation_id,user_id,role,content,safety_level,synthetic,created_at)
      SELECT ?,?,?,'local_safety',?,'urgent',?,? WHERE EXISTS (
        SELECT 1 FROM chat_conversations WHERE id=? AND user_id=?
          AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1)
      )`).bind(
        crypto.randomUUID(), conversationId, user.id, localReply, user.synthetic ? 1 : 0, now,
        conversationId, user.id, leaseToken, user.synthetic ? 1 : 0,
      ),
    database.prepare(`UPDATE chat_conversations SET in_flight=0,pending_since=NULL,
      lease_token=NULL,ended_reason='urgent',ended_at=?,updated_at=?
      WHERE id=? AND user_id=? AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1)`)
      .bind(now, now, conversationId, user.id, leaseToken, user.synthetic ? 1 : 0),
  ]);
  if (
    results.some(
      (result: { meta: { changes?: number } }) =>
        Number(result.meta.changes ?? 0) !== 1,
    )
  ) {
    throw new ApiError(409, "This conversation request is no longer active.");
  }
  const updated = await database.prepare("SELECT * FROM chat_conversations WHERE id=? AND user_id=? AND (?=0 OR synthetic=1)")
    .bind(conversationId, user.id, user.synthetic ? 1 : 0).first<ConversationRow>();
  if (!updated || updated.ended_reason !== "urgent") {
    throw new ApiError(500, "Urgent conversation could not be closed safely.");
  }
  return updated;
}

export async function saveAssistantAndFinish(
  user: SessionUser,
  conversationId: string,
  leaseToken: string,
  content: string,
  urgent: boolean,
): Promise<ConversationRow> {
  const database = await getSystemDatabase();
  const now = new Date().toISOString();
  const row = await database.prepare("SELECT student_turns FROM chat_conversations WHERE id=? AND (?=0 OR synthetic=1)")
    .bind(conversationId, user.synthetic ? 1 : 0).first<{ student_turns: number }>();
  const turnLimit = Number(row?.student_turns ?? 0) >= MAX_STUDENT_TURNS;
  const results = await database.batch([
    database.prepare(`INSERT INTO chat_messages
      (id,conversation_id,user_id,role,content,safety_level,synthetic,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM chat_conversations WHERE id=? AND user_id=?
          AND in_flight=1 AND lease_token=? AND (?=0 OR synthetic=1)
      )`).bind(
        crypto.randomUUID(), conversationId, user.id,
        urgent ? "local_safety" : "assistant", content,
        urgent ? "urgent" : "normal", user.synthetic ? 1 : 0, now,
        conversationId, user.id, leaseToken, user.synthetic ? 1 : 0,
      ),
    database.prepare(`UPDATE chat_conversations SET
      in_flight=0,pending_since=NULL,lease_token=NULL,
      ended_reason=CASE WHEN ?=1 THEN 'urgent' WHEN ?=1 THEN 'turn_limit' ELSE ended_reason END,
      ended_at=CASE WHEN ?=1 OR ?=1 THEN ? ELSE ended_at END,
      updated_at=? WHERE id=? AND user_id=? AND in_flight=1 AND lease_token=?
        AND (?=0 OR synthetic=1)`).bind(
        urgent ? 1 : 0, turnLimit ? 1 : 0,
        urgent ? 1 : 0, turnLimit ? 1 : 0, now, now, conversationId, user.id,
        leaseToken, user.synthetic ? 1 : 0,
      ),
  ]);
  if (
    Number(results[0].meta.changes ?? 0) !== 1 ||
    Number(results[1].meta.changes ?? 0) !== 1
  ) {
    throw new ApiError(409, "This conversation request is no longer active.");
  }
  const updated = await database.prepare("SELECT * FROM chat_conversations WHERE id=? AND (?=0 OR synthetic=1)")
    .bind(conversationId, user.synthetic ? 1 : 0).first<ConversationRow>();
  if (!updated) throw new ApiError(500, "对话状态更新失败。");
  return updated;
}

export async function releaseFailedTurn(
  userId: string,
  conversationId: string,
  leaseToken: string,
): Promise<void> {
  const database = await getSystemDatabase();
  await database.prepare(`UPDATE chat_conversations SET in_flight=0,pending_since=NULL,
    lease_token=NULL,updated_at=? WHERE id=? AND user_id=? AND lease_token=?
      AND (?=0 OR synthetic=1)`).bind(
      new Date().toISOString(), conversationId, userId, leaseToken,
      isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0,
    ).run();
}

export async function recordUrgentEvent(
  user: SessionUser,
  sourceType: "mood" | "chat" | "voice",
  sourceId: string | null,
): Promise<void> {
  if (!user.classId) return;
  const database = await getSystemDatabase();
  await database.prepare(`INSERT INTO support_events (
    id,user_id,class_id,source_type,source_id,safety_level,evidence_code,status,
    assigned_teacher_user_id,acknowledged_at,resolved_at,synthetic,created_at
  ) VALUES (?,?,?,?,?,'urgent','local_crisis_rule','new',NULL,NULL,NULL,?,?)`)
    .bind(
      crypto.randomUUID(), user.id, user.classId, sourceType, sourceId, user.synthetic ? 1 : 0,
      new Date().toISOString(),
    ).run();
}

export async function recentHistory(conversationId: string, userId: string) {
  const database = await getSystemDatabase();
  const result = await database.prepare(`SELECT role,content FROM (
    SELECT role,content,created_at,id FROM chat_messages
    WHERE conversation_id=? AND user_id=? AND role IN ('user','assistant')
      AND (?=0 OR synthetic=1)
    ORDER BY created_at DESC,id DESC LIMIT 12
  ) ORDER BY created_at ASC,id ASC`).bind(
    conversationId, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0,
  )
    .all<{ role: "user" | "assistant"; content: string }>();
  return result.results.map((row: { role: "user" | "assistant"; content: string }) => ({
    role: row.role,
    content: row.content,
  }));
}

export async function listConversations(userId: string) {
  const database = await getSystemDatabase();
  const result = await database.prepare(`SELECT * FROM chat_conversations
    WHERE user_id=? AND (?=0 OR synthetic=1) ORDER BY created_at DESC LIMIT 50`)
    .bind(userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).all<ConversationRow>();
  return result.results.map(mapConversation);
}

export async function getConversation(userId: string, conversationIdValue: unknown) {
  const conversationId = validConversationId(conversationIdValue);
  if (!conversationId) throw new ApiError(400, "请提供对话编号。");
  const database = await getSystemDatabase();
  const conversation = await database.prepare(`SELECT * FROM chat_conversations
    WHERE id=? AND user_id=? AND (?=0 OR synthetic=1)`)
    .bind(conversationId, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0)
    .first<ConversationRow>();
  if (!conversation) throw new ApiError(404, "没有找到这段对话。");
  const result = await database.prepare(`SELECT id,conversation_id,role,content,
    safety_level,created_at FROM chat_messages WHERE conversation_id=? AND user_id=?
      AND (?=0 OR synthetic=1)
    ORDER BY created_at ASC,id ASC`).bind(
      conversationId, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0,
    ).all<MessageRow>();
  return { conversation: mapConversation(conversation), messages: result.results.map(mapMessage) };
}

export async function deleteConversations(userId: string, requestedId: unknown): Promise<number> {
  const conversationId = validConversationId(requestedId);
  const database = await getSystemDatabase();
  const rows = conversationId
    ? await database.prepare("SELECT id FROM chat_conversations WHERE id=? AND user_id=? AND (?=0 OR synthetic=1)")
        .bind(conversationId, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).all<{ id: string }>()
    : await database.prepare("SELECT id FROM chat_conversations WHERE user_id=? AND (?=0 OR synthetic=1)")
        .bind(userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).all<{ id: string }>();
  if (rows.results.length === 0) return 0;
  const ids = rows.results.map((row: { id: string }) => row.id);
  for (const conversation of ids) {
    await database.batch([
      database.prepare("DELETE FROM chat_messages WHERE conversation_id=? AND user_id=? AND (?=0 OR synthetic=1)")
        .bind(conversation, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0),
      database.prepare("DELETE FROM chat_conversations WHERE id=? AND user_id=? AND (?=0 OR synthetic=1)")
        .bind(conversation, userId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0),
    ]);
  }
  return ids.length;
}

export async function exportConversations(userId: string) {
  const conversations = await listConversations(userId);
  const exported = [];
  for (const conversation of conversations) {
    exported.push(await getConversation(userId, conversation.id));
  }
  return { exportedAt: new Date().toISOString(), conversations: exported };
}

export { mapConversation };
