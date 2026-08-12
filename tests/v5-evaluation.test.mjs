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
  QWEN_API_KEY: "test-qwen-key",
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
const dialogueQuality = { warmth: 4, relevance: 5, continuity: 4, expressionSupport: 5, emotionClarification: 4, ageAppropriate: 5, boundaryAndHumanSupport: 5 };
const dialogueReview = { dialogueQuality, dialogueMustRevise: false, dialogueHarmFlags: ["none"] };

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

function installQwenStub(t, reply = "我听到这件事让你有些难受。可以先做一小步，也可以找一位可信任的老师说说。") {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://dashscope.aliyuncs.com/")) {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ choices: [{ message: { content: reply } }] });
    }
    return originalFetch(input, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

async function completeDialogue(cookie, bindings, scenarioId) {
  let expectedTurn = 0;
  while (true) {
    const response = await callApi("/api/evaluation/dialogue", mutation({ scenarioId, expectedTurn }, cookie), bindings);
    assert.equal(response.status, 200, `${scenarioId} dialogue ${expectedTurn}: ${await response.clone().text()}`);
    const body = await response.json();
    if (body.dialogue.completed) return body.dialogue;
    expectedTurn = body.dialogue.nextTurn;
  }
}

async function completeTeacherCases(cookie, bindings) {
  const initial = await state(cookie, bindings);
  assert.equal(initial.scenarios.length, 12);
  for (const scenario of initial.scenarios) {
    if (scenario.dialogueRequired) await completeDialogue(cookie, bindings, scenario.id);
    const response = await callApi("/api/evaluation/response", mutation({ scenarioId: scenario.id, ...decision, ...(scenario.dialogueRequired ? dialogueReview : {}) }, cookie), bindings);
    assert.equal(response.status, 200, `${scenario.id}: ${await response.clone().text()}`);
  }
}

test("four consents, code-derived role, one-time code, 12 synthetic scenarios, and quote consent", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const teacherCode = "TEACHER-CODE-0001";
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: teacherCode, EVALUATION_EXPERT_CODES: "EXPERT-CODE-0001", RESEARCH_ACCESS_KEY: RESEARCH_KEY };

  const info = await callApi("/api/evaluation/info", {}, bindings);
  assert.equal(info.status, 200); assert.match(await info.text(), /30–45 分钟/u);
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
  installQwenStub(t);
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
  installQwenStub(t);
  const prematureLive = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 0 }, cookie), bindings);
  assert.equal(prematureLive.status, 409, "expert dialogue stays locked until the independent reference is frozen");
  const bypass = await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "monitor", quality, mustRevise: false, criticalHarmFlags: ["none"], decisionTimeMs: 1_000 }, cookie), bindings);
  assert.equal(bypass.status, 409);
  const reveal = await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference }, cookie), bindings);
  assert.equal(reveal.status, 200, await reveal.clone().text());
  const dialogue = await completeDialogue(cookie, bindings, "C01");
  assert.equal(dialogue.completed, true, "dialogue becomes available immediately after this case reference freezes");
  const changed = await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference, referenceConfidence: 2 }, cookie), bindings);
  assert.equal(changed.status, 409, "every independent-reference field is immutable after reveal");
  const after = await state(cookie, bindings); assert.ok(after.scenarios[0].frozenOutput); assert.ok(after.scenarios[0].petReply); assert.equal(after.scenarios[1].frozenOutput, undefined); assert.equal(after.scenarios[1].petReply, undefined);
  const saved = await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "brief_check_in", quality, mustRevise: true, criticalHarmFlags: ["unsupported_inference", "over_escalation"], ...dialogueReview, decisionTimeMs: 1_500 }, cookie), bindings);
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
  for (const table of ["evaluation_participants","evaluation_scenario_responses","evaluation_expert_references","evaluation_dialogues","evaluation_surveys"]) {
    assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count, 0, table);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM evaluation_used_codes").first()).count, 1);
});

test("research suppresses n<5 and CSV exports workload, quote, structured teacher and expert quality fields", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-CSV1", EVALUATION_EXPERT_CODES: "EXPERT-CODE-CSV01", RESEARCH_ACCESS_KEY: RESEARCH_KEY };
  installQwenStub(t);
  const cookie = await start("TEACHER-CODE-CSV1", bindings); await completeTeacherCases(cookie, bindings);
  assert.equal((await callApi("/api/evaluation/response", mutation(survey(52), cookie), bindings)).status, 200);
  const expert = await start("EXPERT-CODE-CSV01", bindings, { quoteConsent: false });
  assert.equal((await callApi("/api/evaluation/response", mutation({ kind: "expert-reference", scenarioId: "C01", ...reference }, expert), bindings)).status, 200);
  await completeDialogue(expert, bindings, "C01");
  assert.equal((await callApi("/api/evaluation/response", mutation({ scenarioId: "C01", chosenAction: "monitor", quality, mustRevise: false, criticalHarmFlags: ["none"], ...dialogueReview, decisionTimeMs: 2_000 }, expert), bindings)).status, 200);
  const summary = await callApi("/api/research/summary", { headers: { "x-research-key": RESEARCH_KEY } }, bindings);
  const body = await summary.json(); assert.equal(body.minimumGroupSize, 5); assert.deepEqual(body.groups, []);
  assert.deepEqual(new Set(body.suppressedGroups), new Set(["teacher", "expert"]));
  const exported = await callApi("/api/research/export", { headers: { "x-research-key": RESEARCH_KEY } }, bindings);
  assert.equal(exported.headers.get("cache-control"), "no-store");
  const csv = await exported.text(); const header = csv.replace(/^\uFEFF/u, "").split(/\r?\n/u, 1)[0];
  for (const field of ["quote_consent","evidence_selected_json","context_judgment","reason_codes_json","privacy_choice","confidence","quality_json","must_revise","critical_harm_flags_json","reference_evidence_json","reference_confidence","dialogue_transcript_json","dialogue_rating_json","dialogue_model_id","dialogue_total_latency_ms","workload_score"]) assert.match(header, new RegExp(`(?:^|,)${field}(?:,|$)`, "u"));
  assert.doesNotMatch(header, /context_check|rationale|output_rating/u);
});

