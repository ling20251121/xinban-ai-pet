"use client";

import Image from "next/image";
import {
  type CSSProperties,
  type FormEvent,
  useMemo,
  useState,
} from "react";

type DataMode = "sample" | "live";
type LoadState = "sample" | "idle" | "loading" | "ready" | "error";
type QueueFilter = "all" | "urgent" | "support";

type MoodCount = {
  mood: string;
  count: number;
};

type DailyPoint = {
  date: string;
  count: number;
  averageMoodScore: number | null;
  wantsSupport: number;
  urgent: number;
};

type SupportItem = {
  id: string;
  participantCode: string;
  mood: string;
  wantsSupport: boolean;
  safetyLevel: "normal" | "urgent";
  createdAt: string;
};

type TeacherSummary = {
  generatedAt: string;
  rangeDays: number;
  totalEntries: number;
  participants: number | null;
  todayCount: number;
  averageMoodScore: number | null;
  supportRequests: number;
  urgentCount: number;
  moodCounts: MoodCount[];
  daily: DailyPoint[];
  supportQueue: SupportItem[];
};

type NumberMap = Record<string, unknown>;

const moodMeta: Record<
  string,
  { label: string; color: string; short: string }
> = {
  happy: { label: "开心、有力量", color: "#ef9e62", short: "开心" },
  joyful: { label: "开心、有力量", color: "#ef9e62", short: "开心" },
  good: { label: "开心、有力量", color: "#ef9e62", short: "开心" },
  calm: { label: "平静、安心", color: "#55a68e", short: "平静" },
  peaceful: { label: "平静、安心", color: "#55a68e", short: "平静" },
  neutral: { label: "一般、说不上来", color: "#8aa59c", short: "一般" },
  okay: { label: "一般、说不上来", color: "#8aa59c", short: "一般" },
  anxious: { label: "担心、紧张", color: "#d6a94d", short: "担心" },
  worried: { label: "担心、紧张", color: "#d6a94d", short: "担心" },
  sad: { label: "难过、低落", color: "#7187b5", short: "难过" },
  low: { label: "难过、低落", color: "#7187b5", short: "难过" },
  angry: { label: "生气、烦躁", color: "#c66d67", short: "烦躁" },
  upset: { label: "生气、烦躁", color: "#c66d67", short: "烦躁" },
  tired: { label: "疲惫、没精神", color: "#9a80aa", short: "疲惫" },
  exhausted: { label: "疲惫、没精神", color: "#9a80aa", short: "疲惫" },
  "开心": { label: "开心、有力量", color: "#ef9e62", short: "开心" },
  "平静": { label: "平静、安心", color: "#55a68e", short: "平静" },
  "一般": { label: "一般、说不上来", color: "#8aa59c", short: "一般" },
  "担心": { label: "担心、紧张", color: "#d6a94d", short: "担心" },
  "紧张": { label: "担心、紧张", color: "#d6a94d", short: "紧张" },
  "难过": { label: "难过、低落", color: "#7187b5", short: "难过" },
  "生气": { label: "生气、烦躁", color: "#c66d67", short: "烦躁" },
  "烦躁": { label: "生气、烦躁", color: "#c66d67", short: "烦躁" },
  "疲惫": { label: "疲惫、没精神", color: "#9a80aa", short: "疲惫" },
  "说不清": { label: "说不清、想慢慢感受", color: "#8aa59c", short: "说不清" },
};

