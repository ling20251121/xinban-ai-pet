import {
  type AgeBand,
  type SessionUser,
  consumeAuthRateLimit,
  hashPassword,
  normalizeSchoolUsername,
  validateDisplayName,
  validatePassword,
} from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getSystemDatabase } from "@/lib/system-db";
import { getRuntimeEnv } from "@/db";
import {
  isAdultEvaluationOnly,
  isPublicDemoMode,
  isSyntheticSchoolSandbox,
} from "@/lib/public-demo";

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new ApiError(400, `${label}格式不正确。`);
  const cleaned = value.replaceAll(String.fromCharCode(0), "").trim();
  if (!cleaned || Array.from(cleaned).length > max) {
    throw new ApiError(400, `${label}需为 1–${max} 个字符。`);
  }
  return cleaned;
}

function id(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  if (!/^[A-Za-z0-9-]+$/u.test(parsed)) throw new ApiError(400, `${label}格式不正确。`);
  return parsed;
}

function phone(value: unknown): string {
  const parsed = text(value, "安全联系人电话", 32);
  if (!/^[0-9+() -]{5,32}$/u.test(parsed)) {
    throw new ApiError(400, "安全联系人电话格式不正确。");
  }
  return parsed;
}

interface ClassRow {
  id: string;
  name: string;
  active: number;
  safety_contact_name: string;
  safety_contact_phone: string;
  created_at: string;
  student_count: number;
  synthetic: number;
}

interface StudentRow {
  id: string;
  username: string;
  display_name: string;
  class_id: string;
  age_band: AgeBand;
  active: number;
  must_change_password: number;
  guardian_consent_verified_at: string | null;
  student_consented_at: string | null;
  student_consent_version: string | null;
  student_consent_withdrawn_at: string | null;
  created_at: string;
  synthetic: number;
}

function mapClass(row: ClassRow) {
  return {
    id: row.id,
    name: row.name,
    active: Number(row.active) === 1,
    safetyContactName: row.safety_contact_name,
    safetyContactPhone: row.safety_contact_phone,
    studentCount: Number(row.student_count ?? 0),
    createdAt: row.created_at,
    synthetic: Number(row.synthetic) === 1,
  };
}

function mapStudent(row: StudentRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    classId: row.class_id,
    ageBand: row.age_band,
    active: Number(row.active) === 1,
    mustChangePassword: Number(row.must_change_password) === 1,
    guardianConsentVerified: Boolean(row.guardian_consent_verified_at),
    studentConsented:
      Boolean(row.student_consented_at) &&
      !row.student_consent_withdrawn_at &&
      Boolean(row.student_consent_version),
    createdAt: row.created_at,
    synthetic: Number(row.synthetic) === 1,
  };
}

async function requireOwnedClass(teacherId: string, classId: string) {
  const database = await getSystemDatabase();
  const classroom = await database
    .prepare("SELECT id,active,synthetic FROM school_classes WHERE id=? AND teacher_user_id=?")
    .bind(classId, teacherId)
    .first<{ id: string; active: number; synthetic: number }>();
  if (!classroom) throw new ApiError(404, "没有找到这个班级。");
  if (Number(classroom.active) !== 1) throw new ApiError(409, "这个班级已停用。");
  if (isSyntheticSchoolSandbox(getRuntimeEnv()) && Number(classroom.synthetic) !== 1) {
    throw new ApiError(404, "没有找到这个合成班级。");
  }
  return classroom;
}

