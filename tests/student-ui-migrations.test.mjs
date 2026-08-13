import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const columns = [
  "student_ui_presentation_fidelity_score",
  "student_ui_potential_usefulness_score",
  "student_ui_perceived_comprehensibility_score",
  "student_ui_age_context_fit_score",
  "student_ui_items_version",
];

test("D1 migration adds the versioned nullable student-UI formative items", async () => {
  const sql = await readFile(new URL("../drizzle/0006_student_ui_formative_items.sql", import.meta.url), "utf8");
  for (const column of columns) assert.ok(sql.includes(`ADD COLUMN \`${column}\``), column);
  assert.match(sql, /BETWEEN 1 AND 5/u);
  assert.doesNotMatch(sql, /NOT NULL/u, "existing survey rows must remain valid after migration");
});

test("PostgreSQL migration is idempotent and recorded as 0007", async () => {
  const sql = await readFile(new URL("../postgres/0007_student_ui_formative_items.sql", import.meta.url), "utf8");
  for (const column of columns) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, "u"));
  assert.match(sql, /BETWEEN 1 AND 5/u);
  assert.match(sql, /0007_student_ui_formative_items/u);
  assert.doesNotMatch(sql, /SET NOT NULL|ADD COLUMN IF NOT EXISTS [^;]* NOT NULL/su,
    "existing survey rows must remain valid after migration");
});

test("actual usability migrations add strict task state, immediate feedback, and PostgreSQL 0008", async () => {
  const d1 = await readFile(new URL("../drizzle/0007_student_ui_actual_usability.sql", import.meta.url), "utf8");
  const postgres = await readFile(new URL("../postgres/0008_student_ui_actual_usability.sql", import.meta.url), "utf8");
  for (const sql of [d1, postgres]) {
    assert.match(sql, /evaluation_student_ui_task_runs/u);
    assert.match(sql, /evaluation_student_ui_task_feedback/u);
    assert.match(sql, /status[\s\S]*in_progress[\s\S]*success[\s\S]*unable/u);
    assert.match(sql, /error_count/u);
    assert.match(sql, /actual_ease_score/u);
    assert.doesNotMatch(sql, /attempts|student_ui_actual_ease_score/u);
  }
  assert.match(postgres, /0008_student_ui_actual_usability/u);
});

test("administrative migration runner includes PostgreSQL 0007 and 0008", async () => {
  const source = await readFile(new URL("../scripts/migrate-postgres.mjs", import.meta.url), "utf8");
  assert.match(source, /postgres\/0007_student_ui_formative_items\.sql/u);
  assert.match(source, /postgres\/0008_student_ui_actual_usability\.sql/u);
  assert.match(source, /migrations 0001 through 0008 are ready/u);
});
