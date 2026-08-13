"use client";

import Image from "next/image";
import SandboxNotice from "../SandboxNotice";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type TeacherUser = {
  id: string;
  role: "student" | "teacher";
  username: string;
  displayName: string | null;
};

type Classroom = {
  id: string;
  name: string;
  active: boolean;
  studentCount: number;
  safetyContactName: string;
  safetyContactPhone: string;
  createdAt: string;
};

type StudentAccount = {
  id: string;
  username: string;
  displayName: string | null;
  classId: string;
  active: boolean;
  ageBand: "under14" | "14plus";
  guardianConsentVerified: boolean;
  studentConsented: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
};

type MoodCount = { mood: string; count: number };
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
  studentId?: string;
  classId?: string;
  sourceType?: "mood" | "chat" | "voice";
  mood: string;
  wantsSupport: boolean;
  safetyLevel: "normal" | "urgent";
  createdAt: string;
};
type TeacherSummary = {
  generatedAt: string;
  rangeDays: number;
  totalEntries: number;
  participants: number;
  todayCount: number;
  averageMoodScore: number | null;
  supportRequests: number;
  urgentCount: number;
  moodCounts: MoodCount[];
  daily: DailyPoint[];
  supportQueue: SupportItem[];
};
type SafetyEvent = {
  id: string;
  eventCode: "local_crisis_rule";
  sourceType: "mood" | "chat" | "voice";
  studentId: string;
  studentUsername: string;
  classId: string;
  className: string;
  status: "new" | "acknowledged" | "resolved";
  assignedTeacherUserId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};
type AttentionEvent = {
  id: string;
  kind: "long_chat_session" | "student_support_request";
  sourceType: "chat" | "mood";
  sourceId: string;
  studentId: string;
  studentUsername: string;
  classId: string;
  className: string;
  status: "new" | "acknowledged" | "resolved";
  assignedTeacherUserId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};
