import { getRuntimeEnv } from "@/db";
import { ApiError } from "@/lib/http";
import { getSystemDatabase } from "@/lib/system-db";
import {
  isAdultEvaluationOnly,
  isSyntheticSchoolSandbox,
  requireStudentMode,
  schoolSurfacesEnabled,
} from "@/lib/public-demo";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KDF_VERSION = "v2";
const PASSWORD_KDF_STAGES = 3;
const PASSWORD_STAGE_ITERATIONS = PASSWORD_ITERATIONS / PASSWORD_KDF_STAGES;
const SESSION_SECONDS = 8 * 60 * 60;
const SESSION_COOKIE = "xinban_session";
export const CONSENT_VERSION = "2026-08-v1";

export type UserRole = "teacher" | "student";
export type AgeBand = "under14" | "14plus";

interface AuthRow {
  id: string;
  role: UserRole;
  username: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  active: number;
  class_id: string | null;
  age_band: AgeBand | null;
  must_change_password: number;
  guardian_consent_verified_at: string | null;
  student_consented_at: string | null;
  student_consent_version: string | null;
  student_consent_withdrawn_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  class_active: number | null;
  synthetic: number;
  safety_contact_name: string | null;
  safety_contact_phone: string | null;
}

export interface SessionUser {
  id: string;
  role: UserRole;
  username: string;
  displayName: string;
  active: boolean;
  classId: string | null;
  ageBand: AgeBand | null;
  mustChangePassword: boolean;
  guardianConsentVerified: boolean;
  studentConsented: boolean;
  consentVersion: string | null;
  safetyContact: { name: string; phone: string } | null;
  synthetic: boolean;
}

export interface AuthSession {
  user: SessionUser;
  tokenHash: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function normalizeSchoolUsername(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "请输入学校发放的用户名。");
  const username = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{3,47}$/u.test(username)) {
    throw new ApiError(400, "用户名需为 4–48 位小写字母、数字、点、短横线或下划线。");
  }
  return username;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new ApiError(400, "密码需为 12–128 个字符。");
  }
  const groups = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((rule) =>
    rule.test(value),
  ).length;
  if (groups < 3 || /\s/u.test(value)) {
    throw new ApiError(400, "密码需包含大小写字母、数字、符号中的至少三类，且不能含空格。");
  }
  return value;
}

export function validateDisplayName(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") throw new ApiError(400, "显示名格式不正确。");
  const cleaned = value.replaceAll(String.fromCharCode(0), "").trim();
  if (!cleaned || Array.from(cleaned).length > 40) {
    throw new ApiError(400, "显示名需为 1–40 个字符。");
  }
  return cleaned;
}

export async function hashPassword(password: string): Promise<{
  salt: string;
  hash: string;
  iterations: number;
}> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await deriveLayeredPassword(password, salt, PASSWORD_ITERATIONS);
  return {
    salt: `${PASSWORD_KDF_VERSION}.${bytesToBase64Url(salt)}`,
    hash: bytesToBase64Url(bits),
    iterations: PASSWORD_ITERATIONS,
  };
}

/**
 * Workerd caps one PBKDF2 call at 100,000 iterations. Three serial stages keep
 * the configured 210,000-iteration work factor while every provider call stays
 * below that cap. The previous stage output becomes the next stage password,
 * so the work cannot be completed as three independent parallel hashes.
 */
async function deriveLayeredPassword(
  password: string,
  salt: Uint8Array,
  totalIterations: number,
): Promise<Uint8Array> {
  if (
    totalIterations !== PASSWORD_ITERATIONS ||
    !Number.isInteger(PASSWORD_STAGE_ITERATIONS)
  ) {
    throw new Error("Unsupported layered password work factor.");
  }

  let material: Uint8Array = encoder.encode(password);
  for (let stage = 0; stage < PASSWORD_KDF_STAGES; stage += 1) {
    const stageSalt = new Uint8Array(salt.byteLength + 1);
    stageSalt.set(salt);
    stageSalt[salt.byteLength] = stage + 1;
    const stableMaterial = new Uint8Array(material.byteLength);
    stableMaterial.set(material);
    const key = await crypto.subtle.importKey(
      "raw",
      stableMaterial,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: stageSalt,
        iterations: PASSWORD_STAGE_ITERATIONS,
      },
      key,
      256,
    );
    material = new Uint8Array(bits);
  }
  return material;
}

