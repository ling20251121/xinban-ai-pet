"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type MoodOption = {
  id: string;
  label: string;
  emoji: string;
  score: number;
  tone: string;
};

type MoodEntry = {
  id: string;
  mood: string;
  moodScore: number;
  note: string;
  goal: string;
  wantsSupport: boolean;
  safetyLevel: string;
  createdAt: string;
};

const moodOptions: MoodOption[] = [
  { id: "happy", label: "开心", emoji: "☀️", score: 5, tone: "sun" },
  { id: "calm", label: "平静", emoji: "🍃", score: 4, tone: "leaf" },
  { id: "tense", label: "紧张", emoji: "🌤️", score: 3, tone: "sky" },
  { id: "sad", label: "难过", emoji: "🌧️", score: 2, tone: "rain" },
  { id: "upset", label: "烦躁", emoji: "🌋", score: 1, tone: "coral" },
  { id: "unclear", label: "说不清", emoji: "🌫️", score: 0, tone: "mist" },
];

const quickPrompts = ["今天有件小事让我开心", "学习上有点卡住", "和同学相处有点难", "我想先安静一下"];

const providerNames: Record<string, string> = {
  deepseek: "DeepSeek",
  doubao: "豆包",
  kimi: "Kimi",
  demo: "安全示例回应",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function csvCell(value: string | number | boolean) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function StudentCompanion() {
  const [participantCode, setParticipantCode] = useState("");
  const [selectedMood, setSelectedMood] = useState<MoodOption | null>(null);
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [wantsSupport, setWantsSupport] = useState(false);
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [reply, setReply] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState<"save" | "ai" | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const crisisRef = useRef<HTMLDivElement>(null);

  const validCode = /^[A-Za-z0-9_-]{4,20}$/.test(participantCode.trim());
  const remaining = 600 - note.length;

  useEffect(() => {
    if (urgent) crisisRef.current?.focus();
  }, [urgent]);

  const loadHistory = useCallback(async (code = participantCode.trim()) => {
    if (!/^[A-Za-z0-9_-]{4,20}$/.test(code)) {
      setError("请输入学校发放的 4–20 位匿名编号（字母、数字、- 或 _）。");
      return;
    }

    setLoadingHistory(true);
    setError("");
    try {
      const response = await fetch(`/api/moods?participantCode=${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { entries?: MoodEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法读取记录");
      setEntries(data.entries || []);
      setHistoryOpen(true);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "暂时无法读取记录");
    } finally {
      setLoadingHistory(false);
    }
  }, [participantCode]);

  async function submitEntry(event: FormEvent<HTMLFormElement>, withAi: boolean) {
    event.preventDefault();
    setError("");
    setNotice("");
    setReply("");
    setProvider("");
    setUrgent(false);

    const code = participantCode.trim();
    if (!validCode) {
      setError("请先输入学校发放的 4–20 位匿名编号。");
      return;
    }
    if (!selectedMood) {
      setError("请选一个最接近的心情，也可以选择“说不清”。");
      return;
    }

    setSubmitting(withAi ? "ai" : "save");
    try {
      const moodResponse = await fetch("/api/moods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantCode: code,
          mood: selectedMood.label,
          moodScore: selectedMood.score,
          note: note.trim(),
          goal: goal.trim(),
          wantsSupport,
        }),
      });
      const moodData = (await moodResponse.json()) as {
        entry?: MoodEntry;
        urgent?: boolean;
        message?: string;
        error?: string;
      };
      if (!moodResponse.ok) throw new Error(moodData.error || "记录没有保存成功，请重试");

      setNotice("今天的记录已保存。你可以随时查看、导出或删除它。");
      if (moodData.entry) setEntries((current) => [moodData.entry!, ...current.filter((item) => item.id !== moodData.entry!.id)]);

      if (moodData.urgent) {
        setUrgent(true);
        setReply(moodData.message || "请现在联系身边可信任的成年人。");
      } else if (withAi) {
        const chatMessage = note.trim() || `我今天的心情是${selectedMood.label}。`;
        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantCode: code, mood: selectedMood.label, message: chatMessage }),
        });
        const chatData = (await chatResponse.json()) as {
          reply?: string;
          urgent?: boolean;
          provider?: string;
          error?: string;
        };
        if (!chatResponse.ok) throw new Error(chatData.error || "小伴暂时没有回应，但你的记录已经保存");
        setReply(chatData.reply || "谢谢你告诉我。我们可以先从一个很小的下一步开始。");
        setProvider(chatData.provider || "demo");
        setUrgent(Boolean(chatData.urgent));
      }

      setNote("");
      setGoal("");
      setWantsSupport(false);
      setHistoryOpen(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法提交，请稍后重试");
    } finally {
      setSubmitting(null);
    }
  }

  async function deleteMyRecords() {
    const code = participantCode.trim();
    if (!validCode) {
      setError("请先输入你的匿名编号。");
      return;
    }
    if (!window.confirm("确定删除这个匿名编号下的全部心情记录吗？删除后无法恢复。")) return;

    setError("");
    try {
      const response = await fetch("/api/moods", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantCode: code }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法删除记录");
      setEntries([]);
      setNotice("这个匿名编号下的记录已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "暂时无法删除记录");
    }
  }

  function downloadMyRecords() {
    if (!entries.length) {
      setError("当前没有可导出的记录。");
      return;
    }
    const rows = [
      ["时间", "心情", "小目标", "主动请求真人支持"],
      ...entries.map((entry) => [formatDate(entry.createdAt), entry.mood, entry.goal, entry.wantsSupport ? "是" : "否"]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xinban-${participantCode.trim()}-records.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const weeklyAverage = useMemo(() => {
    const scored = entries.filter((entry) => entry.moodScore > 0).slice(0, 7);
    if (!scored.length) return null;
    return scored.reduce((sum, entry) => sum + entry.moodScore, 0) / scored.length;
  }, [entries]);

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="心伴 AI-Pet 首页">
          <span className="brand-mark" aria-hidden="true">心</span>
          <span>
            <strong>心伴 AI-Pet</strong>
            <small>Human + AI, with care</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <a href="#today" aria-current="page">今天</a>
          <button type="button" className="nav-button" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>我的记录</button>
          <a href="#help">找人聊聊</a>
          <Link href="/teacher">教师端</Link>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span aria-hidden="true">●</span> 每日 30 秒 · 自主记录</div>
            <h1 id="hero-title">今天的心情，<br /><em>值得被轻轻接住。</em></h1>
            <p>你可以只选一个心情、写几句，或者今天跳过。这里不是心理测评，也不会给你贴标签。</p>
          </div>
          <div className="identity-card" aria-labelledby="identity-title">
            <div>
              <span className="step-dot">01</span>
              <div>
                <strong id="identity-title">先输入匿名编号</strong>
                <small>不使用姓名、学号或手机号</small>
              </div>
            </div>
            <label className="code-field">
              <span className="sr-only">学校发放的匿名编号</span>
              <input
                value={participantCode}
                onChange={(event) => setParticipantCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20))}
                placeholder="例如 XB-042"
                autoComplete="off"
                inputMode="text"
              />
              <button type="button" onClick={() => void loadHistory()} disabled={loadingHistory || !participantCode}>
                {loadingHistory ? "读取中…" : "查看记录"}
              </button>
            </label>
            <p><span aria-hidden="true">🔒</span> 编号由学校单独发放，真实姓名不会发送给模型。</p>
          </div>
        </section>

        <section id="today" className="workspace" aria-labelledby="today-title">
          <aside className="companion-card">
            <div className="pet-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
            <Image src="/dog.svg" alt="微笑的小狗伙伴小伴" className="pet-image" width={190} height={190} priority />
            <div className="online-pill"><span></span> 小伴在这里</div>
            <h2>嗨，我是小伴</h2>
            <p>我可以陪你整理心情和下一步，但我不是真人，也可能理解错。</p>
            <div className="pet-boundary">
              <strong>我会做的</strong>
              <span>先听你说 · 把困难拆小 · 提醒你找可信任的人</span>
            </div>
            <div className="reality-note">AI 生成 · 不是诊断或紧急服务</div>
          </aside>

          <form className="checkin-card" onSubmit={(event) => void submitEntry(event, false)}>
            <div className="card-heading">
              <div>
                <span className="step-label">STEP 02</span>
                <h2 id="today-title">此刻，哪个最像你的心情？</h2>
              </div>
              <span className="optional-badge">没有对错</span>
            </div>

            <div className="mood-grid" role="radiogroup" aria-label="选择今天的心情">
              {moodOptions.map((mood) => (
                <button
                  key={mood.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedMood?.id === mood.id}
                  className={`mood-option mood-${mood.tone}${selectedMood?.id === mood.id ? " selected" : ""}`}
                  onClick={() => setSelectedMood(mood)}
                >
                  <span aria-hidden="true">{mood.emoji}</span>
                  <strong>{mood.label}</strong>
                </button>
              ))}
            </div>

            <div className="prompt-row" aria-label="可以点选一个开头">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => setNote(prompt)}>{prompt}</button>
              ))}
            </div>

            <label className="field-group">
              <span>今天最想记下什么？ <small>可不填</small></span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 600))}
                placeholder="比如：数学最后一道题有点难，我有些着急……"
                rows={4}
              />
              <small className={remaining < 60 ? "count warning" : "count"}>请不要写姓名、电话或住址 · 还可写 {remaining} 字</small>
            </label>

            <label className="field-group goal-field">
              <span>给今天一个小小的下一步 <small>可不填</small></span>
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value.slice(0, 80))}
                placeholder="比如：把错题整理一题"
              />
            </label>

            <label className="support-toggle" htmlFor="wants-support" aria-label="请求老师或学校支持人员联系我">
              <input id="wants-support" type="checkbox" checked={wantsSupport} onChange={(event) => setWantsSupport(event.target.checked)} />
              <span className="toggle-box" aria-hidden="true"></span>
              <span>
                <strong>我想找老师或支持人员聊聊</strong>
                <small>只有你主动请求或出现明确安全风险时，才会共享最少必要信息。</small>
              </span>
            </label>

            {(error || notice) && (
              <div className={error ? "form-message error" : "form-message success"} role={error ? "alert" : "status"}>
                {error || notice}
              </div>
            )}

            <div className="form-actions">
              <button className="secondary-action" type="submit" disabled={Boolean(submitting)}>
                {submitting === "save" ? "正在保存…" : "仅保存记录"}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={Boolean(submitting)}
                onClick={(event) => void submitEntry(event as unknown as FormEvent<HTMLFormElement>, true)}
              >
                {submitting === "ai" ? "小伴正在想…" : "保存并请小伴回应"}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p className="consent-copy">选择“小伴回应”后，本次文字会去标识化发送给学校配置的模型；对话默认不保存。</p>
          </form>

          <aside className="side-stack">
            <section className="insight-card">
              <span className="step-label">MY WEEK</span>
              <h2>我的一周</h2>
              <div className="week-visual" aria-label={weeklyAverage ? `最近记录平均心情 ${weeklyAverage.toFixed(1)} 分` : "还没有一周记录"}>
                <div className="week-score"><strong>{weeklyAverage ? weeklyAverage.toFixed(1) : "—"}</strong><small>/ 5</small></div>
                <div className="mini-bars" aria-hidden="true">
                  {(entries.length ? entries.slice(0, 7).reverse() : [1, 2, 3, 2, 4, 3, 1]).map((entry, index) => {
                    const score = typeof entry === "number" ? entry : Math.max(entry.moodScore, 1);
                    return <span key={typeof entry === "number" ? index : entry.id} style={{ height: `${20 + score * 10}%` }}></span>;
                  })}
                </div>
              </div>
              <p>{entries.length ? `已读取 ${entries.length} 条记录。趋势帮助你回看，不代表心理评分。` : "输入匿名编号后，可以在这里回看自己的记录。"}</p>
              <button type="button" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>查看我的记录 <span aria-hidden="true">→</span></button>
            </section>

            <section className="privacy-card">
              <div className="privacy-icon" aria-hidden="true">◌</div>
              <div>
                <strong>你有选择权</strong>
                <p>可以跳过、导出、删除或停止参加，不影响成绩和获得学校支持。</p>
              </div>
            </section>
          </aside>
        </section>

        {(reply || urgent) && (
          <section className={urgent ? "reply-section urgent" : "reply-section"} aria-labelledby="reply-title" ref={crisisRef} tabIndex={-1}>
            <div className="reply-avatar"><Image src="/dog.svg" alt="" width={68} height={68} /></div>
            <div className="reply-body">
              <div className="reply-meta">
                <h2 id="reply-title">{urgent ? "现在先保证安全" : "小伴的回应"}</h2>
                <span>{urgent ? "本地安全提示" : `${providerNames[provider] || "AI"} · AI 生成，可能有误`}</span>
              </div>
              <p>{reply}</p>
              {urgent ? (
                <div className="urgent-actions">
                  <a href="tel:110">立即拨打 110</a>
                  <a href="tel:120">立即拨打 120</a>
                  <a href="#help">找可信任的大人</a>
                </div>
              ) : (
                <p className="reply-nudge">如果愿意，可以把这个小步骤告诉一位你信任的老师、家长或同学。</p>
              )}
              {urgent && <small>本研究原型尚不能保证自动通知老师。请你现在主动联系身边可信任的成年人。</small>}
            </div>
          </section>
        )}

        {historyOpen && (
          <section className="history-section" aria-labelledby="history-title">
            <div className="section-heading">
              <div>
                <span className="step-label">YOUR RECORDS</span>
                <h2 id="history-title">只属于你的回看</h2>
              </div>
              <div className="history-actions">
                <button type="button" onClick={downloadMyRecords}>导出记录</button>
                <button type="button" className="danger-link" onClick={() => void deleteMyRecords()}>删除全部</button>
                <button type="button" aria-label="收起我的记录" onClick={() => setHistoryOpen(false)}>×</button>
              </div>
            </div>
            {entries.length ? (
              <div className="history-list">
                {entries.map((entry) => (
                  <article key={entry.id}>
                    <div className="history-mood">{moodOptions.find((mood) => mood.label === entry.mood)?.emoji || "○"}</div>
                    <div>
                      <div className="history-meta"><strong>{entry.mood}</strong><time>{formatDate(entry.createdAt)}</time></div>
                      {entry.note && <p>{entry.note}</p>}
                      {entry.goal && <span className="goal-chip">下一步：{entry.goal}</span>}
                      {entry.wantsSupport && <span className="support-chip">已请求真人支持</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">还没有记录。今天只选一个心情，也算好好照顾了自己。</div>
            )}
          </section>
        )}

        <section id="help" className="support-section" aria-labelledby="support-title">
          <div>
            <span className="step-label">REAL PEOPLE, REAL SUPPORT</span>
            <h2 id="support-title">有些事，不需要一个人扛。</h2>
            <p>小伴可以陪你理一理，但真正的支持来自现实中的人。你可以从最容易联系的一位开始。</p>
          </div>
          <div className="support-options">
            <article><span aria-hidden="true">师</span><div><strong>学校里的可信任老师</strong><p>班主任、心理教师或学校指定的支持人员</p></div></article>
            <article><span aria-hidden="true">家</span><div><strong>你信任的家人或成年人</strong><p>也可以是亲戚、教练或社工</p></div></article>
            <article className="emergency"><span aria-hidden="true">!</span><div><strong>如果你或别人正面临立即危险</strong><p>请现在拨打 <a href="tel:110">110</a> 或 <a href="tel:120">120</a>，并走到可信任的大人身边</p></div></article>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">心</span><span><strong>心伴 AI-Pet</strong><small>EITT 2026 研究原型</small></span></div>
        <p>学生自我记录 × AI 低压力回应 × 教师人工支持</p>
        <p className="footer-note">本原型不是医疗或心理诊断工具。正式试点需经学校审批、监护人同意与未成年人本人同意。</p>
      </footer>
    </div>
  );
}