type ConversationCue = {
  id: string;
  studentId: string;
  studentUsername: string;
  classId: string;
  className: string;
  observedExpression: string;
  themes: string[];
  followUp: string;
  trend: string;
  confidence: string;
  basis: string[];
  modelName?: string;
  promptVersion?: string;
  schemaVersion?: string;
  status: "new" | "acknowledged" | "resolved" | "dismissed_inaccurate";
  assignedTeacherUserId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

const moodMeta: Record<string, { label: string; color: string }> = {
  happy: { label: "开心", color: "#eea06c" },
  calm: { label: "平静", color: "#63aa96" },
  tense: { label: "紧张", color: "#d2aa55" },
  anxious: { label: "担心", color: "#d2aa55" },
  sad: { label: "难过", color: "#758ab7" },
  upset: { label: "烦躁", color: "#c97775" },
  angry: { label: "生气", color: "#c97775" },
  unclear: { label: "说不清", color: "#92a29e" },
};

const sourceLabels = { mood: "心情记录", chat: "AI 对话", voice: "语音转写" };
const statusLabels = { new: "待教师查看", acknowledged: "已确认", resolved: "已完成核对" };
const cueStatusLabels: Record<ConversationCue["status"], string> = {
  new: "待教师核对",
  acknowledged: "核对中",
  resolved: "已完成核对",
  dismissed_inaccurate: "已标记不准确",
};
const expressionLabels: Record<string, string> = {
  positive: "积极表达", neutral: "中性表达", mixed: "混合表达",
  distress: "困扰表达", unclear: "暂不明确",
};
const themeLabels: Record<string, string> = {
  school_pressure: "学业压力", peer_relationship: "同伴关系",
  family_relationship: "家庭关系", loneliness: "孤独感", anger: "生气",
  loss: "失落或失去", sleep_or_fatigue: "睡眠或疲惫", other: "其他主题",
};
const followUpLabels: Record<string, string> = {
  routine_check_in: "日常留意", timely_check_in: "建议及时核对",
};
const trendLabels: Record<string, string> = {
  not_enough_data: "信息不足", stable: "大致稳定", easing: "有所缓和",
  intensifying: "表达增强", unclear: "暂不明确",
};
const confidenceLabels: Record<string, string> = {
  low: "低", medium: "中", high: "高",
};
const basisLabels: Record<string, string> = {
  explicit_support_seeking: "明确表达希望获得支持",
  repeated_distress_expression: "多次出现困扰表达",
  change_from_recent_turns: "与近期表达相比有变化",
  prolonged_session: "对话持续时间较长",
  unclear_language: "表达含义暂不清楚",
};

function safeLabel(labels: Record<string, string>, value: string): string {
  return labels[value] || "未提供";
}

function safeLabels(labels: Record<string, string>, values: unknown): string[] {
  const mapped = (Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => labels[value])
    .filter((value): value is string => Boolean(value));
  return mapped.length ? mapped : ["未提供"];
}

function toNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

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

function normalizeSummary(payload: unknown): TeacherSummary {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const totals = root.totals && typeof root.totals === "object" ? root.totals as Record<string, unknown> : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary as Record<string, unknown> : {};
  const range = root.range && typeof root.range === "object" ? root.range as Record<string, unknown> : {};
  const moodSource = Array.isArray(root.moodCounts)
    ? root.moodCounts
    : Array.isArray(root.moodDistribution)
      ? root.moodDistribution
      : [];
  const dailySource = Array.isArray(root.daily)
    ? root.daily
    : Array.isArray(root.dailyTrend)
      ? root.dailyTrend
      : [];
  const alertSource = Array.isArray(root.alerts)
    ? root.alerts
    : Array.isArray(root.supportQueue)
      ? root.supportQueue
      : [];

  return {
    generatedAt: typeof root.generatedAt === "string" ? root.generatedAt : new Date().toISOString(),
    rangeDays: toNumber(range.days, 7),
    totalEntries: toNumber(totals.entries, toNumber(summary.totalEntries)),
    participants: toNumber(totals.participants),
    todayCount: toNumber(totals.todayCount, toNumber(summary.todayCount)),
    averageMoodScore: typeof totals.averageMoodScore === "number"
      ? totals.averageMoodScore
      : typeof summary.avgScore === "number"
        ? summary.avgScore
        : null,
    supportRequests: toNumber(totals.wantsSupport, toNumber(summary.supportRequests)),
    urgentCount: toNumber(totals.urgent, toNumber(summary.urgentCount)),
    moodCounts: moodSource.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      return typeof row.mood === "string" ? [{ mood: row.mood, count: toNumber(row.count) }] : [];
    }),
    daily: dailySource.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.date !== "string") return [];
      return [{
        date: row.date,
        count: toNumber(row.count),
        averageMoodScore: typeof row.averageMoodScore === "number"
          ? row.averageMoodScore
          : typeof row.avgScore === "number" ? row.avgScore : null,
        wantsSupport: toNumber(row.wantsSupport),
        urgent: toNumber(row.urgent),
      }];
    }),
    supportQueue: alertSource.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string") return [];
      return [{
        id: row.id,
        participantCode: typeof row.participantCode === "string" ? row.participantCode : "匿名账号",
        studentId: typeof row.studentId === "string" ? row.studentId : undefined,
        classId: typeof row.classId === "string" ? row.classId : undefined,
        sourceType: row.sourceType === "chat" || row.sourceType === "voice" ? row.sourceType : "mood",
        mood: typeof row.mood === "string" ? row.mood : "unclear",
        wantsSupport: Boolean(row.wantsSupport),
        safetyLevel: row.safetyLevel === "urgent" ? "urgent" : "normal",
        createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
      }];
    }),
  };
}

