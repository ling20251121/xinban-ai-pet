"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Role = "teacher" | "expert";
type FrozenOutput = { status: string; emotion: string; need: string; evidence: string; alert: string; suggestion: string; safetyNote: string };
type Scenario = {
  id: string; order: number; title: string; caseType: string; studentMessage: string;
  mood: string; classroomContext: string; petReply?: string; condition: string;
  completed: boolean; expertReference: null | { action: string }; frozenOutput?: FrozenOutput;
};
type StudyInfo = {
  researcher: string; contact: string; ethicsStatus: string; retentionDays: number;
  purpose: string; duration: string; compensation: string; risks: string; benefits: string;
  storage: string; withdrawalBoundary: string;
};
type State = {
  participant: { code: string; role: Role; experienceBand: string; submitted: boolean };
  scenarios: Scenario[];
  actionLabels: Record<string, string>;
  optionLabels: {
    evidence: Record<string, string>; context: Record<string, string>;
    reasons: Record<string, string>; privacy: Record<string, string>;
    criticalHarm: Record<string, string>;
  };
};

const SUS = [
  "我愿意经常使用这个系统。", "我觉得这个系统不必要地复杂。", "我觉得这个系统容易使用。",
  "我需要技术人员帮助才能使用这个系统。", "我觉得系统各项功能整合良好。", "我觉得系统存在太多不一致。",
  "我认为大多数人能很快学会使用。", "我觉得系统使用起来很笨重。", "使用这个系统时我很有信心。",
  "开始使用前，我需要学习很多东西。",
];
const QUALITY_LABELS: Record<string, string> = {
  warmth: "温暖支持", relevance: "相关性", ageAppropriate: "年龄适切",
  nonDiagnostic: "非诊断边界", evidence: "证据充分", privacySafety: "隐私与安全",
  actionProportionality: "行动适度",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "提交失败，请重试。");
  return payload as T;
}

