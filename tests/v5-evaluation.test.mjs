import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { Miniflare } from "../node_modules/.pnpm/node_modules/miniflare/dist/src/index.js";

register(new URL("./cloudflare-test-loader.mjs", import.meta.url), import.meta.url);

const ORIGIN = "http://localhost";
const RESEARCH_KEY = "research-test-key-at-least-24-characters";
const STUDY_BINDINGS = {
  EVALUATION_RESEARCHER_NAME: "EITT adult prototype team",
  EVALUATION_CONTACT: "research@example.invalid",
  EVALUATION_ETHICS_STATUS: "Protocol pending; formative prototype feedback only",
  EVALUATION_RETENTION_DAYS: "365",
  EVALUATION_DATA_HOST: "Protected synthetic-evaluation database in a test region",
};
const decision = {
  chosenAction: "brief_check_in",
  evidenceSelected: ["student_expression", "classroom_context"],
  contextJudgment: "partly_supports_cue",
  reasonCodes: ["corroborating_context", "least_intrusive_support"],
  privacyChoice: "one_authorized_teacher",
  confidence: 4,
  decisionTimeMs: 1_250,
};
const reference = {
  referenceAction: "brief_check_in",
  referenceEvidence: ["student_expression", "classroom_context"],
  referenceContextJudgment: "partly_supports_cue",
  referenceReasonCodes: ["corroborating_context", "privacy_minimization"],
  referencePrivacyChoice: "one_authorized_teacher",
  referenceConfidence: 4,
};
const quality = { warmth: 4, relevance: 5, ageAppropriate: 4, nonDiagnostic: 5, evidence: 4, privacySafety: 5, actionProportionality: 4 };

async function newD1() {
  const mf = new Miniflare({ compatibilityDate: "2026-05-22", modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: crypto.randomUUID() } });
  return { mf, db: await mf.getD1Database("DB") };
}

async function callApi(pathname, init = {}, bindings = {}) {
  globalThis.__CLOUDFLARE_TEST_ENV__ = bindings;
  const { default: worker } = await import("../dist/server/index.js");
  return worker.fetch(new Request(`${ORIGIN}${pathname}`, init), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings }, { waitUntil() {}, passThroughOnException() {} });
}

function mutation(body, cookie) {
  return { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "expected an evaluation session cookie");
  return value.split(";", 1)[0];
}

function consent(accessCode, overrides = {}) {
  return { experienceBand: "3-5", accessCode, adultConfirmed: true, syntheticOnlyConfirmed: true, dataUseConfirmed: true, voluntaryConfirmed: true, quoteConsent: true, ...overrides };
}

function survey(workload = 37) {
  return { kind: "survey", sus: [5,1,5,1,5,1,5,1,5,1], trust: 4, appropriateness: 4, usability: 5, safetyBoundary: 5, workload, feedback: "匿名的原型改进建议。" };
}

async function start(code, bindings, overrides = {}) {
  const response = await callApi("/api/evaluation/session", mutation(consent(code, overrides)), bindings);
  assert.equal(response.status, 201, await response.clone().text());
  return cookieFrom(response);
}

async function state(cookie, bindings) {
  const response = await callApi("/api/evaluation/session", { headers: { cookie } }, bindings);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function completeTeacherCases(cookie, bindings) {
  const initial = await state(cookie, bindings);
  assert.equal(initial.scenarios.length, 12);
  for (const scenario of initial.scenarios) {
    const response = await callApi("/api/evaluation/response", mutation({ scenarioId: scenario.id, ...decision }, cookie), bindings);
    assert.equal(response.status, 200, `${scenario.id}: ${await response.clone().text()}`);
  }
}

test("four consents, code-derived role, one-time code, 12 synthetic scenarios, and quote consent", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const teacherCode = "TEACHER-CODE-0001";
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: teacherCode, EVALUATION_EXPERT_CODES: "EXPERT-CODE-0001", RESEARCH_ACCESS_KEY: RESEARCH_KEY };

  const info = await callApi("/api/evaluation/info", {}, bindings);
  assert.equal(info.status, 200); assert.match(await info.text(), /25–35 分钟/u);
  const missing = await callApi("/api/evaluation/session", mutation(consent(teacherCode, { dataUseConfirmed: false })), bindings);
  assert.equal(missing.status, 400);
  const roleSpoof = await callApi("/api/evaluation/session", mutation(consent(teacherCode, { role: "expert" })), bindings);
  assert.equal(roleSpoof.status, 403, "role is derived from invite-code type");
  const cookie = await start(teacherCode, bindings);
  const reuse = await callApi("/api/evaluation/session", mutation(consent(teacherCode)), bindings);
  assert.equal(reuse.status, 409);
  const evaluation = await state(cookie, bindings);
  assert.equal(evaluation.participant.role, "teacher"); assert.equal(evaluation.scenarios.length, 12);
  assert.ok(evaluation.scenarios.every((item) => item.synthetic && item.frozenOutput));
  const participant = await db.prepare("SELECT quote_consent FROM evaluation_participants").first();
  assert.equal(participant.quote_consent, 1);
});

