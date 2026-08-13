"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type StudentUiTaskId = "mood_select" | "fixed_expression" | "support_tool";
export type StudentUiTaskStatus = "not_started" | "in_progress" | "success" | "unable";
export type StudentUiUnableReason = "could_not_find" | "unclear_instruction" | "other_no_text";

export type StudentUiTaskRecord = {
  taskId: StudentUiTaskId;
  status: StudentUiTaskStatus;
  errorCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  unableReason: StudentUiUnableReason | null;
};

export type StudentUiTaskState = {
  version: string;
  required: StudentUiTaskId[];
  current: StudentUiTaskId | null;
  tasks: StudentUiTaskRecord[];
  feedback: { actualEaseScore: number; ratedAt: string } | null;
};

export type StudentUiTaskCommand =
  | { taskId: StudentUiTaskId; event: "start" | "incorrect" | "success" }
  | { taskId: StudentUiTaskId; event: "unable"; unableReason: StudentUiUnableReason };

type Props = {
  state: StudentUiTaskState;
  onTaskEvent: (command: StudentUiTaskCommand) => Promise<void>;
  onRate: (score: number) => Promise<void>;
};

const TASKS: Array<{ id: StudentUiTaskId; title: string }> = [
  { id: "mood_select", title: "选择心情" },
  { id: "fixed_expression", title: "发送合成表达" },
  { id: "support_tool", title: "使用支持工具" },
];

const MOODS = [
  { id: "calm", label: "平静", cue: "心里比较安稳", tone: "mint" },
  { id: "happy", label: "开心", cue: "有一点轻松", tone: "sun" },
  { id: "tense", label: "紧张", cue: "身体有些绷紧", tone: "violet" },
  { id: "sad", label: "难过", cue: "想被理解一下", tone: "blue" },
] as const;

const EXPRESSIONS = [
  "今天课间和同学聊得很开心。",
  "数学课发言时，我有点紧张，想先慢慢说一说。",
  "放学后我想先整理好书包。",
] as const;

const REQUIRED_EXPRESSION = EXPRESSIONS[1];
const TERMINAL_STATUSES = new Set<StudentUiTaskStatus>(["success", "unable"]);