async function verifyPassword(password: string, row: AuthRow): Promise<boolean> {
  const layeredPrefix = `${PASSWORD_KDF_VERSION}.`;
  const isLayered = row.password_salt.startsWith(layeredPrefix);
  const encodedSalt = isLayered
    ? row.password_salt.slice(layeredPrefix.length)
    : row.password_salt;
  const salt = base64UrlToBytes(encodedSalt);
  if (!salt || row.password_iterations < PASSWORD_ITERATIONS) return false;
  const stableSalt = new Uint8Array(salt.byteLength);
  stableSalt.set(salt);

  if (isLayered) {
    try {
      const derived = await deriveLayeredPassword(
        password,
        stableSalt,
        row.password_iterations,
      );
      return safeEqual(bytesToBase64Url(derived), row.password_hash);
    } catch {
      return false;
    }
  }

  // Unprefixed salts are the v5.0 legacy format. Node can still verify them;
  // runtimes that reject a single 210k call fail closed and require a reset.
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  try {
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: stableSalt,
        iterations: row.password_iterations,
      },
      key,
      256,
    );
    return safeEqual(bytesToBase64Url(new Uint8Array(bits)), row.password_hash);
  } catch {
    return false;
  }
}

function mapUser(row: AuthRow): SessionUser {
  const currentlyConsented =
    Boolean(row.student_consented_at) &&
    !row.student_consent_withdrawn_at &&
    row.student_consent_version === CONSENT_VERSION;
  return {
    id: row.id,
    role: row.role,
    username: row.username,
    displayName: row.display_name,
    active: Number(row.active) === 1,
    classId: row.class_id,
    ageBand: row.age_band,
    mustChangePassword: Number(row.must_change_password) === 1,
    guardianConsentVerified: Boolean(row.guardian_consent_verified_at),
    studentConsented: row.role === "teacher" || currentlyConsented,
    consentVersion: row.student_consent_version,
    safetyContact:
      row.safety_contact_name && row.safety_contact_phone
        ? { name: row.safety_contact_name, phone: row.safety_contact_phone }
        : null,
    synthetic: Number(row.synthetic) === 1,
  };
}

const AUTH_SELECT = `
  SELECT u.*, c.active AS class_active,
    c.safety_contact_name, c.safety_contact_phone
  FROM app_users u
  LEFT JOIN school_classes c ON c.id = u.class_id
`;

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = valueParts.join("=");
      return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function createSession(userId: string): Promise<string> {
  const database = await getSystemDatabase();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1_000).toISOString();
  await database
    .prepare(`INSERT INTO auth_sessions
      (token_hash,user_id,created_at,expires_at,last_seen_at,revoked_at)
      VALUES (?,?,?,?,?,NULL)`)
    .bind(tokenHash, userId, now.toISOString(), expiresAt, now.toISOString())
    .run();
  return token;
}