test("formal dialogue starts during teacher case, rejects client text, preserves history, and C08 makes zero Qwen calls", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-LIVE1", QWEN_API_KEY: "test-qwen-key" };
  const cookie = await start("TEACHER-CODE-LIVE1", bindings);
  const calls = installQwenStub(t, "我听见你有些挫败。可以先只看第一步，也可以请数学老师陪你一起拆解。");
  const rejected = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 0, message: "恶意真实自由文本" }, cookie), bindings);
  assert.equal(rejected.status, 400);
  const first = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 0 }, cookie), bindings);
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.json(); assert.equal(firstBody.dialogue.nextTurn, 1); assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /这次数学没考好/u); assert.doesNotMatch(JSON.stringify(calls[0]), /恶意真实/u);
  const stale = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 0 }, cookie), bindings);
  assert.equal(stale.status, 409, "CAS rejects replayed/double-clicked turn");
  const second = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 1 }, cookie), bindings);
  assert.equal(second.status, 200); assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1]), /这次数学没考好/u, "second provider request carries stored server history");
  assert.match(JSON.stringify(calls[1]), /我听见你有些挫败/u);
  const qwenCallsBeforeCrisis = calls.length;
  const crisis = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C08", expectedTurn: 0 }, cookie), bindings);
  assert.equal(crisis.status, 200, await crisis.clone().text());
  const crisisBody = await crisis.json(); assert.equal(crisisBody.dialogue.completed, true); assert.equal(crisisBody.dialogue.safetyEnded, true);
  assert.equal(calls.length, qwenCallsBeforeCrisis, "C08 crisis is cut off locally before any Qwen call");
  const stored = await db.prepare("SELECT * FROM evaluation_dialogues WHERE scenario_id='C08'").first();
  assert.equal(stored.model_id, "local_crisis_rule"); assert.equal(stored.next_turn, 1); assert.equal(stored.safety_ended, 1);
  const sealed = await callApi("/api/evaluation/response", mutation({ scenarioId: "C08", ...decision, ...dialogueReview }, cookie), bindings);
  assert.equal(sealed.status, 200, await sealed.clone().text());
  const firstSaved = await db.prepare("SELECT chosen_action FROM evaluation_scenario_responses WHERE scenario_id='C08'").first();
  const duplicate = await callApi("/api/evaluation/response", mutation({ scenarioId: "C08", ...decision, chosenAction: "referral", ...dialogueReview }, cookie), bindings);
  assert.equal(duplicate.status, 409, "dialogue-backed scenario is sealed exactly once");
  assert.equal((await db.prepare("SELECT chosen_action FROM evaluation_scenario_responses WHERE scenario_id='C08'").first()).chosen_action, firstSaved.chosen_action,
    "rejected duplicate cannot overwrite the already sealed scenario response");
  const legacy = await callApi("/api/evaluation/live-demo", mutation({ scenarioId: "C01" }, cookie), bindings);
  assert.equal(legacy.status, 410);
});

test("v5.4 dialogue writes reject a participant from the previous consent protocol", async (t) => {
  const { mf, db } = await newD1(); t.after(() => mf.dispose());
  const bindings = { DB: db, ...STUDY_BINDINGS, EVALUATION_TEACHER_CODES: "TEACHER-CODE-OLD-CONSENT" };
  const cookie = await start("TEACHER-CODE-OLD-CONSENT", bindings);
  await db.prepare("UPDATE evaluation_participants SET consent_version='adult-evaluation-2026-08-v1'").run();
  const response = await callApi("/api/evaluation/dialogue", mutation({ scenarioId: "C01", expectedTurn: 0 }, cookie), bindings);
  assert.equal(response.status, 409);
  assert.match(await response.text(), /说明已更新/u);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM evaluation_dialogues").first()).count, 0);
});

test("evaluation UI keeps UTF-8 disclosures and has no formal-case free-text judgment controls", async () => {
  const source = await readFile(new URL("../app/evaluate/EvaluationApp.tsx", import.meta.url), "utf8");
  assert.match(source, /合成情境/u); assert.match(source, /禁止输入真实学生信息/u);
  assert.doesNotMatch(source, /name="(?:contextCheck|rationale)"/u);
  assert.doesNotMatch(source, /鐨|鍙|绱/u);
});