export default function StudentPrototypeTask({ state, onTaskEvent, onRate }: Props) {
  const [mood, setMood] = useState("");
  const [expression, setExpression] = useState("");
  const [modal, setModal] = useState<"breathing" | "circle" | null>(null);
  const [breathingRunning, setBreathingRunning] = useState(false);
  const [trustedContact, setTrustedContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unableOpen, setUnableOpen] = useState(false);
  const [unableReason, setUnableReason] = useState<StudentUiUnableReason | "">("");
  const [easeScore, setEaseScore] = useState("");
  const modalTitleRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  function closeModal() {
    setModal(null);
    setBreathingRunning(false);
    window.setTimeout(() => lastTriggerRef.current?.focus(), 0);
  }

  const taskMap = useMemo(() => new Map(state.tasks.map((task) => [task.taskId, task])), [state.tasks]);
  const terminalCount = state.required.filter((taskId) => TERMINAL_STATUSES.has(taskMap.get(taskId)?.status ?? "not_started")).length;
  const currentId = state.current ?? state.required.find((taskId) => !TERMINAL_STATUSES.has(taskMap.get(taskId)?.status ?? "not_started")) ?? null;
  const currentRecord = currentId ? taskMap.get(currentId) : undefined;
  const currentTask = TASKS.find((task) => task.id === currentId) ?? null;
  const allTerminal = terminalCount === state.required.length;

  useEffect(() => {
    if (!modal) return;
    modalTitleRef.current?.focus();
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
      if (event.key === "Tab" && modalRef.current) {
        const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !focusable.includes(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [modal]);

  function openModal(kind: "breathing" | "circle", trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setModal(kind);
    setMessage("");
    setError("");
    if (kind === "circle" && currentId === "support_tool" && currentRecord?.status === "in_progress") {
      void send({ event: "incorrect", taskId: "support_tool" }, "这次任务要求打开“和小伴呼吸一下”；支持圈可以浏览，但本次选择已记为一次错误尝试。");
    }
  }

  async function send(command: StudentUiTaskCommand, successMessage?: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await onTaskEvent(command);
      if (successMessage) setMessage(successMessage);
      if (command.event === "success" || command.event === "unable") {
        setUnableOpen(false);
        setUnableReason("");
      }
      return true;
    } catch (value) {
      setError(value instanceof Error ? value.message : "任务记录没有保存，请重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chooseMood(id: string) {
    if (currentId !== "mood_select" || currentRecord?.status !== "in_progress") return;
    setMood(id);
    if (id === "tense") await send({ event: "success", taskId: "mood_select" }, "选择心情任务已完成。");
    else {
      await send({ event: "incorrect", taskId: "mood_select" });
      setMessage("这次任务请找到并选择“紧张”，可以再试一次。");
    }
  }

  async function sendExpression() {
    if (currentId !== "fixed_expression" || currentRecord?.status !== "in_progress") return;
    if (expression === REQUIRED_EXPRESSION) await send({ event: "success", taskId: "fixed_expression" }, "发送合成表达任务已完成。");
    else {
      await send({ event: "incorrect", taskId: "fixed_expression" });
      setMessage(expression ? "请按照任务卡，选择包含“数学课发言”和“紧张”的那一条。" : "请先从三条固定合成表达中选择一条。");
    }
  }

  async function completeSupportTool() {
    if (currentId !== "support_tool" || currentRecord?.status !== "in_progress") return;
    if (await send({ event: "success", taskId: "support_tool" }, "使用支持工具任务已完成。")) closeModal();
  }

  async function markUnable() {
    if (!currentId || !unableReason || currentRecord?.status !== "in_progress") return;
    await send({ event: "unable", taskId: currentId, unableReason }, "已记录无法完成；这不会影响参与，也不是对你的考核。");
  }

  async function saveRating() {
    const score = Number(easeScore);
    if (!Number.isInteger(score) || score < 1 || score > 5 || busy) return;
    setBusy(true);
    setError("");
    try {
      await onRate(score);
      setMessage("实际易用性评分已保存，现在可以继续案例评价。");
    } catch (value) {
      setError(value instanceof Error ? value.message : "评分没有保存，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="student-task-lab" aria-labelledby="student-task-title">
    <header className="student-task-heading">
      <div>
        <p className="dialogue-kicker">学生端可交互合成任务</p>
        <h2 id="student-task-title">亲手完成 3 个短任务</h2>
        <p>请按任务卡操作，再评价实际易用性。这里不登录学生账号、不调用 AI 或麦克风，也不会保存任何自由文本。</p>
      </div>
      <span className="student-task-progress">{terminalCount}/3</span>
    </header>

    <ol className="student-task-steps" aria-label="学生端任务进度">
      {TASKS.map((task, index) => {
        const record = taskMap.get(task.id);
        return <li key={task.id} className={record?.status === "success" ? "is-complete" : record?.status === "unable" ? "is-unable" : currentId === task.id ? "is-active" : ""}>
          <span>{record?.status === "success" ? "✓" : record?.status === "unable" ? "—" : index + 1}</span><strong>{task.title}</strong>
        </li>;
      })}
    </ol>

    {allTerminal && <div className="student-task-finished" role="status"><span aria-hidden="true">✓</span><div><h3>3 个合成任务都已到达终点</h3><p>无论成功或无法完成，记录都同样有效。</p></div></div>}
    {allTerminal && !state.feedback && <form className="student-task-rating" onSubmit={(event) => { event.preventDefault(); void saveRating(); }}>
      <fieldset><legend>就刚才这 3 项隔离的学生端合成任务而言，我能够轻松完成这些任务。</legend><p>请把成功、错误尝试或无法完成的经历都纳入判断。这是自编单项，不代表真实学生群体的使用体验。</p><div role="radiogroup" aria-label="实际易用性评分，1为非常不同意，5为非常同意">{[1,2,3,4,5].map((score) => <label key={score}><input type="radio" name="actual-ease" value={score} checked={easeScore === String(score)} onChange={() => setEaseScore(String(score))} required /><strong>{score}</strong><span>{score === 1 ? "非常不同意" : score === 5 ? "非常同意" : ""}</span></label>)}</div></fieldset><button type="submit" className="student-task-primary" disabled={!easeScore || busy}>{busy ? "正在保存…" : "保存评分并进入案例评价"}</button>
    </form>}
    {allTerminal && state.feedback && <p className="student-task-rated" role="status">实际易用性评分已保存，可以进入 12 个合成案例。</p>}

    {!allTerminal && currentTask && currentRecord?.status === "not_started" && <article className="student-task-stage student-task-intro" aria-labelledby="task-ready-title">
      <div className="student-task-instruction"><span>任务 {TASKS.findIndex((task) => task.id === currentTask.id) + 1}</span><div><h3 id="task-ready-title">{currentTask.title}</h3><p>阅读下一页的固定任务卡后开始。系统记录从点击开始到成功或标记无法完成的经过时间；离开或关闭页面期间也会计入。系统不记录键盘、鼠标轨迹或任何真实内容。</p></div></div>
      <button className="student-task-primary" type="button" disabled={busy} onClick={() => send({ event: "start", taskId: currentTask.id })}>{busy ? "正在开始…" : "查看任务卡并开始"}</button>
    </article>}

    {!allTerminal && currentRecord?.status === "in_progress" && currentId === "mood_select" && <article className="student-task-stage" aria-labelledby="mood-task-title">
      <div className="student-task-instruction"><span>任务 1</span><div><h3 id="mood-task-title">请选择“紧张”</h3><p>想象这是一条固定合成情境，不要代入自己或真实学生。</p></div></div>
      <div className="student-task-moods" role="group" aria-label="选择固定合成心情">
        {MOODS.map((item) => <button key={item.id} type="button" className={`tone-${item.tone} ${mood === item.id ? "is-selected" : ""}`} aria-pressed={mood === item.id} onClick={() => void chooseMood(item.id)} disabled={busy}>
          <span aria-hidden="true" /><strong>{item.label}</strong><small>{item.cue}</small>
        </button>)}
      </div>
    </article>}

    {!allTerminal && currentRecord?.status === "in_progress" && currentId === "fixed_expression" && <article className="student-task-stage" aria-labelledby="expression-task-title">
      <div className="student-task-instruction"><span>任务 2</span><div><h3 id="expression-task-title">发送指定的合成表达</h3><p>请选择包含“数学课发言”和“紧张”的那一条，再点击发送。</p></div></div>
      <div className="student-task-expressions" role="radiogroup" aria-label="固定合成表达候选">
        {EXPRESSIONS.map((item) => <label key={item} className={expression === item ? "is-selected" : ""}><input type="radio" name="synthetic-expression" value={item} checked={expression === item} onChange={() => { setExpression(item); setMessage(""); }} disabled={busy} /><span>{item}</span></label>)}
      </div>
      <button className="student-task-primary" type="button" onClick={() => void sendExpression()} disabled={busy}>{busy ? "正在记录…" : "发送这条合成表达"}</button>
    </article>}

    {!allTerminal && currentRecord?.status === "in_progress" && currentId === "support_tool" && <article className="student-task-stage" aria-labelledby="support-task-title">
      <div className="student-task-instruction"><span>任务 3</span><div><h3 id="support-task-title">找到能量补给并开始练习</h3><p>打开“和小伴呼吸一下”，点击开始，然后暂停或结束。不需要等待一分钟。</p></div></div>
      <div className="student-task-tools">
        <button type="button" className="is-breathing" onClick={(event) => openModal("breathing", event.currentTarget)} aria-haspopup="dialog" disabled={busy}>
          <span className="student-task-orbit" aria-hidden="true"><i /></span><span><small>3 分钟能量补给</small><strong>和小伴呼吸一下</strong><em>现在开始 →</em></span>
        </button>
        <button type="button" className="is-circle" onClick={(event) => openModal("circle", event.currentTarget)} aria-haspopup="dialog" disabled={busy}>
          <span className="student-task-people" aria-hidden="true">人</span><span><small>我的支持圈</small><strong>找一个可信任的人</strong><em>也可以先看看 →</em></span>
        </button>
      </div>
    </article>}

    {!allTerminal && currentRecord?.status === "in_progress" && <div className="student-task-unable">
      <button type="button" className="student-task-unable-toggle" aria-expanded={unableOpen} onClick={() => setUnableOpen((open) => !open)}>我无法完成这个任务</button>
      {unableOpen && <fieldset><legend>请选择一个固定原因</legend><p>这不会影响参与，也不是对你的能力进行考核；记录困难本身对改进设计很重要。</p>{[["could_not_find", "找不到需要的功能"], ["unclear_instruction", "没有理解任务说明"], ["other_no_text", "其他原因（不填写文字）"]].map(([value, label]) => <label key={value}><input type="radio" name="unable-reason" value={value} checked={unableReason === value} onChange={() => setUnableReason(value as StudentUiUnableReason)} />{label}</label>)}<button type="button" className="student-task-secondary" disabled={!unableReason || busy} onClick={() => void markUnable()}>{busy ? "正在记录…" : "确认无法完成并继续"}</button></fieldset>}
    </div>}

    {currentRecord && currentRecord.errorCount > 0 && !allTerminal && <p className="student-task-errors">本任务已记录 {currentRecord.errorCount} 次未完成尝试；请继续尝试，或选择“我无法完成”。</p>}
    {(message || error) && <p className={error ? "student-task-error" : "student-task-message"} role={error ? "alert" : "status"}>{error || message}</p>}

    {modal && <div className="student-task-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      {modal === "breathing" ? <section ref={modalRef} className="student-task-modal" role="dialog" aria-modal="true" aria-labelledby="student-breathing-title">
        <button className="student-task-close" type="button" onClick={closeModal} aria-label="关闭能量补给">关闭</button>
        <p className="dialogue-kicker">一分钟练习 · 合成交互任务</p><h2 id="student-breathing-title" ref={modalTitleRef} tabIndex={-1}>让身体先慢下来</h2>
        <div className={`student-task-breathing-orb ${breathingRunning ? "is-running" : ""}`} aria-hidden="true"><span /></div>
        <div className="student-task-breathing-copy" aria-live="polite"><strong>{breathingRunning ? "慢慢吸气，再慢慢呼气" : "准备好了吗"}</strong><span>{breathingRunning ? "可以随时暂停或结束" : "不用做得完美"}</span></div>
        <p>双脚踩稳地面，肩膀轻轻放松。如果不舒服，随时结束。</p>
        <div className="student-task-modal-actions">{!breathingRunning ? <button type="button" className="student-task-primary" onClick={() => setBreathingRunning(true)}>开始呼吸</button> : <><button type="button" className="student-task-primary" onClick={() => void completeSupportTool()} disabled={busy}>{busy ? "正在记录…" : "暂停一下"}</button><button type="button" className="student-task-secondary" onClick={() => void completeSupportTool()} disabled={busy}>结束练习</button></>}</div>
        <small>本练习只有文字和动画，不播放声音，也不会打开麦克风。</small>
      </section> : <section ref={modalRef} className="student-task-modal student-task-circle" role="dialog" aria-modal="true" aria-labelledby="student-circle-title">
        <button className="student-task-close" type="button" onClick={closeModal} aria-label="关闭支持圈">关闭</button>
        <p className="dialogue-kicker">我的支持圈 · 固定合成联系人</p><h2 id="student-circle-title" ref={modalTitleRef} tabIndex={-1}>找一个真实的人陪在身边</h2><p>这些卡片只用于操作演示，不含电话号码，也不会拨号或发送消息。</p>
        <div className="student-task-contact-grid" role="group" aria-label="固定合成联系人">{[["school", "校", "学校心理老师（合成）", "可在心理辅导室当面说"], ["teacher", "师", "班主任（合成）", "可在课间通过学校渠道联系"], ["guardian", "家", "监护人（合成）", "可以请对方陪一会儿"], ["friend", "友", "信任的同学（合成）", "可以一起去找老师"]].map(([id, icon, title, note]) => <button key={id} type="button" className={trustedContact === id ? "is-selected" : ""} aria-pressed={trustedContact === id} onClick={() => setTrustedContact(id)}><span aria-hidden="true">{icon}</span><strong>{title}</strong><small>{note}</small></button>)}</div>
        <button type="button" className="student-task-primary" disabled={!trustedContact} onClick={closeModal}>{trustedContact ? "我知道可以找谁了" : "请先选择一位"}</button><small>这个探索窗口不计入正式任务，也不会保存你的选择。</small>
      </section>}
    </div>}
  </section>;
}