export default function TeacherDashboard() {
  const [authState, setAuthState] = useState<"loading" | "ready" | "error">("loading");
  const [user, setUser] = useState<TeacherUser | null>(null);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<StudentAccount[]>([]);
  const [summary, setSummary] = useState<TeacherSummary | null>(null);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);
  const [attentionEvents, setAttentionEvents] = useState<AttentionEvent[]>([]);
  const [conversationCues, setConversationCues] = useState<ConversationCue[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeSection, setActiveSection] = useState<"overview" | "students" | "safety">("overview");

  const [classFormOpen, setClassFormOpen] = useState(false);
  const [className, setClassName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [classBusy, setClassBusy] = useState(false);

  const [studentFormOpen, setStudentFormOpen] = useState(false);
  const [studentUsername, setStudentUsername] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentAgeBand, setStudentAgeBand] = useState<"under14" | "14plus">("under14");
  const [guardianVerified, setGuardianVerified] = useState(false);
  const [studentBusy, setStudentBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleUnauthorized = useCallback((response: Response) => {
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/login?next=teacher");
      return true;
    }
    return false;
  }, []);

  const loadTeacherData = useCallback(async (classId: string) => {
    setLoadingData(true);
    setError("");
    try {
      const suffix = classId ? `?classId=${encodeURIComponent(classId)}` : "";
      const [studentResponse, summaryResponse, safetyResponse, attentionResponse, cueResponse] = await Promise.all([
        fetch(`/api/teacher/students${suffix}`, { cache: "no-store" }),
        fetch(`/api/teacher/summary?days=7${classId ? `&classId=${encodeURIComponent(classId)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/teacher/safety-events${suffix}`, { cache: "no-store" }),
        fetch(`/api/teacher/attention-events${suffix}`, { cache: "no-store" }),
        fetch(`/api/teacher/conversation-cues${suffix}`, { cache: "no-store" }),
      ]);
      if ([studentResponse, summaryResponse, safetyResponse, attentionResponse, cueResponse].some(handleUnauthorized)) return;
      const [studentData, summaryData, safetyData, attentionData, cueData] = await Promise.all([
        studentResponse.json() as Promise<{ students?: StudentAccount[]; error?: string }>,
        summaryResponse.json() as Promise<unknown>,
        safetyResponse.json() as Promise<{ events?: SafetyEvent[]; error?: string }>,
        attentionResponse.json() as Promise<{ events?: AttentionEvent[]; error?: string }>,
        cueResponse.json() as Promise<{ cues?: ConversationCue[]; error?: string }>,
      ]);
      if (!studentResponse.ok) throw new Error(studentData.error || "暂时无法读取学生账号");
      if (!summaryResponse.ok) throw new Error("暂时无法读取班级汇总");
      if (!safetyResponse.ok) throw new Error(safetyData.error || "暂时无法读取安全事件");
      if (!attentionResponse.ok) throw new Error(attentionData.error || "暂时无法读取日常关注提示");
      if (!cueResponse.ok) throw new Error(cueData.error || "暂时无法读取 AI 关心线索");
      setStudents(studentData.students || []);
      setSummary(normalizeSummary(summaryData));
      setSafetyEvents(safetyData.events || []);
      setAttentionEvents(attentionData.events || []);
      setConversationCues(cueData.cues || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "暂时无法读取工作台数据");
    } finally {
      setLoadingData(false);
    }
  }, [handleUnauthorized]);

  const loadClasses = useCallback(async () => {
    try {
      const response = await fetch("/api/teacher/classes", { cache: "no-store" });
      if (handleUnauthorized(response)) return;
      const data = (await response.json()) as { classes?: Classroom[]; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法读取班级");
      setClasses(data.classes || []);
    } catch (classError) {
      setError(classError instanceof Error ? classError.message : "暂时无法读取班级");
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await response.json()) as { authenticated?: boolean; user?: TeacherUser };
        if (!active) return;
        if (!data.authenticated || !data.user || data.user.role !== "teacher") {
          window.location.replace("/login?next=teacher");
          return;
        }
        setUser(data.user);
        setAuthState("ready");
        await Promise.all([loadClasses(), loadTeacherData("")]);
      } catch {
        if (active) setAuthState("error");
      }
    })();
    return () => { active = false; };
  }, [loadClasses, loadTeacherData]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.replace("/login");
  }

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/teacher/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: className.trim(),
          safetyContactName: contactName.trim(),
          safetyContactPhone: contactPhone.trim(),
        }),
      });
      const data = (await response.json()) as { classroom?: Classroom; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法创建班级");
      setClassName("");
      setContactName("");
      setContactPhone("");
      setClassFormOpen(false);
      setNotice("班级已创建，可以继续创建学生账号。 ");
      await loadClasses();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "暂时无法创建班级");
    } finally {
      setClassBusy(false);
    }
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClassId) {
      setError("请先选择班级。 ");
      return;
    }
    setStudentBusy(true);
    setError("");
    try {
      const response = await fetch("/api/teacher/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          username: studentUsername.trim(),
          password: studentPassword,
          ageBand: studentAgeBand,
          guardianConsentVerified: guardianVerified,
        }),
      });
      const data = (await response.json()) as { student?: StudentAccount; error?: string };
      if (!response.ok) {
        const message = response.status === 409
          ? "这个用户名已被使用，请更换。"
          : response.status === 429
            ? "创建较频繁，请稍后再试。"
            : data.error || "暂时无法创建学生账号";
        throw new Error(message);
      }
      setStudentUsername("");
      setStudentPassword("");
      setStudentAgeBand("under14");
      setGuardianVerified(false);
      setStudentFormOpen(false);
      setNotice("虚构学生账号已创建。初始密码只用于本轮成人演示，请勿发给未成年人。 ");
      await Promise.all([loadClasses(), loadTeacherData(selectedClassId)]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "暂时无法创建学生账号");
    } finally {
      setStudentBusy(false);
    }
  }

  async function updateStudent(student: StudentAccount, changes: Record<string, unknown>) {
    setUpdatingId(student.id);
    setError("");
    try {
      const response = await fetch("/api/teacher/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, ...changes }),
      });
      const data = (await response.json()) as { student?: StudentAccount; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法更新学生账号");
      if (data.student) setStudents((current) => current.map((item) => item.id === student.id ? data.student! : item));
      setNotice("账号状态已更新。 ");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "暂时无法更新学生账号");
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateSafetyEvent(item: SafetyEvent, status: "acknowledged" | "resolved") {
    setUpdatingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/teacher/safety-events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: item.id, status }),
      });
      const data = (await response.json()) as { event?: SafetyEvent; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法更新核对状态");
      if (data.event) setSafetyEvents((current) => current.map((event) => event.id === item.id ? data.event! : event));
      setNotice(status === "acknowledged" ? "已记录模拟教师确认；请继续扮演合成处置流程。 " : "已记录完成模拟核对。 ");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "暂时无法更新核对状态");
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateAttentionEvent(item: AttentionEvent, status: "acknowledged" | "resolved") {
    setUpdatingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/teacher/attention-events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: item.id, status }),
      });
      const data = (await response.json()) as { event?: AttentionEvent; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法更新关注提示");
      if (data.event) {
        setAttentionEvents((current) => current.map((event) => event.id === item.id ? data.event! : event));
      }
      setNotice(status === "acknowledged" ? "已记录教师查看。" : "已记录日常关心与休息提醒已完成。");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "暂时无法更新关注提示");
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateConversationCue(
    item: ConversationCue,
    status: "acknowledged" | "resolved" | "dismissed_inaccurate",
  ) {
    setUpdatingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/teacher/conversation-cues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueId: item.id, status }),
      });
      const data = (await response.json()) as { cue?: ConversationCue; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法更新 AI 关心线索");
      if (data.cue) {
        setConversationCues((current) => current.map((cue) => cue.id === item.id ? data.cue! : cue));
      }
      setNotice(status === "dismissed_inaccurate" ? "已将这条线索标记为不准确。" : status === "acknowledged" ? "已记录开始人工核对。" : "已记录完成核对。");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "暂时无法更新 AI 关心线索");
    } finally {
      setUpdatingId(null);
    }
  }

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const activeStudents = students.filter((student) => student.active).length;
  const consentedStudents = students.filter((student) => student.guardianConsentVerified && student.studentConsented).length;
  const unreviewedEvents = safetyEvents.filter((item) => item.status === "new").length;
  const unreviewedAttentionEvents = attentionEvents.filter((item) => item.status === "new").length;
  const unreviewedCues = conversationCues.filter((item) => item.status === "new").length;
  const unreviewedTeacherItems = unreviewedEvents + unreviewedAttentionEvents + unreviewedCues;
  const moodTotal = summary?.moodCounts.reduce((total, item) => total + item.count, 0) || 0;
  const sandboxManagedAccounts = true;

  const trendMax = useMemo(() => Math.max(5, ...(summary?.daily.map((item) => item.count) || [0])), [summary]);

  if (authState === "loading") {
    return <main className="teacher-loading" aria-busy="true"><Image src="/dog.svg" alt="" width={82} height={82} priority /><p>正在打开教师工作台……</p></main>;
  }
  if (authState === "error" || !user) {
    return <main className="teacher-loading"><h1>暂时无法进入沙盒工作台</h1><p>请检查演示服务后重试。</p><button type="button" onClick={() => window.location.reload()}>重新尝试</button></main>;
  }

  return (
    <div className="teacher-shell" lang="zh-CN">
      <a className="teacher-skip-link" href="#teacher-main">跳到主要内容</a>
      <SandboxNotice surface="teacher" />
      <header className="teacher-topbar">
        <a className="teacher-brand" href="/teacher"><Image src="/dog.svg" alt="" width={42} height={42} priority /><span><strong>心伴</strong><small>合成教师沙盒</small></span></a>
        <div className="teacher-account"><span><small>虚构教师角色</small>{user.displayName || user.username}</span><button type="button" onClick={logout}>退出</button></div>
      </header>

      <div className="teacher-workbench">
        <aside className="teacher-sidebar" aria-label="教师工作台导航">
          <nav>
            <button type="button" className={activeSection === "overview" ? "is-active" : ""} onClick={() => setActiveSection("overview")}><span aria-hidden="true">◫</span>班级概览</button>
            <button type="button" className={activeSection === "students" ? "is-active" : ""} onClick={() => setActiveSection("students")}><span aria-hidden="true">◎</span>学生账号</button>
            <button type="button" className={activeSection === "safety" ? "is-active" : ""} onClick={() => setActiveSection("safety")}><span aria-hidden="true">◇</span>支持与关注{unreviewedTeacherItems > 0 && <b>{unreviewedTeacherItems}</b>}</button>
          </nav>
          <section className="sidebar-boundary">
            <strong>信息边界</strong>
            <p>此处只显示合成班级汇总、虚构账号和模拟事件，不显示普通聊天原文，不可用于现实处置。</p>
          </section>
        </aside>

        <main id="teacher-main" className="teacher-main">
          <header className="teacher-page-heading">
            <div><p className="teacher-eyebrow">成人扮演教师</p><h1>{activeSection === "overview" ? "合成班级概览" : activeSection === "students" ? "虚构学生账号" : "模拟支持与处置"}</h1><p>所有账号、心情、队列和事件都应来自合成演示。操作只用于评估产品流程，不会触发现实联系。</p></div>
            <div className="teacher-heading-actions">
              <label htmlFor="class-filter">班级范围</label>
              <select id="class-filter" value={selectedClassId} onChange={(event) => { setSelectedClassId(event.target.value); void loadTeacherData(event.target.value); }}>
                <option value="">全部班级</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button type="button" onClick={() => void loadTeacherData(selectedClassId)} disabled={loadingData}>{loadingData ? "正在更新…" : "刷新"}</button>
            </div>
          </header>

          {error && <p className="teacher-alert is-error" role="alert">{error}</p>}
          {notice && <p className="teacher-alert" role="status">{notice}</p>}

          {activeSection === "overview" && (
            <>
              <section className="teacher-metrics" aria-label="班级关键数据">
                <article><span className="metric-icon is-purple" aria-hidden="true">今</span><div><strong>{summary?.todayCount ?? 0}</strong><p>今日完成</p></div><small>仅计已保存心情</small></article>
                <article><span className="metric-icon is-green" aria-hidden="true">人</span><div><strong>{summary?.participants ?? 0}</strong><p>7 天参与</p></div><small>{summary?.totalEntries ?? 0} 条记录</small></article>
                <article><span className="metric-icon is-gold" aria-hidden="true">援</span><div><strong>{summary?.supportRequests ?? 0}</strong><p>模拟支持请求</p></div><small>仅测试处置流程</small></article>
                <article className={unreviewedTeacherItems ? "is-urgent" : ""}><span className="metric-icon is-red" aria-hidden="true">看</span><div><strong>{unreviewedTeacherItems}</strong><p>待教师查看</p></div><small>{unreviewedCues} 项 AI 线索待核对</small></article>
              </section>

              {!summary || (summary.totalEntries === 0 && classes.length === 0) ? (
                <section className="teacher-empty-state"><Image src="/dog.svg" alt="" width={100} height={100} /><h2>还没有合成班级数据</h2><p>虚构班级与角色由部署方在服务端初始化。初始化后，成人测试者保存合成心情，演示汇总会显示在这里。</p><button type="button" onClick={() => setActiveSection("students")}>查看虚构角色状态</button></section>
              ) : summary.totalEntries === 0 ? (
                <section className="teacher-empty-state"><h2>这个范围还没有心情记录</h2><p>账号和同意状态可在“学生账号”中查看。工作台不会用示例数据填充空白。</p></section>
              ) : (
                <section className="teacher-insights">
                  <article className="teacher-panel">
                    <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">只看班级整体</p><h2>7 天心情分布</h2></div><span>{moodTotal} 次自述</span></div>
                    <ul className="mood-bars">
                      {summary.moodCounts.map((item) => {
                        const meta = moodMeta[item.mood] || { label: "其他自述", color: "#9a91ab" };
                        const percent = moodTotal ? Math.round(item.count / moodTotal * 100) : 0;
                        return <li key={item.mood}><div><span style={{ background: meta.color }}></span><strong>{meta.label}</strong><b>{item.count}</b></div><div className="mood-track" role="img" aria-label={`${meta.label} ${item.count} 次，占 ${percent}%`}><i style={{ "--bar-width": `${percent}%`, "--bar-color": meta.color } as CSSProperties}></i></div></li>;
                      })}
                    </ul>
                  </article>
                  <article className="teacher-panel">
                    <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">不作个体评分</p><h2>每日完成趋势</h2></div><span>近 7 天</span></div>
                    <ol className="trend-chart" aria-label="近七日班级心情记录数">
                      {summary.daily.map((item) => <li key={item.date}><span className={item.urgent ? "has-urgent" : ""} style={{ "--trend-height": `${Math.max(10, item.count / trendMax * 100)}%` } as CSSProperties}></span><strong>{item.count}</strong><time>{new Date(`${item.date}T00:00:00`).toLocaleDateString("zh-CN", { weekday: "short" })}</time></li>)}
                    </ol>
                    <p className="panel-note">图表只用于看班级支持节奏，不推断个体心理状态。</p>
                  </article>
                </section>
              )}

              <section className="teacher-panel support-preview">
                <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">合成支持线索</p><h2>模拟支持请求</h2></div><button type="button" onClick={() => setActiveSection("safety")}>查看处置台</button></div>
                {summary?.supportQueue.length ? <ul>{summary.supportQueue.slice(0, 4).map((item) => <li key={item.id}><span className={item.safetyLevel === "urgent" ? "urgent-dot" : "support-dot"}></span><div><strong>{item.participantCode}</strong><p>{item.safetyLevel === "urgent" ? "合成内容触发本地规则，请模拟人工核对" : "虚构学生发出模拟支持请求"}</p></div><time>{formatDate(item.createdAt)}</time></li>)}</ul> : <p className="teacher-inline-empty">当前没有模拟支持请求。</p>}
              </section>
            </>
          )}

          {activeSection === "students" && (
            <section className="accounts-section">
              {sandboxManagedAccounts ? (
                <div className="accounts-actions sandbox-managed-accounts">
                  <div><p className="teacher-eyebrow">服务端统一初始化</p><h2>虚构班级与账号</h2><p>为防止录入真实信息，公开沙盒不提供创建班级或学生账号的表单。虚构角色与一次性凭据由部署管理员在服务端生成并单独发放。</p></div>
                  <span className="sandbox-managed-badge">禁止在浏览器录入现实资料</span>
                </div>
              ) : (
                <>
                  <div className="accounts-actions">
                    <div><p className="teacher-eyebrow">仅限合成角色</p><h2>虚构班级与账号</h2><p>禁止填写真实姓名、学号、班级、学校、手机号或其他可识别信息。</p></div>
                    <div><button type="button" onClick={() => setClassFormOpen((open) => !open)}>创建班级</button><button className="primary" type="button" onClick={() => setStudentFormOpen((open) => !open)} disabled={!classes.length}>创建学生账号</button></div>
                  </div>
                  {classFormOpen && <form className="teacher-form-grid" onSubmit={createClass}><h3>创建合成班级</h3><label>虚构班级名称<input value={className} onChange={(event) => setClassName(event.target.value)} required maxLength={80} /></label><label>虚构支持岗位<input value={contactName} onChange={(event) => setContactName(event.target.value)} required maxLength={80} /></label><label>合成联系码<input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} required maxLength={32} /></label><div className="form-actions"><button type="submit" className="primary" disabled={classBusy}>{classBusy ? "正在创建…" : "创建合成班级"}</button><button type="button" onClick={() => setClassFormOpen(false)}>取消</button></div></form>}
                  {studentFormOpen && <form className="teacher-form-grid student-create-form" onSubmit={createStudent}><h3>创建虚构学生角色</h3><label>所属合成班级<select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} required><option value="">请选择</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>虚构用户名<input value={studentUsername} onChange={(event) => setStudentUsername(event.target.value)} required minLength={3} maxLength={64} /></label><label>演示初始密码<input type="password" value={studentPassword} onChange={(event) => setStudentPassword(event.target.value)} required minLength={12} /></label><label>情境年龄段<select value={studentAgeBand} onChange={(event) => setStudentAgeBand(event.target.value as "under14" | "14plus")}><option value="under14">合成：14 岁以下</option><option value="14plus">合成：14 岁及以上</option></select></label><label className="teacher-check"><input aria-label="模拟前置同意状态" type="checkbox" checked={guardianVerified} onChange={(event) => setGuardianVerified(event.target.checked)} /><span><strong>模拟前置同意已完成</strong></span></label><div className="form-actions"><button type="submit" className="primary" disabled={studentBusy}>{studentBusy ? "正在创建…" : "创建虚构角色"}</button><button type="button" onClick={() => setStudentFormOpen(false)}>取消</button></div></form>}
                </>
              )}

              <div className="class-strip" aria-label="合成班级概况">{classes.length ? classes.map((item) => <button key={item.id} type="button" className={selectedClassId === item.id ? "is-active" : ""} onClick={() => { setSelectedClassId(item.id); void loadTeacherData(item.id); }}><strong>{item.name}</strong><span>{item.studentCount} 个虚构账号</span><small>模拟支持岗位：{item.safetyContactName || "未设置"}</small></button>) : <p>还没有合成班级。</p>}</div>

              <div className="account-table-wrap">
                <div className="account-table-summary"><strong>{selectedClass ? selectedClass.name : "全部班级"}</strong><span>{activeStudents} 个启用账号 · {consentedStudents} 个已完成双重同意</span></div>
                {students.length ? <div className="account-table" role="table" aria-label="虚构角色和模拟状态"><div className="account-row account-head" role="row"><span role="columnheader">虚构账号</span><span role="columnheader">情境年龄段</span><span role="columnheader">模拟前置状态</span><span role="columnheader">角色确认</span><span role="columnheader">账号状态</span><span role="columnheader">操作</span></div>{students.map((student) => <div key={student.id} className="account-row" role="row"><span role="cell"><strong>{student.username}</strong><small>仅限合成代号</small></span><span role="cell">{student.ageBand === "under14" ? "合成：14 岁以下" : "合成：14 岁及以上"}</span><span role="cell"><i className={student.guardianConsentVerified ? "status-ok" : "status-wait"}>{student.guardianConsentVerified ? "已开启" : "未开启"}</i></span><span role="cell"><i className={student.studentConsented ? "status-ok" : "status-wait"}>{student.studentConsented ? "已确认" : "待测试者确认"}</i></span><span role="cell"><i className={student.active ? "status-ok" : "status-off"}>{student.active ? "启用" : "已停用"}</i></span><span role="cell" className="account-buttons"><button type="button" disabled={updatingId === student.id} onClick={() => void updateStudent(student, { guardianConsentVerified: !student.guardianConsentVerified })}>{student.guardianConsentVerified ? "关闭模拟前置状态" : "开启模拟前置状态"}</button><button type="button" disabled={updatingId === student.id} onClick={() => void updateStudent(student, { active: !student.active })}>{student.active ? "停用" : "启用"}</button></span></div>)}</div> : <div className="teacher-empty-state compact"><h3>这个范围还没有虚构角色</h3><p>创建后将显示实时的演示状态；所有账号必须为合成代号。</p></div>}
              </div>
            </section>
          )}

          {activeSection === "safety" && (
            <section className="safety-section">
              <div className="support-priority-guide" role="note" aria-label="教师查看优先顺序">
                <strong>查看顺序：① 明确危险表达 · ② 学生主动求助与长时使用 · ③ AI 关心线索</strong>
                <p>三类提示彼此独立；只有本地明确危险规则进入紧急队列。AI 线索始终需要人工核对，不能单独把学生标为危险、异常或正常。</p>
              </div>

              <section className="urgent-safety-panel" aria-labelledby="urgent-safety-title">
                <div className="safety-boundary"><strong>最高优先 · 这是模拟处置，不会联系真人</strong><p>事件只说明本地明确危险表达规则在合成心情、AI 对话或语音转写中被触发，不显示原文，也不经过 Qwen 定级。</p></div>
                <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">1 · 明确危险表达</p><h2 id="urgent-safety-title">紧急人工核对队列</h2></div><span>{unreviewedEvents} 项待教师查看</span></div>
                {safetyEvents.length ? <div className="safety-event-list">{safetyEvents.map((item) => <article key={item.id} className={`safety-event is-${item.status}`}><span className="event-mark" aria-hidden="true">{item.status === "new" ? "!" : "✓"}</span><div className="event-main"><div><strong>{item.studentUsername}</strong><span>{item.className}</span><i>{statusLabels[item.status]}</i></div><dl><div><dt>事件码</dt><dd>本地明确危险表达规则</dd></div><div><dt>来源</dt><dd>{sourceLabels[item.sourceType]}</dd></div><div><dt>触发时间</dt><dd>{formatDate(item.createdAt)}</dd></div></dl><p>不含合成对话原文。请仅模拟核对与处置，不会联系真人。</p></div><div className="event-actions">{item.status === "new" && <button type="button" onClick={() => void updateSafetyEvent(item, "acknowledged")} disabled={updatingId === item.id}>我已看到，开始模拟核对</button>}{item.status === "acknowledged" && <button type="button" onClick={() => void updateSafetyEvent(item, "resolved")} disabled={updatingId === item.id}>记录为已完成模拟处置</button>}{item.status === "resolved" && <span>完成于 {item.resolvedAt ? formatDate(item.resolvedAt) : "已记录"}</span>}</div></article>)}</div> : <div className="teacher-empty-state compact"><h3>当前没有明确危险表达事件</h3><p>这里只表示目前没有被本地明确规则触发的合成事件，不能据此判断学生状态正常。</p></div>}
              </section>

              <section className="attention-panel" aria-labelledby="attention-title">
                <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">2 · 日常关心 · 非危机</p><h2 id="attention-title">学生主动支持与休息提示</h2></div><span>{unreviewedAttentionEvents} 项待教师查看</span></div>
                <p className="attention-boundary">学生主动请求支持会优先显示；同一对话持续超过 3 小时则建议日常关心与休息提醒。两类都不代表异常或危机，只显示虚构账号、班级和提示时间，不显示心情或对话原文。</p>
                {attentionEvents.length ? <div className="attention-event-list">{attentionEvents.map((item) => { const supportRequest = item.kind === "student_support_request"; return <article key={item.id} className={`attention-event is-${item.status} ${supportRequest ? "is-support-request" : "is-long-chat"}`}><span className="attention-mark" aria-hidden="true">{supportRequest ? "援" : "休"}</span><div className="event-main"><div><strong>{item.studentUsername}</strong><span>{item.className}</span><i>{statusLabels[item.status]}</i></div><dl><div><dt>提示类型</dt><dd>{supportRequest ? "学生主动请求支持" : "同一对话持续超过 3 小时"}</dd></div><div><dt>提示时间</dt><dd>{formatDate(item.createdAt)}</dd></div></dl><p>{supportRequest ? "学生主动表示希望获得支持；请以日常、非评判方式关心，不作异常判断或心理诊断。" : "建议以日常、非评判方式关心使用时长并提醒休息；不作异常判断或心理诊断。"}</p></div><div className="event-actions">{item.status === "new" && <button type="button" onClick={() => void updateAttentionEvent(item, "acknowledged")} disabled={updatingId === item.id}>我已看到</button>}{item.status === "acknowledged" && <button type="button" onClick={() => void updateAttentionEvent(item, "resolved")} disabled={updatingId === item.id}>{supportRequest ? "已完成日常关心" : "已完成日常关心与休息提醒"}</button>}{item.status === "resolved" && <span>完成于 {item.resolvedAt ? formatDate(item.resolvedAt) : "已记录"}</span>}</div></article>; })}</div> : <div className="teacher-empty-state compact"><h3>当前没有日常关注提示</h3><p>学生主动请求支持，或同一对话持续超过 3 小时后，会在这里生成一次提示。</p></div>}
              </section>

              <section className="conversation-cue-panel" aria-labelledby="conversation-cue-title">
                <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">3 · AI 关心线索 · 非危机</p><h2 id="conversation-cue-title">待人工核对</h2></div><span>{unreviewedCues} 项待教师核对</span></div>
                <p className="conversation-cue-boundary">线索由 AI 从普通对话中生成，不含对话原文，不是诊断或异常判定，也可能不准确。请结合日常接触人工核对；这里没有线索时，不能据此写成“学生正常”。</p>
                {conversationCues.length ? <div className="conversation-cue-list">{conversationCues.map((cue) => <article key={cue.id} className={`conversation-cue is-${cue.status}`}><div className="cue-card-heading"><span aria-hidden="true">AI</span><div><strong>{cue.studentUsername}</strong><small>{cue.className}</small></div><i>{cueStatusLabels[cue.status]}</i></div><dl><div><dt>表达类别</dt><dd>{safeLabel(expressionLabels, cue.observedExpression)}</dd></div><div><dt>主题</dt><dd>{safeLabels(themeLabels, cue.themes).join("、")}</dd></div><div><dt>建议核对时效</dt><dd>{safeLabel(followUpLabels, cue.followUp)}</dd></div><div><dt>变化趋势</dt><dd>{safeLabel(trendLabels, cue.trend)}</dd></div><div><dt>AI 置信度</dt><dd>{safeLabel(confidenceLabels, cue.confidence)}</dd></div><div><dt>结构化依据</dt><dd>{safeLabels(basisLabels, cue.basis).join("、")}</dd></div><div><dt>生成时间</dt><dd>{formatDate(cue.createdAt)}</dd></div></dl><p>只显示受限类别，不显示学生的聊天原文。置信度不是准确率，也不能替代教师判断。</p><div className="cue-actions">{cue.status === "new" && <button type="button" onClick={() => void updateConversationCue(cue, "acknowledged")} disabled={updatingId === cue.id}>开始人工核对</button>}{cue.status === "acknowledged" && <button type="button" onClick={() => void updateConversationCue(cue, "resolved")} disabled={updatingId === cue.id}>完成核对</button>}{(cue.status === "new" || cue.status === "acknowledged") && <button className="is-secondary" type="button" onClick={() => void updateConversationCue(cue, "dismissed_inaccurate")} disabled={updatingId === cue.id}>标记为不准确</button>}{cue.status === "resolved" && <span>已完成核对</span>}{cue.status === "dismissed_inaccurate" && <span>不会作为有效线索使用</span>}</div></article>)}</div> : <div className="teacher-empty-state compact"><h3>当前没有 AI 关心线索</h3><p>这只表示目前没有待显示的结构化线索，不能据此判断学生状态正常。</p></div>}
              </section>

              <section className="cccr-card" aria-labelledby="cccr-title"><div><p className="teacher-eyebrow">Cue → Check → Choose → Reflect</p><h2 id="cccr-title">模拟教师处置流程</h2></div><ol><li><b>1</b><strong>Cue · 看合成线索</strong><p>只读事件码、来源、时间与虚构账号。</p></li><li><b>2</b><strong>Check · 选核对步骤</strong><p>扮演如何确认合成角色状态，不会联系真人。</p></li><li><b>3</b><strong>Choose · 选模拟支持</strong><p>从预设处置中选择合理下一步，不输入真实联系信息。</p></li><li><b>4</b><strong>Reflect · 留痕复盘</strong><p>只记录模拟处置状态，不复制对话原文。</p></li></ol></section>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