test("teacher dashboard-only and CCCR persist identical structured fields with no free-text columns", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-0002", RESEARCH_ACCESS_KEY: RESEARCH_KEY };
  const cookie = await start("TEACHER-CODE-0002", bindings);
  const forbiddenText = await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", ...decision, rationale: "自由文本不应进入正式案例。" }, cookie), bindings);
  assert.equal(forbiddenText.status, 400);
  await completeTeacherCases(cookie, bindings);
  const rows = await db.prepare("SELECT * FROM evaluation_scenario_responses ORDER BY scenario_id").all();
  assert.equal(rows.results.length, 12);
  assert.deepEqual(new Set(rows.results.map((row) => row.study_condition)), new Set(["dashboard_only", "dashboard_cccr"]));
  for (const row of rows.results) {
    assert.deepEqual(JSON.parse(row.evidence_selected_json), decision.evidenceSelected);
    assert.equal(row.context_judgment, decision.contextJudgment);
    assert.deepEqual(JSON.parse(row.reason_codes_json), decision.reasonCodes);
    assert.equal(row.privacy_choice, decision.privacyChoice); assert.equal(row.confidence, 4);
  }
  const columns = (await db.prepare("PRAGMA table_info(evaluation_scenario_responses)").all()).results.map((row) => row.name);
  assert.ok(!columns.includes("context_check") && !columns.includes("rationale"));
  const submitted = await callApi("/api/evaluation/response", mutation(survey(41), cookie), bindings);
  assert.equal(submitted.status, 200, await submitted.clone().text());
  assert.equal((await db.prepare("SELECT workload_score FROM evaluation_surveys").first()).workload_score, 41);
});

test("expert freezes complete independent judgment before reveal, then stores seven quality dimensions and fixed harms", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_EXPERT_CODES: "EXPERT-CODE-0002", RESEARCH_ACCESS_KEY: RESEARCH_KEY };
  const cookie = await start("EXPERT-CODE-0002", bindings);
  const before = await state(cookie, bindings);
  assert.equal(before.scenarios[0].frozenOutput, undefined); assert.equal(before.scenarios[0].petReply, undefined); assert.equal(before.scenarios[0].expertReference, null);
  const prematureLive = await callApi("/api/evaluation/live-demo", mutation({ scenarioId: "C01" }, cookie), bindings);
  assert.equal(prematureLive.status, 409, "expert live AI demo stays locked until the independent reference is frozen");
  const bypass = await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "monitor", quality, mustRevise: false, criticalHarmFlags: ["none"], decisionTimeMs: 1_000 }, cookie), bindings);
  assert.equal(bypass.status, 409);
  const reveal = await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference }, cookie), bindings);
  assert.equal(reveal.status, 200, await reveal.clone().text());
  const stillPrematureLive = await callApi("/api/evaluation/live-demo", mutation({ scenarioId: "C01" }, cookie), bindings);
  assert.equal(stillPrematureLive.status, 409, "freezing one case still cannot expose live AI during formal tasks");
  const changed = await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference, referenceConfidence: 2 }, cookie), bindings);
  assert.equal(changed.status, 409, "every independent-reference field is immutable after reveal");
  const after = await state(cookie, bindings); assert.ok(after.scenarios[0].frozenOutput); assert.ok(after.scenarios[0].petReply); assert.equal(after.scenarios[1].frozenOutput, undefined); assert.equal(after.scenarios[1].petReply, undefined);
  const saved = await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "brief_check_in", quality, mustRevise: true, criticalHarmFlags: ["unsupported_inference", "over_escalation"], decisionTimeMs: 1_500 }, cookie), bindings);
  assert.equal(saved.status, 200, await saved.clone().text());
  const frozen = await db.prepare("SELECT * FROM evaluation_expert_references").first();
  assert.deepEqual(JSON.parse(frozen.reference_evidence_json), reference.referenceEvidence);
  assert.deepEqual(JSON.parse(frozen.reference_reason_codes_json), reference.referenceReasonCodes);
  assert.equal(frozen.reference_privacy_choice, reference.referencePrivacyChoice); assert.equal(frozen.reference_confidence, 4);
  const response = await db.prepare("SELECT * FROM evaluation_scenario_responses").first();
  assert.equal(Object.keys(JSON.parse(response.quality_json)).length, 7); assert.equal(response.must_revise, 1);
  assert.deepEqual(JSON.parse(response.critical_harm_flags_json), ["unsupported_inference", "over_escalation"]);

  const withdrawn = await callApi("/api/evaluation/withdraw", { method: "DELETE", headers: { origin: ORIGIN, cookie } }, bindings);
  assert.equal(withdrawn.status, 200);
  for (const table of ["evaluation_participants","evaluation_scenario_responses","evaluation_expert_references","evaluation_surveys"]) {
    assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count, 0, table);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM evaluation_used_codes").first()).count, 1);
});

