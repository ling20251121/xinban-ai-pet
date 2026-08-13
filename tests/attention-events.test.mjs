import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { Miniflare } from "../node_modules/.pnpm/node_modules/miniflare/dist/src/index.js";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

async function migrate(db) {
  for (const name of [
    "0000_groovy_jane_foster.sql",
    "0001_controlled_school_system.sql",
    "0002_synthetic_school_sandbox.sql",
    "0003_evaluation_dialogue.sql",
    "0004_three_hour_conversations.sql",
    "0005_conversation_cues.sql",
  ]) {
    const source = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    for (const part of source.split("--> statement-breakpoint")) {
      const sql = part.trim();
      if (sql) await db.prepare(sql).run();
    }
  }
}

test("attention schema enforces one text-free cue, priority, state and teacher isolation", async (t) => {
  const mf = new Miniflare({
    compatibilityDate: "2026-05-22", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await migrate(db);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO school_classes
    (id,teacher_user_id,name,safety_contact_name,safety_contact_phone,synthetic,active,created_at,updated_at)
    VALUES ('class-a','teacher-a','A班','支持老师','000',0,1,?,?),
           ('class-b','teacher-b','B班','支持老师','000',0,1,?,?)`)
    .bind(now, now, now, now).run();
  const insertUser = `INSERT INTO app_users
    (id,role,username,display_name,password_salt,password_hash,password_iterations,active,
     class_id,age_band,must_change_password,failed_login_count,synthetic,created_at,updated_at)
    VALUES (?,?,?,?, 'salt','hash',210000,1,?,?,0,0,0,?,?)`;
  await db.batch([
    db.prepare(insertUser).bind("teacher-a", "teacher", "tea-a", "A", null, null, now, now),
    db.prepare(insertUser).bind("teacher-b", "teacher", "tea-b", "B", null, null, now, now),
    db.prepare(insertUser).bind("student-a", "student", "stu-a", "学生A", "class-a", "under14", now, now),
  ]);
  const privateText = "PRIVATE_MOOD_PROSE_MUST_NOT_ESCAPE";
  await db.batch([
    db.prepare(`INSERT INTO mood_entries
      (id,participant_hash,participant_code,user_id,class_id,mood,mood_score,note,goal,
       wants_support,safety_level,support_evidence,synthetic,created_at)
      VALUES ('mood-a','user:student-a','stu-a','student-a','class-a','sad',2,?,'private',1,'normal','student_requested_support',0,?)`)
      .bind(privateText, now),
    db.prepare(`INSERT INTO teacher_attention_events
      (id,user_id,class_id,kind,source_type,source_id,status,synthetic,created_at)
      VALUES ('support-a','student-a','class-a','student_support_request','mood','mood-a','new',0,?)`).bind(now),
    db.prepare(`INSERT INTO teacher_attention_events
      (id,user_id,class_id,kind,source_type,source_id,status,synthetic,created_at)
      VALUES ('long-a','student-a','class-a','long_chat_session','chat','chat-a','new',0,?)`).bind(now),
  ]);

  const teacherQuery = `SELECT e.id,e.kind,e.source_type,e.source_id,u.username,c.name,e.status
    FROM teacher_attention_events e JOIN app_users u ON u.id=e.user_id
    JOIN school_classes c ON c.id=e.class_id WHERE c.teacher_user_id=?
    ORDER BY CASE e.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
      CASE e.kind WHEN 'student_support_request' THEN 0 ELSE 1 END,e.created_at DESC`;
  const own = await db.prepare(teacherQuery).bind("teacher-a").all();
  assert.deepEqual(own.results.map((row) => row.kind), ["student_support_request", "long_chat_session"]);
  assert.doesNotMatch(JSON.stringify(own.results), new RegExp(privateText));
  assert.equal((await db.prepare(teacherQuery).bind("teacher-b").all()).results.length, 0);
  await assert.rejects(
    db.prepare(`INSERT INTO teacher_attention_events
      (id,user_id,class_id,kind,source_type,source_id,status,synthetic,created_at)
      VALUES ('duplicate','student-a','class-a','student_support_request','mood','mood-a','new',0,?)`).bind(now).run(),
  );
  let result = await db.prepare(`UPDATE teacher_attention_events SET status='acknowledged',
    assigned_teacher_user_id='teacher-a',acknowledged_at=? WHERE id='support-a' AND status='new'
    AND class_id IN (SELECT id FROM school_classes WHERE teacher_user_id='teacher-a')`).bind(now).run();
  assert.equal(result.meta.changes, 1);
  result = await db.prepare(`UPDATE teacher_attention_events SET status='resolved',resolved_at=?
    WHERE id='support-a' AND status='acknowledged'
    AND class_id IN (SELECT id FROM school_classes WHERE teacher_user_id='teacher-b')`).bind(now).run();
  assert.equal(result.meta.changes, 0);
});

test("a successful reply after three hours creates one non-crisis attention cue", async (t) => {
  const mf = new Miniflare({
    compatibilityDate: "2026-05-22", modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await migrate(db);
  globalThis.__CLOUDFLARE_TEST_ENV__ = { DB: db, ADULT_EVALUATION_ONLY: "false" };
  const now = new Date().toISOString();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1_000).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO school_classes
      (id,teacher_user_id,name,safety_contact_name,safety_contact_phone,synthetic,active,created_at,updated_at)
      VALUES ('class-live','teacher-live','Live','support','000',0,1,?,?)`).bind(now, now),
    db.prepare(`INSERT INTO app_users
      (id,role,username,display_name,password_salt,password_hash,password_iterations,active,
       class_id,age_band,must_change_password,failed_login_count,synthetic,created_at,updated_at)
      VALUES ('student-live','student','stu-live','Student','salt','hash',210000,1,
       'class-live','under14',0,0,0,?,?)`).bind(now, now),
    db.prepare(`INSERT INTO chat_conversations
      (id,user_id,class_id,started_at,expires_at,student_turns,in_flight,pending_since,lease_token,
       synthetic,created_at,updated_at)
      VALUES ('chat-live','student-live','class-live',?,?,1,1,?,'lease-live',0,?,?)`)
      .bind(fourHoursAgo, fourHoursAgo, now, now, now),
  ]);
  const { saveAssistantAndFinish } = await import("../lib/conversations.ts");
  const user = { id: "student-live", role: "student", username: "stu-live", displayName: "Student", active: true, classId: "class-live", ageBand: "under14", mustChangePassword: false, guardianConsentVerified: true, studentConsented: true, consentVersion: "x", safetyContact: null, synthetic: false };
  await saveAssistantAndFinish(user, "chat-live", "lease-live", "synthetic student turn", "synthetic AI reply", false);
  const cue = await db.prepare(`SELECT kind,source_type,source_id,status FROM teacher_attention_events
    WHERE user_id='student-live'`).first();
  assert.deepEqual(cue, { kind: "long_chat_session", source_type: "chat", source_id: "chat-live", status: "new" });
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM chat_messages WHERE conversation_id='chat-live'").first()).count, 2);
});