function post(body: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function ChipGroup({ name, labels, exclude = [] }: { name: string; labels: Record<string, string>; exclude?: string[] }) {
  return <div className="chip-group">{Object.entries(labels).filter(([value]) => !exclude.includes(value)).map(([value, label]) =>
    <label className="choice-chip" key={value}><input type="checkbox" name={name} value={value} />{label}</label>)}</div>;
}

function FixedDecisionFields({ state, prefix = "" }: { state: State; prefix?: "reference" | "" }) {
  const names = prefix ? {
    evidence: "referenceEvidence", context: "referenceContextJudgment", action: "referenceAction",
    reasons: "referenceReasonCodes", privacy: "referencePrivacyChoice", confidence: "referenceConfidence",
  } : {
    evidence: "evidenceSelected", context: "contextJudgment", action: "chosenAction",
    reasons: "reasonCodes", privacy: "privacyChoice", confidence: "confidence",
  };
  return <>
    <fieldset><legend>证据来源（固定合成信息，可多选）</legend><ChipGroup name={names.evidence} labels={state.optionLabels.evidence} exclude={prefix ? ["frozen_ai_cue"] : []} /></fieldset>
    <label>情境判断<select name={names.context} required defaultValue=""><option value="" disabled>请选择</option>{Object.entries(state.optionLabels.context).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>{prefix ? "独立参考行动" : "最终行动"}<select name={names.action} required defaultValue=""><option value="" disabled>请选择</option>{Object.entries(state.actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <fieldset><legend>判断理由（固定选项，最多四项）</legend><ChipGroup name={names.reasons} labels={state.optionLabels.reasons} /></fieldset>
    <label>隐私处理范围<select name={names.privacy} required defaultValue=""><option value="" disabled>请选择</option>{Object.entries(state.optionLabels.privacy).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>判断信心（1=很低，5=很高）<select name={names.confidence} required defaultValue=""><option value="" disabled>请选择</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
  </>;
}

export default function EvaluationApp() {
  const [state, setState] = useState<State | null>();
  const [info, setInfo] = useState<StudyInfo | null>();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveReply, setLiveReply] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  const started = useRef(0);

  async function load() {
    const data = await api<State>("/api/evaluation/session");
    setState(data);
    setSelected((current) => data.participant.submitted
      ? (current && data.scenarios.some((item) => item.id === current) ? current : data.scenarios[0]?.id ?? null)
      : (current && data.scenarios.some((item) => item.id === current && !item.completed)
        ? current : data.scenarios.find((item) => !item.completed)?.id ?? null));
  }

  useEffect(() => {
    let active = true;
    void api<StudyInfo>("/api/evaluation/info").then((value) => { if (active) setInfo(value); }).catch((value: unknown) => {
      if (active) { setInfo(null); setError(value instanceof Error ? value.message : "研究说明无法读取。"); }
    });
    void api<State>("/api/evaluation/session").then((value) => {
      if (!active) return;
      setState(value); setSelected(value.participant.submitted
        ? value.scenarios[0]?.id ?? null
        : value.scenarios.find((item) => !item.completed)?.id ?? null);
    }).catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, []);

  const scenario = useMemo(() => state?.scenarios.find((item) => item.id === selected) ?? null, [state, selected]);
  useEffect(() => { started.current = Date.now(); }, [selected]);

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/evaluation/session", post({
        experienceBand: data.get("experienceBand"), accessCode: data.get("accessCode"),
        adultConfirmed: data.get("adultConfirmed") === "on",
        syntheticOnlyConfirmed: data.get("syntheticOnlyConfirmed") === "on",
        dataUseConfirmed: data.get("dataUseConfirmed") === "on",
        voluntaryConfirmed: data.get("voluntaryConfirmed") === "on",
        quoteConsent: data.get("quoteConsent") === "on",
      }));
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "无法进入评估。"); }
  }

  async function freezeReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!scenario) return; setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/evaluation/response", post({
        kind: "expert-reference", scenarioId: scenario.id,
        referenceAction: data.get("referenceAction"),
        referenceEvidence: data.getAll("referenceEvidence"),
        referenceContextJudgment: data.get("referenceContextJudgment"),
        referenceReasonCodes: data.getAll("referenceReasonCodes"),
        referencePrivacyChoice: data.get("referencePrivacyChoice"),
        referenceConfidence: data.get("referenceConfidence"),
      }));
      await load(); setSelected(scenario.id); setLiveReply("");
    } catch (value) { setError(value instanceof Error ? value.message : "冻结独立判断失败。"); }
  }

  async function saveCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!scenario || !state) return; setError("");
    const data = new FormData(event.currentTarget);
    const quality = Object.fromEntries(Object.keys(QUALITY_LABELS).map((key) => [key, data.get(key)]));
    const body = state.participant.role === "teacher" ? {
      scenarioId: scenario.id, chosenAction: data.get("chosenAction"),
      evidenceSelected: data.getAll("evidenceSelected"), contextJudgment: data.get("contextJudgment"),
      reasonCodes: data.getAll("reasonCodes"), privacyChoice: data.get("privacyChoice"),
      confidence: data.get("confidence"), decisionTimeMs: Date.now() - started.current,
    } : {
      scenarioId: scenario.id, chosenAction: data.get("chosenAction"), quality,
      mustRevise: data.get("mustRevise") === "yes", criticalHarmFlags: data.getAll("criticalHarmFlags"),
      decisionTimeMs: Date.now() - started.current,
    };
    try {
      await api("/api/evaluation/response", post(body));
      setNotice(`${scenario.id} 已保存，可稍后继续。`); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "保存失败。"); }
  }

  async function runLiveDemo() {
    if (!scenario) return;
    setLiveBusy(true); setError("");
    try {
      const result = await api<{ reply: string }>("/api/evaluation/live-demo", post({ scenarioId: scenario.id }));
      setLiveReply(result.reply);
    } catch (value) { setError(value instanceof Error ? value.message : "实时演示暂不可用。"); }
    finally { setLiveBusy(false); }
  }

  async function submitSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try {
      await api("/api/evaluation/response", post({ kind: "survey", sus: SUS.map((_, index) => Number(data.get(`sus${index}`))), trust: data.get("trust"), appropriateness: data.get("appropriateness"), usability: data.get("usability"), safetyBoundary: data.get("safetyBoundary"), workload: data.get("workload"), feedback: data.get("feedback") }));
      setNotice("评估已提交。感谢你的专业判断。"); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "问卷提交失败。"); }
  }

  async function withdraw() {
    if (!window.confirm("撤回将永久删除本编号的案例回答和问卷，且无法恢复。确认继续？")) return;
    try { await api("/api/evaluation/withdraw", { method: "DELETE" }); setState(null); setNotice("研究数据已撤回并删除。"); }
    catch (value) { setError(value instanceof Error ? value.message : "撤回失败。"); }
  }

  if (state === undefined || info === undefined) return <main className="eval-shell"><section className="eval-card"><h1>成人合成情境评估</h1><p>正在读取研究说明。本页只展示固定<strong>合成情境</strong>，<strong>禁止输入真实学生信息</strong>。</p></section></main>;
  if (!state) return <main className="eval-shell"><section className="eval-hero"><div className="eval-pet">🐶</div><p className="eyebrow">EITT 成人原型评估</p><h1>用专业判断，帮助心伴变得更可靠</h1><p>仅邀请成年教师与专家；全部学生、学校、表达和趋势都是固定的<strong>合成情境</strong>。</p></section><section className="eval-card consent-card"><h2>研究说明与知情同意</h2>{info ? <><dl className="study-info"><div><dt>目的</dt><dd>{info.purpose}</dd></div><div><dt>预计用时</dt><dd>{info.duration}</dd></div><div><dt>风险</dt><dd>{info.risks}</dd></div><div><dt>收益与补偿</dt><dd>{info.benefits}；{info.compensation}</dd></div><div><dt>存储与保存期</dt><dd>{info.storage}；最多 {info.retentionDays} 天</dd></div><div><dt>撤回边界</dt><dd>{info.withdrawalBoundary}</dd></div><div><dt>研究者与联系</dt><dd>{info.researcher}；{info.contact}</dd></div><div><dt>伦理状态</dt><dd>{info.ethicsStatus}</dd></div></dl>{/pending|待审|未批准|审批中/iu.test(info.ethicsStatus) && <p className="ethics-warning">当前仅作系统测试，不作为论文实证结果。</p>}<form onSubmit={enter} className="eval-form"><label>相关工作经验<select name="experienceBand" required><option value="0-2">0–2 年</option><option value="3-5">3–5 年</option><option value="6-10">6–10 年</option><option value="11+">11 年以上</option></select></label><label>教师/专家一次性访问码（角色由码决定）<input name="accessCode" autoComplete="one-time-code" maxLength={80} required /></label><label className="check"><input type="checkbox" name="adultConfirmed" required />我确认已满 18 周岁。</label><label className="check"><input type="checkbox" name="syntheticOnlyConfirmed" required />我理解全部案例均为合成情境，并承诺<strong>禁止输入真实学生信息</strong>。</label><label className="check"><input type="checkbox" name="dataUseConfirmed" required />我理解收集角色、经验区间、固定案例决策、用时、量表和可选反馈用于匿名研究汇总。</label><label className="check"><input type="checkbox" name="voluntaryConfirmed" required />我自愿参加，拒绝或撤回不会受到不利影响。</label><label className="check optional"><input type="checkbox" name="quoteConsent" />可选：我允许研究者逐字引用我的可选反馈（拒绝不影响参与）。</label><button type="submit">同意并进入评估</button></form></> : <p className="error">{error || "研究说明未完整配置，当前不能收集数据。"}</p>}</section></main>;

  const completed = state.scenarios.filter((item) => item.completed).length;
  if (completed === 12 && !state.participant.submitted) return <main className="eval-shell"><header className="study-head"><div><p className="eyebrow">匿名编号 {state.participant.code}</p><h1>12 个合成案例已完成</h1></div><button className="danger" onClick={withdraw}>撤回并删除</button></header><section className="eval-card"><h2>最后的使用体验问卷</h2><form onSubmit={submitSurvey} className="survey"><fieldset><legend>SUS 系统可用性量表</legend>{SUS.map((question, index) => <label key={question}>{index + 1}. {question}<select name={`sus${index}`} required defaultValue=""><option value="" disabled>请选择 1–5</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</fieldset><fieldset><legend>总体评价（1=非常不同意，5=非常同意）</legend>{[["trust","我能适度信任系统而不会盲从。"],["appropriateness","建议行动符合中国学校情境且适度。"],["usability","教师/专家界面清晰且可用。"],["safetyBoundary","系统清楚守住安全、隐私与人工决策边界。"]].map(([name, question]) => <label key={name}>{question}<select name={name} required defaultValue=""><option value="" disabled>请选择</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</fieldset><label>完成全部任务时的工作负荷（0=几乎没有，100=非常高）<input name="workload" type="number" min="0" max="100" step="1" required /></label><label>可选反馈（禁止填写真实个人或学校信息）<textarea name="feedback" maxLength={500} /></label><button type="submit">提交匿名评估</button></form>{notice && <p className="success">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}</section></main>;

  if (state.participant.submitted) return <main className="eval-shell"><header className="study-head"><div><p className="eyebrow">匿名编号 {state.participant.code}</p><h1>正式评估已提交</h1><p>感谢你的专业判断。下面的实时 Qwen 体验完全独立，不计入评分，也不写入研究数据。</p></div><button className="danger" onClick={withdraw}>撤回并删除</button></header><nav className="case-nav" aria-label="选择合成演示案例">{state.scenarios.map((item) => <button key={item.id} className={item.id === selected ? "active" : ""} onClick={() => { setSelected(item.id); setLiveReply(""); }}>{item.id}</button>)}</nav>{scenario && <section className="eval-card scenario"><div className="scenario-top"><span>合成情境 {scenario.id}</span><b>独立 API 演示区</b></div><h2>{scenario.title}</h2><div className="prototype-grid"><article><h3>合成学生表达</h3><p className="bubble student">心情：{scenario.mood}<br />“{scenario.studentMessage}”</p></article><article><h3>合成课堂情境</h3><p className="context">{scenario.classroomContext}</p></article></div><section className="live-demo"><b>实时 Qwen 合成情境体验</b><p>只发送服务端固定合成内容；不接受真实学生文字，不计入评分，不保存回应。</p><button type="button" onClick={runLiveDemo} disabled={liveBusy}>{liveBusy ? "正在生成…" : "体验本案例实时回应"}</button>{liveReply && <p className="bubble pet">🐶 {liveReply}</p>}</section>{error && <p role="alert" className="error">{error}</p>}</section>}</main>;

  const revealed = state.participant.role === "teacher" || Boolean(scenario?.expertReference);
  return <main className="eval-shell"><header className="study-head"><div><p className="eyebrow">匿名编号 {state.participant.code} · {state.participant.role === "teacher" ? "教师流" : "专家盲评流"}</p><h1>固定合成学生案例评估</h1><p>进度 {completed}/12 · 分批保存，可关闭后继续</p></div><button className="danger" onClick={withdraw}>撤回并删除</button></header><nav className="case-nav" aria-label="案例进度">{state.scenarios.map((item) => <button key={item.id} className={`${item.id === selected ? "active" : ""} ${item.completed ? "done" : ""}`} onClick={() => { setSelected(item.id); setLiveReply(""); }}>{item.id}</button>)}</nav>{scenario && <section className="eval-card scenario"><div className="scenario-top"><span>合成情境 {scenario.id}</span><b>{scenario.condition === "dashboard_cccr" ? "仪表板 + CCCR" : scenario.condition === "expert_blind" ? "专家盲评" : "仅仪表板"}</b></div><h2>{scenario.title}</h2><div className="prototype-grid"><article><h3>学生端原型（只读）</h3><p className="bubble student">心情：{scenario.mood}<br />“{scenario.studentMessage}”</p>{scenario.petReply && <p className="bubble pet">🐶 {scenario.petReply}</p>}</article><article><h3>合成课堂情境</h3><p className="context">{scenario.classroomContext}</p></article></div>{state.participant.role === "expert" && !revealed ? <form className="eval-form" onSubmit={freezeReference}><div className="method-note"><strong>揭示前独立判断：</strong>请一次性提交以下固定结构；服务器冻结全部字段后才揭示 AI-pet 回应和教师线索，冻结后不可修改。</div><FixedDecisionFields state={state} prefix="reference" /><button type="submit">冻结完整独立判断并查看 AI 输出</button></form> : null}{revealed && <><article className={`ai-cue alert-${scenario.frozenOutput?.alert ?? "green"}`}><div><b>冻结 AI 线索</b><span>非实时生成 · 版本化输出</span></div>{scenario.frozenOutput && <ul><li>状态：{scenario.frozenOutput.status}</li><li>可能情绪：{scenario.frozenOutput.emotion}</li><li>支持需要：{scenario.frozenOutput.need}</li><li>证据：{scenario.frozenOutput.evidence}</li><li>建议：{scenario.frozenOutput.suggestion}</li><li>边界：{scenario.frozenOutput.safetyNote}</li></ul>}</article><form onSubmit={saveCase} className="eval-form">{state.participant.role === "teacher" ? <>{scenario.condition === "dashboard_cccr" && <div className="method-note"><strong>CCCR 分步提示：</strong>依次查看线索、核对情境、选择行动并反思隐私边界。记录字段与“仅仪表板”条件完全相同。</div>}<FixedDecisionFields state={state} /></> : <><label>评价后最终行动<select name="chosenAction" required defaultValue=""><option value="" disabled>请选择</option>{Object.entries(state.actionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><fieldset><legend>冻结输出质量（1=很差，5=很好）</legend>{Object.entries(QUALITY_LABELS).map(([name,label]) => <label key={name}>{label}<select name={name} required defaultValue=""><option value="" disabled>请选择 1–5</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</fieldset><fieldset><legend>该输出是否必须修改？</legend><label className="check"><input type="radio" name="mustRevise" value="yes" required />是</label><label className="check"><input type="radio" name="mustRevise" value="no" required />否</label></fieldset><fieldset><legend>关键伤害风险（固定选项）</legend><ChipGroup name="criticalHarmFlags" labels={state.optionLabels.criticalHarm} /></fieldset></>}<button type="submit">保存此案例并继续</button></form></>}{notice && <p className="success">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}</section>}</main>;
}