const sampleData: TeacherSummary = {
  generatedAt: "2026-08-12T02:20:00.000Z",
  rangeDays: 7,
  totalEntries: 160,
  participants: 30,
  todayCount: 24,
  averageMoodScore: 3.6,
  supportRequests: 3,
  urgentCount: 1,
  moodCounts: [
    { mood: "calm", count: 52 },
    { mood: "happy", count: 41 },
    { mood: "anxious", count: 29 },
    { mood: "sad", count: 18 },
    { mood: "tired", count: 12 },
    { mood: "angry", count: 8 },
  ],
  daily: [
    {
      date: "2026-08-06",
      count: 21,
      averageMoodScore: 3.5,
      wantsSupport: 1,
      urgent: 0,
    },
    {
      date: "2026-08-07",
      count: 23,
      averageMoodScore: 3.8,
      wantsSupport: 0,
      urgent: 0,
    },
    {
      date: "2026-08-08",
      count: 25,
      averageMoodScore: 3.9,
      wantsSupport: 1,
      urgent: 0,
    },
    {
      date: "2026-08-09",
      count: 22,
      averageMoodScore: 3.7,
      wantsSupport: 0,
      urgent: 0,
    },
    {
      date: "2026-08-10",
      count: 27,
      averageMoodScore: 3.4,
      wantsSupport: 1,
      urgent: 0,
    },
    {
      date: "2026-08-11",
      count: 18,
      averageMoodScore: 3.2,
      wantsSupport: 2,
      urgent: 1,
    },
    {
      date: "2026-08-12",
      count: 24,
      averageMoodScore: 3.6,
      wantsSupport: 3,
      urgent: 1,
    },
  ],
  supportQueue: [
    {
      id: "sample-alert-1",
      participantCode: "同学 X-021",
      mood: "sad",
      wantsSupport: true,
      safetyLevel: "urgent",
      createdAt: "2026-08-12T02:08:00.000Z",
    },
    {
      id: "sample-alert-2",
      participantCode: "同学 X-014",
      mood: "anxious",
      wantsSupport: true,
      safetyLevel: "normal",
      createdAt: "2026-08-12T01:32:00.000Z",
    },
    {
      id: "sample-alert-3",
      participantCode: "同学 X-008",
      mood: "tired",
      wantsSupport: true,
      safetyLevel: "normal",
      createdAt: "2026-08-11T08:45:00.000Z",
    },
  ],
};

const flowSteps = [
  {
    english: "Cue",
    title: "看见线索",
    description: "先看学生主动表达、结构化心情和安全级别，只取完成支持所需的信息。",
    action: "我看到了什么，而不是我推断了什么？",
  },
  {
    english: "Check",
    title: "当面核对",
    description: "用平静、具体的问题确认学生此刻是否安全，以及希望谁陪伴、何时交流。",
    action: "立即项目先确认“人已联系、信息已送达”。",
  },
  {
    english: "Choose",
    title: "共同选择",
    description: "和学生一起选下一步：倾听、短暂休息、联系班主任/心理教师或监护人。",
    action: "涉及现实危险时，立即启动学校应急流程。",
  },
  {
    english: "Reflect",
    title: "简要回看",
    description: "只记录支持是否送达、学生的选择和下一次跟进时间，不扩写个人隐私。",
    action: "支持有效吗？还需要谁在什么时候接力？",
  },
];

function isRecord(value: unknown): value is NumberMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFrom(
  source: NumberMap | undefined,
  keys: string[],
  fallback = 0,
) {
  if (!source) return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function stringFrom(
  source: NumberMap | undefined,
  keys: string[],
  fallback = "",
) {
  if (!source) return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function booleanFrom(source: NumberMap | undefined, keys: string[]) {
  if (!source) return false;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "true") return true;
  }
  return false;
}

