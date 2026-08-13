import type { SessionUser } from "@/lib/auth";
import { getRuntimeEnv } from "@/db";
import { ApiError } from "@/lib/http";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";
import { getSystemDatabase } from "@/lib/system-db";

type AttentionEventStatus = "new" | "acknowledged" | "resolved";

interface AttentionEventRow {
  id: string;
  kind: "long_chat_session" | "student_support_request";
  source_type: "chat" | "mood";
  source_id: string;
  student_id: string;
  student_username: string;
  class_id: string;
  class_name: string;
  status: AttentionEventStatus;
  assigned_teacher_user_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

function parseEventId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(value)) {
    throw new ApiError(400, "关注提示编号格式不正确。");
  }
  return value;
}

function mapAttentionEvent(row: AttentionEventRow) {
  return {
    id: row.id,
    kind: row.kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    studentId: row.student_id,
    studentUsername: row.student_username,
    classId: row.class_id,
    className: row.class_name,
    status: row.status,
    assignedTeacherUserId: row.assigned_teacher_user_id,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
  };
}

const EVENT_SELECT = `SELECT e.id,e.kind,e.source_type,e.source_id,
  u.id student_id,u.username student_username,c.id class_id,c.name class_name,
  e.status,e.assigned_teacher_user_id,e.created_at,e.acknowledged_at,e.resolved_at
  FROM teacher_attention_events e
  JOIN app_users u ON u.id=e.user_id
  JOIN school_classes c ON c.id=e.class_id`;

export async function listAttentionEvents(teacherId: string, classId: string | null) {
  const database = await getSystemDatabase();
  const sandboxOnly = isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0;
  if (classId) {
    const owned = await database.prepare(
      "SELECT id FROM school_classes WHERE id=? AND teacher_user_id=? AND (?=0 OR synthetic=1)",
    ).bind(classId, teacherId, sandboxOnly).first();
    if (!owned) throw new ApiError(404, "没有找到这个班级。");
  }
  const result = await database.prepare(`${EVENT_SELECT}
    WHERE c.teacher_user_id=? AND (? IS NULL OR e.class_id=?)
      AND (?=0 OR (e.synthetic=1 AND u.synthetic=1 AND c.synthetic=1))
    ORDER BY CASE e.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
      CASE e.kind WHEN 'student_support_request' THEN 0 ELSE 1 END,
      e.created_at DESC LIMIT 100`).bind(
        teacherId, classId, classId, sandboxOnly,
      ).all<AttentionEventRow>();
  return result.results.map(mapAttentionEvent);
}

export async function updateAttentionEvent(
  teacher: SessionUser,
  value: unknown,
  status: unknown,
) {
  const id = parseEventId(value);
  if (status !== "acknowledged" && status !== "resolved") {
    throw new ApiError(400, "关注提示状态只能设为已查看或已完成。");
  }
  const database = await getSystemDatabase();
  const sandboxOnly = isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0;
  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE teacher_attention_events SET
    status=?,assigned_teacher_user_id=?,
    acknowledged_at=COALESCE(acknowledged_at,?),
    resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END
    WHERE id=?
      AND ((?='acknowledged' AND status='new') OR (?='resolved' AND status='acknowledged'))
      AND (?=0 OR synthetic=1) AND class_id IN (
        SELECT id FROM school_classes
        WHERE teacher_user_id=? AND (?=0 OR synthetic=1)
      )`).bind(
        status, teacher.id, now, status, now, id,
        status, status, sandboxOnly, teacher.id, sandboxOnly,
      ).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(404, "没有找到可更新的关注提示。");
  }
  const row = await database.prepare(`${EVENT_SELECT}
    WHERE e.id=? AND c.teacher_user_id=?
      AND (?=0 OR (e.synthetic=1 AND u.synthetic=1 AND c.synthetic=1))`)
    .bind(id, teacher.id, sandboxOnly).first<AttentionEventRow>();
  if (!row) throw new ApiError(500, "关注提示更新失败。");
  return mapAttentionEvent(row);
}