test("research suppresses n<5 and CSV exports workload, quote, structured teacher and expert quality fields", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-CSV1", EVALUATION_EXPERT_CODES: "EXPERT-CODE-CSV01", RESEARCH_ACCESS_KEY: RESEARCH_KEY };
  const cookie = await start("TEACHER-CODE-CSV1", bindings); await completeTeacherCases(cookie, bindings);
  assert.equal((await callApi("/api/evaluation/response", mutation(survey(52), cookie), bindings)).status, 200);
  const expert = await start("EXPERT-CODE-CSV01", bindings, { quoteConsent: false });
  assert.equal((await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference }, expert), bindings)).status, 200);
  assert.equal((await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "monitor", quality, mustRevise: false, criticalHarmFlags: ["none"], decisionTimeMs: 2_000 }, expert), bindings)).status, 200);
  const summary = await callApi("/api/research/summary", { headers: { "x-research-key": RESEARCH_KEY } }, bindings);
  const body = await summary.json(); assert.equal(body.minimumGroupSize, 5); assert.deepEqual(body.groups, []);
  assert.deepEqual(new Set(body.suppressedGroups), new Set(["teacher", "expert"]));
  const exported = await callApi("/api/research/export", { headers: { "x-research-key": RESEARCH_KEY } }, bindings);
  assert.equal(exported.headers.get("cache-control"), "no-store");
  const csv = await exported.text(); const header = csv.replace(/^\uFEFF/u, "").split(/\r?\n/u, 1)[0];
  for (const field of ["quote_consent","evidence_selected_json","context_judgment","reason_codes_json","privacy_choice","confidence","quality_json","must_revise","critical_harm_flags_json","reference_evidence_json","reference_confidence","workload_score"]) assert.match(header, new RegExp(`(?:^|,)${field}(?:,|$)`, "u"));
  assert.doesNotMatch(header, /context_check|rationale|output_rating/u);
});

test("live Qwen demo ignores client text, uses only fixed synthetic case, and writes no evaluation response", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-LIVE1", QWEN_API_KEY: "test-qwen-key" };
  const cookie = await start("TEACHER-CODE-LIVE1", bindings);
  const prematureLive = await callApi("/api/evaluation/live-demo", mutation({ scenarioId: "C01" }, cookie), bindings);
  assert.equal(prematureLive.status, 409, "live AI stays outside the formal evaluation phase");
  await completeTeacherCases(cookie, bindings);
  const surveyResponse = await callApi("/api/evaluation/response", mutation(survey(), cookie), bindings);
  assert.equal(surveyResponse.status, 200, await surveyResponse.clone().text());
  const beforeLive = await db.prepare("SELECT last_seen_at FROM evaluation_participants").first();
  const responseCountBeforeLive = Number((await db.prepare("SELECT COUNT(*) count FROM evaluation_scenario_responses").first()).count);
  const originalFetch = globalThis.fetch; let providerBody = "";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://dashscope.aliyuncs.com/")) {
      providerBody = String(init?.body ?? "");
      return Response.json({ choices: [{ message: { content: "这是仅基于固定合成案例的安全演示回应。" } }] });
    }
    return originalFetch(input, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await callApi("/api/evaluation/live-demo", mutation({ scenarioId: "C01", message: "恶意伪造的真实自由文本" }, cookie), bindings);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).syntheticOnly, true);
  assert.match(providerBody, /这次数学没考好/u); assert.doesNotMatch(providerBody, /恶意伪造/u);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) count FROM evaluation_scenario_responses").first()).count), responseCountBeforeLive);
  assert.equal((await db.prepare("SELECT last_seen_at FROM evaluation_participants").first()).last_seen_at, beforeLive.last_seen_at, "live demo must not write even session activity");
});

test("evaluation UI keeps UTF-8 disclosures and has no formal-case free-text judgment controls", async () => {
  const source = await readFile(new URL("../app/evaluate/EvaluationApp.tsx", import.meta.url), "utf8");
  assert.match(source, /合成情境/u); assert.match(source, /禁止输入真实学生信息/u);
  assert.doesNotMatch(source, /name="(?:contextCheck|rationale)"/u);
  assert.doesNotMatch(source, /鐨|鍙|绱/u);
});