function arrayFrom(source: NumberMap, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function dateKeyInShanghai(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeSummary(payload: unknown): TeacherSummary {
  if (!isRecord(payload)) throw new Error("数据格式无法识别，请联系管理员。");

  const envelope = isRecord(payload.data) ? payload.data : payload;
  const summary = isRecord(envelope.summary) ? envelope.summary : envelope;
  const totals = isRecord(envelope.totals)
    ? envelope.totals
    : isRecord(summary.totals)
      ? summary.totals
      : summary;
  const range = isRecord(envelope.range) ? envelope.range : undefined;

  const rawDaily = arrayFrom(envelope, ["daily", "dailyTrend"]);
  const daily = rawDaily.flatMap((entry, index): DailyPoint[] => {
    if (!isRecord(entry)) return [];
    const score = numberFrom(entry, ["averageMoodScore", "avgScore"], -1);
    return [
      {
        date: stringFrom(entry, ["date", "day"], `第 ${index + 1} 天`),
        count: numberFrom(entry, ["count", "entries", "todayCount"]),
        averageMoodScore: score >= 0 ? score : null,
        wantsSupport: numberFrom(entry, ["wantsSupport", "supportRequests"]),
        urgent: numberFrom(entry, ["urgent", "urgentCount"]),
      },
    ];
  });

  const rawMoods = arrayFrom(envelope, ["moodCounts", "moodDistribution"]);
  const moodCounts = rawMoods.flatMap((entry): MoodCount[] => {
    if (!isRecord(entry)) return [];
    const mood = stringFrom(entry, ["mood", "name", "label"]);
    if (!mood) return [];
    return [{ mood, count: numberFrom(entry, ["count", "value"]) }];
  });

  const rawQueue = arrayFrom(envelope, ["alerts", "supportQueue"]);
  const supportQueue = rawQueue.flatMap((entry, index): SupportItem[] => {
    if (!isRecord(entry)) return [];
    const rawLevel = stringFrom(entry, ["safetyLevel", "priority", "level"]);
    const safetyLevel =
      rawLevel === "urgent" || rawLevel === "immediate" || rawLevel === "high"
        ? "urgent"
        : "normal";
    return [
      {
        id: stringFrom(entry, ["id"], `support-${index + 1}`),
        participantCode: stringFrom(
          entry,
          ["participantCode", "studentCode", "alias"],
          `匿名同学 ${index + 1}`,
        ),
        mood: stringFrom(entry, ["mood"], "neutral"),
        wantsSupport: booleanFrom(entry, ["wantsSupport", "supportRequested"]),
        safetyLevel,
        createdAt: stringFrom(entry, ["createdAt", "time", "timestamp"]),
      },
    ];
  });

  const generatedAt = stringFrom(
    envelope,
    ["generatedAt", "updatedAt"],
    new Date().toISOString(),
  );
  const todayDaily = daily.find((day) => day.date === dateKeyInShanghai(generatedAt));
  const averageMoodScore = numberFrom(
    totals,
    ["averageMoodScore", "avgScore"],
    -1,
  );

  return {
    generatedAt,
    rangeDays: numberFrom(range, ["days"], daily.length || 7),
    totalEntries: numberFrom(totals, ["entries", "totalEntries"]),
    participants:
      typeof totals.participants === "number" ? totals.participants : null,
    todayCount: numberFrom(summary, ["todayCount"], todayDaily?.count ?? 0),
    averageMoodScore: averageMoodScore >= 0 ? averageMoodScore : null,
    supportRequests: numberFrom(totals, ["wantsSupport", "supportRequests"]),
    urgentCount: numberFrom(totals, ["urgent", "urgentCount"]),
    moodCounts,
    daily,
    supportQueue,
  };
}

function getMoodMeta(mood: string) {
  const key = mood.trim().toLowerCase();
  if (moodMeta[key]) return moodMeta[key];
  const partial = Object.keys(moodMeta).find(
    (candidate) => key.includes(candidate) || candidate.includes(key),
  );
  if (partial) return moodMeta[partial];
  return { label: mood || "未选择", color: "#8aa59c", short: mood || "未选择" };
}

function formatDate(value: string, includeTime = false) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+08:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value || "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function describeRequestError(status: number, serverMessage?: string) {
  if (status === 401) return "访问密钥不正确，请核对后重试。";
  if (status === 503) return "教师端尚未完成密钥配置，请联系系统管理员。";
  if (status === 429) return "请求过于频繁，请稍后再试。";
  if (status >= 500) return "服务暂时不可用，请稍后再试。";
  return serverMessage || "暂时无法读取班级数据，请重试。";
}

export default function TeacherDashboard() {
  const [mode, setMode] = useState<DataMode>("sample");
  const [loadState, setLoadState] = useState<LoadState>("sample");
  const [teacherKey, setTeacherKey] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<TeacherSummary | null>(sampleData);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  const sevenDayAverage = data
    ? data.daily.length > 0
      ? data.daily.reduce((sum, day) => sum + day.count, 0) / data.daily.length
      : data.totalEntries / Math.max(data.rangeDays, 1)
    : 0;

  const moodTotal = data?.moodCounts.reduce((sum, mood) => sum + mood.count, 0) ?? 0;

  const visibleQueue = useMemo(() => {
    if (!data) return [];
    if (queueFilter === "urgent") {
      return data.supportQueue.filter((item) => item.safetyLevel === "urgent");
    }
    if (queueFilter === "support") {
      return data.supportQueue.filter(
        (item) => item.wantsSupport && item.safetyLevel !== "urgent",
      );
    }
    return data.supportQueue;
  }, [data, queueFilter]);

  function changeMode(nextMode: DataMode) {
    setMode(nextMode);
    setError("");
    setQueueFilter("all");
    if (nextMode === "sample") {
      setTeacherKey("");
      setData(sampleData);
      setLoadState("sample");
    } else {
      setData(null);
      setLoadState("idle");
    }
  }

  async function loadLiveData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = teacherKey.trim();
    if (!key) {
      setError("请输入教师访问密钥。");
      setLoadState("error");
      return;
    }

    setError("");
    setLoadState("loading");
    try {
      const response = await fetch("/api/teacher/summary?days=7", {
        method: "GET",
        headers: { "x-teacher-key": key },
        cache: "no-store",
        credentials: "same-origin",
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        const message = isRecord(body) ? stringFrom(body, ["error", "message"]) : "";
        throw new Error(describeRequestError(response.status, message));
      }

      setData(normalizeSummary(body));
      setTeacherKey("");
      setLoadState("ready");
    } catch (requestError) {
      setData(null);
      setLoadState("error");
      setError(
        requestError instanceof TypeError
          ? "网络连接失败，请检查网络后重试。"
          : requestError instanceof Error
          ? requestError.message
          : "网络连接失败，请检查网络后重试。",
      );
    }
  }

  const isLoading = loadState === "loading";

  return (
    <div className="teacher-shell" lang="zh-CN">
      <a className="teacher-skip-link" href="#teacher-main">
        跳到主要内容
      </a>

      <header className="teacher-topbar">
        <a className="teacher-brand" href="/teacher" aria-label="心伴 AI-Pet 教师支持台首页">
          <span className="teacher-brand-image" aria-hidden="true">
            <Image src="/dog.svg" alt="" width={42} height={42} priority />
          </span>
          <span>
            <strong>心伴</strong>
            <small>AI-PET · 教师支持台</small>
          </span>
        </a>
        <nav className="teacher-topnav" aria-label="页面导航">
          <a href="#class-overview">班级概览</a>
          <a href="#support-queue">支持队列</a>
          <a href="#cccr-flow">核对流程</a>
        </nav>
        <span className="teacher-privacy-badge">
          <span aria-hidden="true">MINIMUM DATA</span> 脱敏保护开启
        </span>
      </header>

      <div className="teacher-workbench">
        <aside className="teacher-sidebar" aria-label="教师工作台导航">
          <div>
            <p>工作台</p>
            <nav>
              <a className="is-active" href="#class-overview" aria-current="page">总览</a>
              <a href="#support-queue">学生支持</a>
              <a href="#cccr-flow">核对流程</a>
            </nav>
          </div>
          <section aria-labelledby="teacher-sidebar-boundary">
            <strong id="teacher-sidebar-boundary">信息边界</strong>
            <p>只看匿名编号、聚合数据和结构化线索；不呈现姓名或普通聊天原文。</p>
          </section>
        </aside>

        <div className="teacher-content-column">
          <main id="teacher-main" className="teacher-main">
        <section className="teacher-hero" aria-labelledby="teacher-title">
          <div className="teacher-hero-copy">
            <p className="teacher-eyebrow">学生支持工作台</p>
            <h1 id="teacher-title">您好，老师</h1>
            <p>
              系统先汇总班级整体使用情况，再突出需要真人跟进的少量事项。
              所有信息只作支持线索，不用于诊断、排名或评价学生。
            </p>
          </div>

          <aside className="teacher-access-card" aria-labelledby="data-source-title">
            <div className="teacher-access-heading">
              <div>
                <p className="teacher-card-kicker">数据入口</p>
                <h2 id="data-source-title">选择查看方式</h2>
              </div>
              <span
                className={`teacher-source-status teacher-source-status--${mode}`}
                aria-live="polite"
              >
                {mode === "sample"
                  ? "演示中"
                  : loadState === "ready"
                    ? "已连接"
                    : loadState === "loading"
                      ? "连接中"
                      : "待连接"}
              </span>
            </div>

            <div className="teacher-segmented" role="group" aria-label="数据来源">
              <button
                type="button"
                className={mode === "sample" ? "is-active" : ""}
                aria-pressed={mode === "sample"}
                onClick={() => changeMode("sample")}
              >
                脱敏示例
              </button>
              <button
                type="button"
                className={mode === "live" ? "is-active" : ""}
                aria-pressed={mode === "live"}
                onClick={() => changeMode("live")}
              >
                实时班级
              </button>
            </div>

            {mode === "sample" ? (
              <div className="teacher-sample-note">
                <span aria-hidden="true">示例</span>
                <p>
                  当前为虚构示例，不含真实学生记录。切换到“实时班级”后输入访问密钥。
                </p>
              </div>
            ) : (
              <form className="teacher-key-form" onSubmit={loadLiveData} aria-busy={isLoading}>
                <label htmlFor="teacher-key">教师访问密钥</label>
                <div className="teacher-key-row">
                  <input
                    id="teacher-key"
                    type="password"
                    value={teacherKey}
                    onChange={(event) => setTeacherKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="输入密钥"
                    aria-describedby="teacher-key-help teacher-key-error"
                    aria-invalid={Boolean(error)}
                    disabled={isLoading}
                  />
                  <button type="submit" disabled={isLoading}>
                    {isLoading ? "正在读取…" : "安全进入"}
                  </button>
                </div>
                <p id="teacher-key-help" className="teacher-field-help">
                  密钥仅用于本次加密请求，页面不会保存。
                </p>
                <p id="teacher-key-error" className="teacher-form-error" role="alert">
                  {error}
                </p>
              </form>
            )}
          </aside>
        </section>

        {data ? (
          <div className="teacher-dashboard" aria-live={loadState === "ready" ? "polite" : "off"}>
            <section id="class-overview" className="teacher-overview" aria-labelledby="overview-title">
              <div className="teacher-section-heading">
                <div>
                  <p className="teacher-section-kicker">今日班级脉搏</p>
                  <h2 id="overview-title">支持概览</h2>
                </div>
                <p className="teacher-updated">
                  {mode === "sample" ? "脱敏示例 · " : "实时汇总 · "}
                  {formatGeneratedAt(data.generatedAt)} 更新
                </p>
              </div>

              <div className="teacher-metrics">
                <article className="teacher-metric-card">
                  <div className="teacher-metric-icon teacher-metric-icon--green" aria-hidden="true">
                    TODAY
                  </div>
                  <p>今日完成</p>
                  <strong>{data.todayCount}</strong>
                  <span>份心情记录</span>
                </article>
                <article className="teacher-metric-card">
                  <div className="teacher-metric-icon teacher-metric-icon--blue" aria-hidden="true">
                    7 DAYS
                  </div>
                  <p>7 天平均</p>
                  <strong>{sevenDayAverage.toFixed(1)}</strong>
                  <span>份记录 / 日</span>
                </article>
                <article className="teacher-metric-card">
                  <div className="teacher-metric-icon teacher-metric-icon--gold" aria-hidden="true">
                    SUPPORT
                  </div>
                  <p>支持请求</p>
                  <strong>{data.supportRequests}</strong>
                  <span>位同学主动提出</span>
                </article>
                <article className="teacher-metric-card teacher-metric-card--urgent">
                  <div className="teacher-metric-icon teacher-metric-icon--red" aria-hidden="true">
                    CHECK
                  </div>
                  <p>需立即人工确认</p>
                  <strong>{data.urgentCount}</strong>
                  <a href="#support-queue">
                    前往核对
                  </a>
                </article>
              </div>
            </section>

            <section className="teacher-insights" aria-label="班级心情汇总">
              <article className="teacher-panel teacher-mood-panel" aria-labelledby="mood-distribution-title">
                <div className="teacher-panel-heading">
                  <div>
                    <p className="teacher-section-kicker">仅看班级整体</p>
                    <h2 id="mood-distribution-title">7 日心情分布</h2>
                  </div>
                  <span>{moodTotal} 份记录</span>
                </div>
                {data.moodCounts.length > 0 ? (
                  <ul className="teacher-mood-list">
                    {data.moodCounts.map((item) => {
                      const meta = getMoodMeta(item.mood);
                      const percentage = moodTotal > 0 ? (item.count / moodTotal) * 100 : 0;
                      return (
                        <li key={item.mood}>
                          <div className="teacher-mood-label">
                            <span
                              className="teacher-mood-dot"
                              style={{ backgroundColor: meta.color }}
                              aria-hidden="true"
                            />
                            <span>{meta.label}</span>
                            <strong>{Math.round(percentage)}%</strong>
                          </div>
                          <div
                            className="teacher-progress"
                            role="progressbar"
                            aria-label={`${meta.label} ${item.count} 份，占 ${Math.round(percentage)}%`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(percentage)}
                          >
                            <span
                              style={
                                {
                                  "--teacher-bar-width": `${percentage}%`,
                                  "--teacher-bar-color": meta.color,
                                } as CSSProperties
                              }
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="teacher-empty-inline">这段时间还没有心情记录。</p>
                )}
              </article>

              <article className="teacher-panel teacher-trend-panel" aria-labelledby="mood-trend-title">
                <div className="teacher-panel-heading">
                  <div>
                    <p className="teacher-section-kicker">不作个体评分</p>
                    <h2 id="mood-trend-title">7 日心情趋势</h2>
                  </div>
                  <span>班级自述均值</span>
                </div>
                <p className="teacher-chart-note">
                  高低仅表示当天班级自述的整体变化；请结合日常观察，不据此判断某位学生。
                </p>
                {data.daily.some((day) => day.averageMoodScore !== null) ? (
                  <div className="teacher-trend-wrap">
                    <div className="teacher-trend-scale" aria-hidden="true">
                      <span>舒展</span>
                      <span>平稳</span>
                      <span>低落</span>
                    </div>
                    <ol className="teacher-trend-chart" aria-label="最近七天班级心情自述均值">
                      {data.daily.map((day) => {
                        const score = Math.min(5, Math.max(0, day.averageMoodScore ?? 0));
                        const height = Math.max(8, (score / 5) * 100);
                        return (
                          <li
                            key={day.date}
                            aria-label={`${formatDate(day.date)}：心情自述均值 ${score.toFixed(1)}，${day.count} 份记录，${day.wantsSupport} 个支持请求`}
                          >
                            <div className="teacher-trend-track" aria-hidden="true">
                              <span
                                className={day.urgent > 0 ? "has-urgent" : ""}
                                style={{ "--teacher-trend-height": `${height}%` } as CSSProperties}
                              >
                                <i />
                              </span>
                            </div>
                            <strong aria-hidden="true">{score.toFixed(1)}</strong>
                            <time dateTime={day.date}>{formatDate(day.date)}</time>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : (
                  <p className="teacher-empty-inline">趋势数据将在有记录后显示。</p>
                )}
                <div className="teacher-trend-footer">
                  <span>
                    <i className="teacher-legend-dot" aria-hidden="true" /> 汇总走势
                  </span>
                  <span>
                    <i className="teacher-legend-ring" aria-hidden="true" /> 当天含立即核对项
                  </span>
                </div>
              </article>
            </section>

            <section id="support-queue" className="teacher-queue-section" aria-labelledby="queue-title">
              <div className="teacher-section-heading teacher-queue-heading">
                <div>
                  <p className="teacher-section-kicker">最少必要证据</p>
                  <h2 id="queue-title">人工支持队列</h2>
                  <p>
                    仅显示匿名编号、结构化选择与时间；日常聊天原文不会在教师端呈现。
                  </p>
                </div>
                <div className="teacher-filter-tabs" role="group" aria-label="筛选支持队列">
                  <button
                    type="button"
                    className={queueFilter === "all" ? "is-active" : ""}
                    aria-pressed={queueFilter === "all"}
                    onClick={() => setQueueFilter("all")}
                  >
                    全部 {data.supportQueue.length}
                  </button>
                  <button
                    type="button"
                    className={queueFilter === "urgent" ? "is-active" : ""}
                    aria-pressed={queueFilter === "urgent"}
                    onClick={() => setQueueFilter("urgent")}
                  >
                    立即确认 {data.supportQueue.filter((item) => item.safetyLevel === "urgent").length}
                  </button>
                  <button
                    type="button"
                    className={queueFilter === "support" ? "is-active" : ""}
                    aria-pressed={queueFilter === "support"}
                    onClick={() => setQueueFilter("support")}
                  >
                    待跟进 {data.supportQueue.filter((item) => item.safetyLevel !== "urgent").length}
                  </button>
                </div>
              </div>

              {visibleQueue.length > 0 ? (
                <div className="teacher-queue-list">
                  {visibleQueue.map((item) => {
                    const mood = getMoodMeta(item.mood);
                    const urgent = item.safetyLevel === "urgent";
                    return (
                      <article
                        key={item.id}
                        className={`teacher-queue-card ${urgent ? "teacher-queue-card--urgent" : ""}`}
                      >
                        <div className="teacher-queue-priority" aria-hidden="true">
                          <span>{urgent ? "立即" : "跟进"}</span>
                        </div>
                        <div className="teacher-queue-content">
                          <div className="teacher-queue-topline">
                            <div>
                              <span className={`teacher-priority-tag ${urgent ? "is-urgent" : ""}`}>
                                {urgent ? "立即人工确认" : "尽快温和跟进"}
                              </span>
                              <h3>{item.participantCode}</h3>
                            </div>
                            <time dateTime={item.createdAt}>{formatDate(item.createdAt, true)}</time>
                          </div>
                          <dl className="teacher-evidence-list">
                            <div>
                              <dt>已知线索</dt>
                              <dd>
                                {item.wantsSupport ? "学生主动选择“希望获得支持”" : "安全规则提示需核对"}
                              </dd>
                            </div>
                            <div>
                              <dt>心情选择</dt>
                              <dd>
                                <span
                                  className="teacher-mood-dot"
                                  style={{ backgroundColor: mood.color }}
                                  aria-hidden="true"
                                />
                                {mood.label}
                              </dd>
                            </div>
                            <div>
                              <dt>下一步</dt>
                              <dd>{urgent ? "立即找到学生并完成现实安全核对" : "在今天合适的时间私下关心"}</dd>
                            </div>
                          </dl>
                        </div>
                        <a className="teacher-check-link" href="#cccr-flow">
                          查看核对步骤
                        </a>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="teacher-empty-state">
                  <span aria-hidden="true">暂无</span>
                  <h3>当前筛选下没有待处理项目</h3>
                  <p>继续保持日常观察；有新的主动请求时会出现在这里。</p>
                </div>
              )}
            </section>

            <section id="cccr-flow" className="teacher-flow-section" aria-labelledby="flow-title">
              <div className="teacher-section-heading teacher-flow-heading">
                <div>
                  <p className="teacher-section-kicker">Cue → Check → Choose → Reflect</p>
                  <h2 id="flow-title">把“提醒”变成一次真实的支持</h2>
                </div>
                <p>AI 负责提示，教师负责核对；每一步都尊重学生的感受与选择。</p>
              </div>
              <ol className="teacher-flow-list">
                {flowSteps.map((step, index) => (
                  <li key={step.english}>
                    <div className="teacher-flow-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <p>{step.english}</p>
                    <h3>{step.title}</h3>
                    <span>{step.description}</span>
                    <strong>{step.action}</strong>
                  </li>
                ))}
              </ol>
              <div className="teacher-safety-callout">
                <span className="teacher-safety-mark" aria-hidden="true">注意</span>
                <div>
                  <h3>立即项必须由真人确认闭环</h3>
                  <p>
                    不要仅在系统中“看过”。请确认学生已被现实中的可信任成人联系、支持信息已送达；如存在现实危险，按学校既定应急流程立即处理。
                  </p>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <section className="teacher-locked-state" aria-live="polite" aria-busy={isLoading}>
            <div className="teacher-lock-symbol" aria-hidden="true">
              {isLoading ? "读取中" : "密钥"}
            </div>
            <h2>{isLoading ? "正在准备班级支持概览" : "输入密钥后查看实时汇总"}</h2>
            <p>
              {isLoading
                ? "正在安全读取脱敏数据，请稍候。"
                : error || "你也可以切回脱敏示例，先熟悉教师支持流程。"}
            </p>
          </section>
        )}
          </main>

          <footer className="teacher-footer">
            <p>
              <strong>心伴 AI-Pet</strong> 是支持工具，不是诊断、测评或学生评价系统。
            </p>
            <p>只收集和呈现完成支持所需的最少信息。</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