export async function getOptionalSession(request: Request): Promise<AuthSession | null> {
  const runtime = getRuntimeEnv();
  if (!schoolSurfacesEnabled(runtime)) return null;
  const token = cookieValue(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const database = await getSystemDatabase();
  const now = new Date().toISOString();
  const row = await database
    .prepare(`${AUTH_SELECT}
      JOIN auth_sessions s ON s.user_id = u.id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .bind(tokenHash, now)
    .first<AuthRow>();
  if (!row || Number(row.active) !== 1) return null;
  if (isSyntheticSchoolSandbox(runtime) && Number(row.synthetic) !== 1) return null;
  if (row.role === "student" && Number(row.class_active) !== 1) return null;
  await database
    .prepare("UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?")
    .bind(now, tokenHash)
    .run();
  return { user: mapUser(row), tokenHash };
}

export async function requireSession(request: Request): Promise<AuthSession> {
  const session = await getOptionalSession(request);
  if (!session) throw new ApiError(401, "请先登录，或重新登录后再试。");
  return session;
}

export async function requireTeacher(request: Request): Promise<AuthSession> {
  const runtime = getRuntimeEnv();
  if (!schoolSurfacesEnabled(runtime)) {
    throw new ApiError(403, "成人评估模式不启用学校教师工作台。");
  }
  const session = await requireSession(request);
  if (session.user.role !== "teacher") throw new ApiError(403, "仅教师账号可以访问。");
  if (isSyntheticSchoolSandbox(runtime) && !session.user.synthetic) {
    throw new ApiError(403, "合成沙盒只允许虚构教师账号。");
  }
  return session;
}

export async function requireStudentReady(request: Request): Promise<AuthSession> {
  requireStudentMode(getRuntimeEnv());
  const session = await requireSession(request);
  const user = session.user;
  if (user.role !== "student") throw new ApiError(403, "仅学生账号可以使用此功能。");
  if (isSyntheticSchoolSandbox(getRuntimeEnv()) && !user.synthetic) {
    throw new ApiError(403, "合成沙盒只允许虚构学生账号。");
  }
  if (user.mustChangePassword) throw new ApiError(403, "请先修改学校发放的初始密码。");
  if (!user.guardianConsentVerified) {
    throw new ApiError(403, "监护人同意尚未由教师核验，暂不能使用此功能。");
  }
  if (!user.studentConsented) throw new ApiError(403, "请先阅读并确认学生本人知情同意。");
  return session;
}

/** Export/delete remain available after consent withdrawal. */
export async function requireStudentIdentity(request: Request): Promise<AuthSession> {
  requireStudentMode(getRuntimeEnv());
  const session = await requireSession(request);
  if (session.user.role !== "student") {
    throw new ApiError(403, "仅学生账号可以访问本人数据。");
  }
  if (isSyntheticSchoolSandbox(getRuntimeEnv()) && !session.user.synthetic) {
    throw new ApiError(403, "合成沙盒只允许虚构学生账号。");
  }
  return session;
}

export async function requireVoiceUser(request: Request): Promise<AuthSession> {
  const runtime = getRuntimeEnv();
  if (!schoolSurfacesEnabled(runtime)) {
    throw new ApiError(403, "成人评估模式不启用账号语音接口。");
  }
  const session = await requireSession(request);
  if (isSyntheticSchoolSandbox(runtime) && !session.user.synthetic) {
    throw new ApiError(403, "合成沙盒只允许虚构账号使用语音功能。");
  }
  if (session.user.role === "student") {
    requireStudentMode(getRuntimeEnv());
    return requireStudentReady(request);
  }
  return session;
}

export async function revokeSession(tokenHash: string): Promise<void> {
  const database = await getSystemDatabase();
  await database
    .prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}

function requestIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim().slice(0, 64) || "unknown";
}

export async function consumeAuthRateLimit(
  request: Request,
  action: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const database = await getSystemDatabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1_000).toISOString();
  const key = await sha256(`${action}|${requestIp(request)}|${identity}`);
  await database.prepare(`
    INSERT INTO auth_rate_limits (scope_key,window_started_at,request_count,expires_at)
    VALUES (?,?,1,?)
    ON CONFLICT(scope_key) DO UPDATE SET
      window_started_at=CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.window_started_at ELSE window_started_at END,
      request_count=CASE WHEN expires_at <= excluded.window_started_at
        THEN 1 ELSE request_count+1 END,
      expires_at=CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.expires_at ELSE expires_at END
  `).bind(key, now.toISOString(), expiresAt).run();
  const state = await database
    .prepare("SELECT request_count FROM auth_rate_limits WHERE scope_key=?")
    .bind(key)
    .first<{ request_count: number }>();
  if (Number(state?.request_count ?? limit + 1) > limit) {
    throw new ApiError(429, "尝试次数过多，请稍后再试。");
  }
}

export async function bootstrapTeacher(input: {
  bootstrapToken: unknown;
  username: unknown;
  password: unknown;
  displayName?: unknown;
}): Promise<SessionUser> {
  const runtime = getRuntimeEnv();
  if (isSyntheticSchoolSandbox(runtime)) {
    throw new ApiError(403, "合成沙盒请使用受保护的沙盒初始化接口。");
  }
  if (isAdultEvaluationOnly(runtime)) {
    throw new ApiError(403, "成人评估模式不创建学校教师账号。");
  }
  const configured = getRuntimeEnv().AUTH_BOOTSTRAP_TOKEN?.trim() ?? "";
  const supplied = typeof input.bootstrapToken === "string" ? input.bootstrapToken : "";
  if (configured.length < 24 || !safeEqual(configured, supplied)) {
    throw new ApiError(403, "初始化凭证无效。");
  }
  const username = normalizeSchoolUsername(input.username);
  const password = validatePassword(input.password);
  const displayName = validateDisplayName(input.displayName, username);
  const passwordData = await hashPassword(password);
  const database = await getSystemDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const bootstrapStatement = database.prepare(`
    INSERT INTO app_users (
      id,role,username,display_name,password_salt,password_hash,password_iterations,
      active,class_id,age_band,must_change_password,created_by_user_id,
      failed_login_count,created_at,updated_at
    )
    SELECT ?,'teacher',?,?,?,?,?,1,NULL,NULL,0,NULL,0,?,?
    WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE role='teacher')
  `).bind(
    id, username, displayName, passwordData.salt, passwordData.hash,
    passwordData.iterations, now, now,
  );
  const result = database.dialect === "postgres"
    ? (await database.batch([
        database.prepare("SELECT pg_advisory_xact_lock(?)").bind(1_481_191_746),
        bootstrapStatement,
      ]))[1]
    : await bootstrapStatement.run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "系统已完成初始化，bootstrap 已永久关闭。");
  }
  const row = await database
    .prepare(`${AUTH_SELECT} WHERE u.id=?`)
    .bind(id)
    .first<AuthRow>();
  if (!row) throw new ApiError(500, "教师账号创建失败。");
  return mapUser(row);
}

export async function login(usernameValue: unknown, passwordValue: unknown): Promise<SessionUser> {
  const runtime = getRuntimeEnv();
  if (!schoolSurfacesEnabled(runtime)) {
    throw new ApiError(403, "当前公开版本仅使用一次性评估码，不开放学校账号登录。");
  }
  const username = normalizeSchoolUsername(usernameValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (!password || password.length > 128) throw new ApiError(401, "用户名或密码不正确。");
  const database = await getSystemDatabase();
  const row = await database
    .prepare(`${AUTH_SELECT} WHERE u.username=?`)
    .bind(username)
    .first<AuthRow>();
  const now = new Date();
  if (!row || Number(row.active) !== 1 || (row.locked_until && row.locked_until > now.toISOString())) {
    throw new ApiError(401, "用户名或密码不正确，或账号暂时不可用。");
  }
  if (isSyntheticSchoolSandbox(runtime) && Number(row.synthetic) !== 1) {
    throw new ApiError(401, "用户名或密码不正确，或账号暂时不可用。");
  }
  if (!(await verifyPassword(password, row))) {
    const lockedUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
    await database.prepare(`UPDATE app_users SET
      failed_login_count=failed_login_count+1,
      locked_until=CASE WHEN failed_login_count+1 >= 5 THEN ? ELSE locked_until END,
      updated_at=? WHERE id=?`).bind(lockedUntil, now.toISOString(), row.id).run();
    throw new ApiError(401, "用户名或密码不正确，或账号暂时不可用。");
  }
  if (row.role === "student" && Number(row.class_active) !== 1) {
    throw new ApiError(403, "所在班级已停用，请联系教师。");
  }
  await database.prepare(`UPDATE app_users SET failed_login_count=0,
    locked_until=NULL,updated_at=? WHERE id=?`).bind(now.toISOString(), row.id).run();
  return mapUser(row);
}

export async function changeOwnPassword(
  session: AuthSession,
  currentValue: unknown,
  newValue: unknown,
): Promise<SessionUser> {
  requireStudentMode(getRuntimeEnv());
  const currentPassword = typeof currentValue === "string" ? currentValue : "";
  const newPassword = validatePassword(newValue);
  if (safeEqual(currentPassword, newPassword)) {
    throw new ApiError(400, "新密码不能与初始密码相同。");
  }
  const database = await getSystemDatabase();
  const row = await database
    .prepare(`${AUTH_SELECT} WHERE u.id=?`)
    .bind(session.user.id)
    .first<AuthRow>();
  if (!row || !(await verifyPassword(currentPassword, row))) {
    throw new ApiError(401, "当前密码不正确。");
  }
  const password = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await database.prepare(`UPDATE app_users SET password_salt=?,password_hash=?,
    password_iterations=?,must_change_password=0,updated_at=? WHERE id=?`)
    .bind(password.salt, password.hash, password.iterations, now, row.id).run();
  await database.prepare(`UPDATE auth_sessions SET revoked_at=?
    WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL`)
    .bind(now, row.id, session.tokenHash).run();
  const updated = await database
    .prepare(`${AUTH_SELECT} WHERE u.id=?`)
    .bind(row.id)
    .first<AuthRow>();
  if (!updated) throw new ApiError(500, "密码更新失败。");
  return mapUser(updated);
}

export async function setStudentConsent(
  session: AuthSession,
  accepted: unknown,
): Promise<SessionUser> {
  requireStudentMode(getRuntimeEnv());
  if (session.user.role !== "student") throw new ApiError(403, "仅学生本人可以确认同意。");
  if (session.user.mustChangePassword) throw new ApiError(403, "请先修改初始密码。");
  if (!session.user.guardianConsentVerified) {
    throw new ApiError(403, "监护人同意尚未由教师核验。");
  }
  if (typeof accepted !== "boolean") throw new ApiError(400, "请选择同意或撤回。");
  const database = await getSystemDatabase();
  const now = new Date().toISOString();
  await database.prepare(`UPDATE app_users SET
    student_consented_at=CASE WHEN ?=1 THEN ? ELSE student_consented_at END,
    student_consent_version=CASE WHEN ?=1 THEN ? ELSE student_consent_version END,
    student_consent_withdrawn_at=CASE WHEN ?=1 THEN NULL ELSE ? END,
    updated_at=? WHERE id=?`)
    .bind(accepted ? 1 : 0, now, accepted ? 1 : 0, CONSENT_VERSION,
      accepted ? 1 : 0, now, now, session.user.id).run();
  if (!accepted) {
    await database.prepare(`UPDATE auth_sessions SET revoked_at=?
      WHERE user_id=? AND revoked_at IS NULL`)
      .bind(now, session.user.id).run();
  }
  const updated = await database
    .prepare(`${AUTH_SELECT} WHERE u.id=?`)
    .bind(session.user.id)
    .first<AuthRow>();
  if (!updated) throw new ApiError(500, "同意状态更新失败。");
  return mapUser(updated);
}
