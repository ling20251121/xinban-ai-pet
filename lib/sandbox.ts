import { getRuntimeEnv } from "@/db";
import { CONSENT_VERSION, hashPassword } from "@/lib/auth";
import type { SystemDatabase } from "@/lib/database-types";
import { ApiError } from "@/lib/http";
import { isSyntheticSchoolSandbox } from "@/lib/public-demo";
import { getSystemDatabase } from "@/lib/system-db";

const encoder = new TextEncoder();
const SYNTHETIC_STUDENT_COUNT = 3;
const SANDBOX_STATE_ID = "synthetic-school";

function randomText(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, bytes * 2);
}

function randomDigits(length: number): string {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => String(byte % 10)).join("");
}

function randomPassword(): string {
  return `Ai!${randomDigits(6)}Q`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function requireSandboxMode(): void {
  if (!isSyntheticSchoolSandbox(getRuntimeEnv())) {
    throw new ApiError(404, "合成学校沙盒未启用。");
  }
}

export function requireSandboxAdministrator(request: Request): void {
  requireSandboxMode();
  const configured = getRuntimeEnv().SANDBOX_ADMIN_KEY?.trim() ?? "";
  const supplied = request.headers.get("x-sandbox-admin-key")?.trim() ?? "";
  if (configured.length < 24 || !constantTimeEqual(configured, supplied)) {
    throw new ApiError(403, "沙盒管理凭据无效。");
  }
}

export async function sandboxStatus() {
  requireSandboxMode();
  const database = await getSystemDatabase();
  const result = await database.batch([
    database.prepare("SELECT COUNT(*) AS count FROM sandbox_state WHERE id=?").bind(SANDBOX_STATE_ID),
    database.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='teacher' AND synthetic=1"),
    database.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='student' AND synthetic=1"),
    database.prepare("SELECT COUNT(*) AS count FROM school_classes WHERE synthetic=1"),
  ]);
  const count = (index: number) => Number((result[index].results[0] as { count?: unknown } | undefined)?.count ?? 0);
  return {
    enabled: true,
    initialized: count(0) > 0,
    syntheticOnly: true,
    counts: { teachers: count(1), students: count(2), classes: count(3) },
  };
}

interface SyntheticAccount {
  id: string;
  username: string;
  password: string;
  displayName: string;
}

function insertUser(
  database: SystemDatabase,
  account: SyntheticAccount,
  password: Awaited<ReturnType<typeof hashPassword>>,
  input: {
    role: "teacher" | "student";
    classId: string | null;
    ageBand: "under14" | "14plus" | null;
    teacherId: string | null;
    now: string;
  },
) {
  const isStudent = input.role === "student";
  return database.prepare(`INSERT INTO app_users (
    id,role,username,display_name,password_salt,password_hash,password_iterations,
    active,class_id,age_band,must_change_password,
    guardian_consent_verified_at,guardian_consent_verified_by,
    student_consented_at,student_consent_version,student_consent_withdrawn_at,
    created_by_user_id,failed_login_count,locked_until,synthetic,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,1,?,?,0,?,?,?,?,NULL,?,0,NULL,1,?,?)`)
    .bind(
      account.id, input.role, account.username, account.displayName,
      password.salt, password.hash, password.iterations,
      input.classId, input.ageBand,
      isStudent ? input.now : null,
      isStudent ? input.teacherId : null,
      isStudent ? input.now : null,
      isStudent ? CONSENT_VERSION : null,
      input.teacherId,
      input.now, input.now,
    );
}

export async function initializeSyntheticSchool() {
  requireSandboxMode();
  const database = await getSystemDatabase();
  const suffix = randomDigits(4);
  const claimToken = randomText(16);
  const teacher: SyntheticAccount = {
    id: crypto.randomUUID(),
    username: `tea-${suffix}`,
    password: randomPassword(),
    displayName: "虚构教师·晴老师",
  };
  const students: SyntheticAccount[] = Array.from({ length: SYNTHETIC_STUDENT_COUNT }, (_, index) => ({
    id: crypto.randomUUID(),
    username: `stu${index + 1}-${suffix}`,
    password: randomPassword(),
    displayName: `虚构学生 ${String.fromCharCode(65 + index)}`,
  }));
  const scenarios = [
    { accountIndex: 0, mood: "紧张", note: "虚构情境：数学测验后有些着急。", wantsSupport: false },
    { accountIndex: 1, mood: "低落", note: "虚构情境：小组活动时觉得没被听见。", wantsSupport: true },
    { accountIndex: 2, mood: "开心", note: "虚构情境：完成了计划中的阅读任务。", wantsSupport: false },
  ] as const;
  const [teacherPassword, ...studentPasswords] = await Promise.all(
    [teacher, ...students].map((account) => hashPassword(account.password)),
  );
  const classroomId = crypto.randomUUID();
  const moodIds = scenarios.map(() => crypto.randomUUID());
  const demonstrationMoodId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    // This fixed primary-key insert is the atomic initialization claim. Both
    // D1 batch() and the PostgreSQL adapter execute the whole list in one
    // transaction, so a duplicate claim or any later failure rolls back all
    // account, mood, and event writes.
    database.prepare(`INSERT INTO sandbox_state (id,claim_token,initialized_at)
      VALUES (?,?,?)`).bind(SANDBOX_STATE_ID, claimToken, now),
    insertUser(database, teacher, teacherPassword, {
      role: "teacher", classId: null, ageBand: null, teacherId: null, now,
    }),
    database.prepare(`INSERT INTO school_classes
      (id,teacher_user_id,name,safety_contact_name,safety_contact_phone,synthetic,active,created_at,updated_at)
      SELECT ?,?,'合成演示班','虚构安全联系人','000-00000000',1,1,?,?
      WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND synthetic=1)`)
      .bind(classroomId, teacher.id, now, now, teacher.id),
    ...students.map((student, index) => insertUser(database, student, studentPasswords[index], {
      role: "student",
      classId: classroomId,
      ageBand: index === 2 ? "14plus" : "under14",
      teacherId: teacher.id,
      now,
    })),
    ...scenarios.map((scenario, index) => {
      const student = students[scenario.accountIndex];
      return database.prepare(`INSERT INTO mood_entries (
        id,participant_hash,participant_code,user_id,class_id,mood,mood_score,note,goal,
        wants_support,safety_level,support_evidence,synthetic,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?, 'normal',?,1,?)`).bind(
        moodIds[index], `user:${student.id}`, student.username, student.id,
        classroomId, scenario.mood, scenario.accountIndex === 2 ? 5 : 2,
        scenario.note, "虚构情境：明天按计划完成一件小事。",
        scenario.wantsSupport ? 1 : 0,
        scenario.wantsSupport ? "student_requested_support" : null,
        now,
      );
    }),
    database.prepare(`INSERT INTO mood_entries (
      id,participant_hash,participant_code,user_id,class_id,mood,mood_score,note,goal,
      wants_support,safety_level,support_evidence,synthetic,created_at
    ) VALUES (?,?,?,?,?,'需要支持',1,?,'虚构演示：完成模拟教师处置闭环。',1,'urgent','local_crisis_rule',1,?)`)
      .bind(
        demonstrationMoodId, `user:${students[1].id}`, students[1].username,
        students[1].id, classroomId,
        "虚构演示事件：预设危机规则已触发，仅供成人测试模拟处置。",
        now,
      ),
    database.prepare(`INSERT INTO support_events (
      id,user_id,class_id,source_type,source_id,safety_level,evidence_code,status,
      assigned_teacher_user_id,acknowledged_at,resolved_at,synthetic,created_at
    ) VALUES (?,?,?,'mood',?,'urgent','local_crisis_rule','new',NULL,NULL,NULL,1,?)`)
      .bind(
        crypto.randomUUID(), students[1].id, classroomId, demonstrationMoodId, now,
      ),
  ];
  let result;
  try {
    result = await database.batch(statements);
  } catch (error) {
    if (error instanceof Error && /sandbox_state/iu.test(error.message)) {
      throw new ApiError(409, "沙盒已经初始化。请先重置，旧凭据不会再次显示。");
    }
    throw error;
  }
  if (result.some((item) => Number(item.meta.changes ?? 0) !== 1)) {
    throw new Error("Synthetic sandbox initialization transaction did not write every required row.");
  }

  return {
    syntheticOnly: true,
    warning: "以下均为一次性显示的虚构测试凭据，不得分配给真实学生。",
    teacher: { username: teacher.username, password: teacher.password, displayName: teacher.displayName },
    students: students.map(({ username, password, displayName }) => ({ username, password, displayName })),
    scenarios: scenarios.map((scenario) => ({
      username: students[scenario.accountIndex].username,
      mood: scenario.mood,
      note: scenario.note,
      wantsSupport: scenario.wantsSupport,
    })),
    classroom: { id: classroomId, name: "合成演示班" },
  };
}

export async function resetSyntheticSchool() {
  requireSandboxMode();
  const database = await getSystemDatabase();
  const statements = [
    database.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM app_users WHERE synthetic=1)"),
    database.prepare("DELETE FROM chat_messages WHERE synthetic=1"),
    database.prepare("DELETE FROM support_events WHERE synthetic=1"),
    database.prepare("DELETE FROM chat_conversations WHERE synthetic=1"),
    database.prepare("DELETE FROM mood_entries WHERE synthetic=1"),
    database.prepare("DELETE FROM app_users WHERE synthetic=1"),
    database.prepare("DELETE FROM school_classes WHERE synthetic=1"),
    database.prepare("DELETE FROM sandbox_state WHERE id=?").bind(SANDBOX_STATE_ID),
  ];
  const result = await database.batch(statements);
  return {
    ok: true,
    syntheticOnly: true,
    deletedRows: result.reduce((total, item) => total + Number(item.meta.changes ?? 0), 0),
  };
}