export async function createClass(
  teacher: SessionUser,
  input: Record<string, unknown>,
) {
  if (isSyntheticSchoolSandbox(getRuntimeEnv())) {
    throw new ApiError(403, "合成沙盒的班级由受保护的初始化接口创建，不能输入现实学校信息。");
  }
  const name = text(input.name, "班级名称", 60);
  const contactName = text(input.safetyContactName, "安全联系人姓名", 40);
  const contactPhone = phone(input.safetyContactPhone);
  const database = await getSystemDatabase();
  const classId = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO school_classes
    (id,teacher_user_id,name,safety_contact_name,safety_contact_phone,synthetic,active,created_at,updated_at)
    VALUES (?,?,?,?,?,0,1,?,?)`)
    .bind(classId, teacher.id, name, contactName, contactPhone, now, now).run();
  return {
    id: classId,
    name,
    active: true,
    safetyContactName: contactName,
    safetyContactPhone: contactPhone,
    studentCount: 0,
    synthetic: false,
    createdAt: now,
  };
}

export async function listClasses(teacherId: string) {
  const database = await getSystemDatabase();
  const result = await database.prepare(`SELECT c.id,c.name,c.active,
    c.safety_contact_name,c.safety_contact_phone,c.synthetic,c.created_at,
    COUNT(CASE WHEN u.role='student' THEN 1 END) AS student_count
    FROM school_classes c LEFT JOIN app_users u ON u.class_id=c.id
    WHERE c.teacher_user_id=? AND (?=0 OR c.synthetic=1)
    GROUP BY c.id ORDER BY c.created_at DESC`)
    .bind(teacherId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).all<ClassRow>();
  return result.results.map(mapClass);
}

export async function createStudent(
  request: Request,
  teacher: SessionUser,
  input: Record<string, unknown>,
) {
  const runtime = getRuntimeEnv();
  if (isSyntheticSchoolSandbox(runtime)) {
    throw new ApiError(403, "合成沙盒账号只能由受保护的初始化接口生成。");
  }
  if (isAdultEvaluationOnly(runtime) || isPublicDemoMode(runtime)) {
    throw new ApiError(403, "公开演示模式不允许创建真实学生账号。");
  }
  const classId = id(input.classId, "班级编号");
  await requireOwnedClass(teacher.id, classId);
  const username = normalizeSchoolUsername(input.username);
  await consumeAuthRateLimit(request, "create-student", teacher.id, 30, 60 * 60);
  const password = validatePassword(input.password);
  const displayName = validateDisplayName(input.displayName, username);
  if (input.ageBand !== "under14" && input.ageBand !== "14plus") {
    throw new ApiError(400, "请选择学生年龄段。");
  }
  if (typeof input.guardianConsentVerified !== "boolean") {
    throw new ApiError(400, "请明确监护人同意是否已核验。");
  }
  const passwordData = await hashPassword(password);
  const database = await getSystemDatabase();
  const studentId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.prepare(`INSERT INTO app_users (
      id,role,username,display_name,password_salt,password_hash,password_iterations,
      active,class_id,age_band,must_change_password,
      guardian_consent_verified_at,guardian_consent_verified_by,
      student_consented_at,student_consent_version,student_consent_withdrawn_at,
      created_by_user_id,failed_login_count,synthetic,created_at,updated_at
    ) VALUES (?,'student',?,?,?,?,?,1,?,?,1,?,?,NULL,NULL,NULL,?,0,0,?,?)`)
      .bind(
        studentId, username, displayName, passwordData.salt, passwordData.hash,
        passwordData.iterations, classId, input.ageBand,
        input.guardianConsentVerified ? now : null,
        input.guardianConsentVerified ? teacher.id : null,
        teacher.id, now, now,
      ).run();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/iu.test(error.message)) {
      throw new ApiError(409, "这个学校用户名已存在。");
    }
    throw error;
  }
  const row = await database.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(studentId).first<StudentRow>();
  if (!row) throw new ApiError(500, "学生账号创建失败。");
  return mapStudent(row);
}

export async function listStudents(teacherId: string, classIdValue: string | null) {
  const database = await getSystemDatabase();
  const classId = classIdValue ? id(classIdValue, "班级编号") : null;
  if (classId) await requireOwnedClass(teacherId, classId);
  const result = await database.prepare(`SELECT u.* FROM app_users u
    JOIN school_classes c ON c.id=u.class_id
    WHERE u.role='student' AND c.teacher_user_id=? AND (? IS NULL OR u.class_id=?)
      AND (?=0 OR (u.synthetic=1 AND c.synthetic=1))
    ORDER BY u.created_at DESC`)
    .bind(teacherId, classId, classId, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).all<StudentRow>();
  return result.results.map(mapStudent);
}

export async function updateStudent(
  teacher: SessionUser,
  input: Record<string, unknown>,
) {
  const studentId = id(input.studentId, "学生编号");
  const database = await getSystemDatabase();
  const existing = await database.prepare(`SELECT u.* FROM app_users u
    JOIN school_classes c ON c.id=u.class_id
    WHERE u.id=? AND u.role='student' AND c.teacher_user_id=?
      AND (?=0 OR (u.synthetic=1 AND c.synthetic=1))`)
    .bind(studentId, teacher.id, isSyntheticSchoolSandbox(getRuntimeEnv()) ? 1 : 0).first<StudentRow>();
  if (!existing) throw new ApiError(404, "没有找到这个学生账号。");
  if (
    input.active === undefined &&
    input.guardianConsentVerified === undefined &&
    input.password === undefined
  ) throw new ApiError(400, "没有需要更新的字段。");
  if (input.active !== undefined && typeof input.active !== "boolean") {
    throw new ApiError(400, "账号状态格式不正确。");
  }
  if (
    input.guardianConsentVerified !== undefined &&
    typeof input.guardianConsentVerified !== "boolean"
  ) throw new ApiError(400, "监护人核验状态格式不正确。");

  const now = new Date().toISOString();
  let passwordData: Awaited<ReturnType<typeof hashPassword>> | null = null;
  if (input.password !== undefined) passwordData = await hashPassword(validatePassword(input.password));
  await database.prepare(`UPDATE app_users SET
    active=COALESCE(?,active),
    guardian_consent_verified_at=CASE WHEN ? IS NULL THEN guardian_consent_verified_at
      WHEN ?=1 THEN ? ELSE NULL END,
    guardian_consent_verified_by=CASE WHEN ? IS NULL THEN guardian_consent_verified_by
      WHEN ?=1 THEN ? ELSE NULL END,
    password_salt=COALESCE(?,password_salt),password_hash=COALESCE(?,password_hash),
    password_iterations=COALESCE(?,password_iterations),
    must_change_password=CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
    updated_at=? WHERE id=?`)
    .bind(
      input.active === undefined ? null : input.active ? 1 : 0,
      input.guardianConsentVerified === undefined ? null : input.guardianConsentVerified ? 1 : 0,
      input.guardianConsentVerified ? 1 : 0, now,
      input.guardianConsentVerified === undefined ? null : input.guardianConsentVerified ? 1 : 0,
      input.guardianConsentVerified ? 1 : 0, teacher.id,
      passwordData?.salt ?? null, passwordData?.hash ?? null,
      passwordData?.iterations ?? null, passwordData?.hash ?? null, now, studentId,
    ).run();
  if (
    input.active === false ||
    input.guardianConsentVerified === false ||
    passwordData
  ) {
    await database.prepare(`UPDATE auth_sessions SET revoked_at=?
      WHERE user_id=? AND revoked_at IS NULL`).bind(now, studentId).run();
  }
  const updated = await database.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(studentId).first<StudentRow>();
  if (!updated) throw new ApiError(500, "学生账号更新失败。");
  return mapStudent(updated);
}
