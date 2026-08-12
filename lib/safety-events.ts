import type { SessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getSystemDatabase } from "@/lib/system-db";

type EventStatus = "new" | "acknowledged" | "resolved";

interface EventRow {
  id: string;
  evidence_code: "local_crisis_rule";
  source_type: "mood" | "chat" | "voice";
  student_id: string;
  student_username: string;
  class_id: string;
  class_name: string;
  status: EventStatus;
  assigned_teacher_user_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(value)) {
    throw new ApiError(400, "安全事件编号格式不正确。");
  }
  return value;
}

function mapEvent(row: EventRow) {
  return {
    id: row.id,
    eventCode: row.evidence_code,
    sourceType: row.source_type,
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

const EVENT_SELECT = `SELECT e.id,e.evidence_code,e.source_type,
  u.id student_id,u.username student_username,c.id class_id,c.name class_name,
  e.status,e.assigned_teacher_user_id,e.created_at,e.acknowledged_at,e.resolved_at
  FROM support_events e JOIN app_users u ON u.id=e.user_id
  JOIN school_classes c ON c.id=e.class_id`;

export async function listSafetyEvents(teacherId: string, classId: string | null) {
  const database = await getSystemDatabase();
  if (classId) {
    const owned = await database.prepare(
      "SELECT id FROM school_classes WHERE id=? AND teacher_user_id=?",
    ).bind(classId, teacherId).first();
    if (!owned) throw new ApiError(404, "没有找到这个班级。");
  }
  const result = await database.prepare(`${EVENT_SELECT}
    WHERE c.teacher_user_id=? AND (? IS NULL OR e.class_id=?)
    ORDER BY CASE e.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
      e.created_at DESC LIMIT 100`).bind(teacherId, classId, classId).all<EventRow>();
  return result.results.map(mapEvent);
}

export async function updateSafetyEvent(
  teacher: SessionUser,
  value: unknown,
  status: unknown,
) {
  const id = eventId(value);
  if (status !== "acknowledged" && status !== "resolved") {
    throw new ApiError(400, "安全事件状态只能设为已确认或已结案。");
  }
  const database = await getSystemDatabase();
  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE support_events SET
    status=?,assigned_teacher_user_id=?,
    acknowledged_at=COALESCE(acknowledged_at,?),
    resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END
    WHERE id=? AND class_id IN (
      SELECT id FROM school_classes WHERE teacher_user_id=?
    )`).bind(status, teacher.id, now, status, now, id, teacher.id).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(404, "没有找到这个安全事件。");
  }
  const row = await database.prepare(`${EVENT_SELECT} WHERE e.id=?`)
    .bind(id).first<EventRow>();
  if (!row) throw new ApiError(500, "安全事件更新失败。");
  return mapEvent(row);
}
