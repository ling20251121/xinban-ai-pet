"use client";

import Image from "next/image";
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
      const [studentResponse, summaryResponse, safetyResponse] = await Promise.all([
        fetch(`/api/teacher/students${suffix}`, { cache: "no-store" }),
        fetch(`/api/teacher/summary?days=7${classId ? `&classId=${encodeURIComponent(classId)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/teacher/safety-events${suffix}`, { cache: "no-store" }),
      ]);
      if ([studentResponse, summaryResponse, safetyResponse].some(handleUnauthorized)) return;
      const [studentData, summaryData, safetyData] = await Promise.all([
        studentResponse.json() as Promise<{ students?: StudentAccount[]; error?: string }>,
        summaryResponse.json() as Promise<unknown>,
        safetyResponse.json() as Promise<{ events?: SafetyEvent[]; error?: string }>,
      ]);
      if (!studentResponse.ok) throw new Error(studentData.error || "暂时无法读取学生账号");
      if (!summaryResponse.ok) throw new Error("暂时无法读取班级汇总");
      if (!safetyResponse.ok) throw new Error(safetyData.error || "暂时无法读取安全事件");
      setStudents(studentData.students || []);
      setSummary(normalizeSummary(summaryData));
      setSafetyEvents(safetyData.events || []);
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
      setNotice("学生账号已创建。初始密码只显示在你刚才输入的位置，请通过学校安全渠道发放。 ");
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
      setNotice(status === "acknowledged" ? "已记录教师确认；仍需按学校流程与学生本人核对。 " : "已记录完成核对。 ");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "暂时无法更新核对状态");
    } finally {
      setUpdatingId(null);
    }
  }

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const activeStudents = students.filter((student) => student.active).length;
  const consentedStudents = students.filter((student) => student.guardianConsentVerified && student.studentConsented).length;
  const unreviewedEvents = safetyEvents.filter((item) => item.status === "new").length;
  const moodTotal = summary?.moodCounts.reduce((total, item) => total + item.count, 0) || 0;

  const trendMax = useMemo(() => Math.max(5, ...(summary?.daily.map((item) => item.count) || [0])), [summary]);

  if (authState === "loading") {
    return <main className="teacher-loading" aria-busy="true"><Image src="/dog.svg" alt="" width={82} height={82} priority /><p>正在打开教师工作台……</p></main>;
  }
  if (authState === "error" || !user) {
    return <main className="teacher-loading"><h1>暂时无法进入工作台</h1><p>请检查学校服务后重试。</p><button type="button" onClick={() => window.location.reload()}>重新尝试</button></main>;
  }

  return (
    <div className="teacher-shell" lang="zh-CN">
      <a className="teacher-skip-link" href="#teacher-main">跳到主要内容</a>
      <header className="teacher-topbar">
        <a className="teacher-brand" href="/teacher"><Image src="/dog.svg" alt="" width={42} height={42} priority /><span><strong>心伴</strong><small>教师支持台</small></span></a>
        <div className="teacher-account"><span><small>已登录教师</small>{user.displayName || user.username}</span><button type="button" onClick={logout}>退出</button></div>
      </header>

      <div className="teacher-workbench">
        <aside className="teacher-sidebar" aria-label="教师工作台导航">
          <nav>
            <button type="button" className={activeSection === "overview" ? "is-active" : ""} onClick={() => setActiveSection("overview")}><span aria-hidden="true">◫</span>班级概览</button>
            <button type="button" className={activeSection === "students" ? "is-active" : ""} onClick={() => setActiveSection("students")}><span aria-hidden="true">◎</span>学生账号</button>
            <button type="button" className={activeSection === "safety" ? "is-active" : ""} onClick={() => setActiveSection("safety")}><span aria-hidden="true">◇</span>支持与核对{unreviewedEvents > 0 && <b>{unreviewedEvents}</b>}</button>
          </nav>
          <section className="sidebar-boundary">
            <strong>信息边界</strong>
            <p>工作台只显示班级汇总、学校账号、同意状态和最少必要安全事件，不显示普通聊天原文。</p>
          </section>
        </aside>

        <main id="teacher-main" className="teacher-main">
          <header className="teacher-page-heading">
            <div><p className="teacher-eyebrow">学生支持工作台</p><h1>{activeSection === "overview" ? "班级概览" : activeSection === "students" ? "学生账号与同意" : "支持与安全核对"}</h1><p>这些线索用于及时关心，不用于诊断、排名、处罚或评价学生。</p></div>
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
                <article><span className="metric-icon is-gold" aria-hidden="true">援</span><div><strong>{summary?.supportRequests ?? 0}</strong><p>真人支持请求</p></div><small>需按校内流程联系</small></article>
                <article className={unreviewedEvents ? "is-urgent" : ""}><span className="metric-icon is-red" aria-hidden="true">核</span><div><strong>{unreviewedEvents}</strong><p>待教师查看</p></div><small>不等于已通知</small></article>
              </section>

              {!summary || (summary.totalEntries === 0 && classes.length === 0) ? (
                <section className="teacher-empty-state"><Image src="/dog.svg" alt="" width={100} height={100} /><h2>还没有班级数据</h2><p>先创建班级和学生账号。学生完成同意并保存心情后，真实汇总会显示在这里。</p><button type="button" onClick={() => { setActiveSection("students"); setClassFormOpen(true); }}>创建第一个班级</button></section>
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
                <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">最少必要线索</p><h2>真人支持请求</h2></div><button type="button" onClick={() => setActiveSection("safety")}>查看核对台</button></div>
                {summary?.supportQueue.length ? <ul>{summary.supportQueue.slice(0, 4).map((item) => <li key={item.id}><span className={item.safetyLevel === "urgent" ? "urgent-dot" : "support-dot"}></span><div><strong>{item.participantCode}</strong><p>{item.safetyLevel === "urgent" ? "触发本地安全规则，需立即人工核对" : "学生主动请求真人联系"}</p></div><time>{formatDate(item.createdAt)}</time></li>)}</ul> : <p className="teacher-inline-empty">当前没有真人支持请求。</p>}
              </section>
            </>
          )}

          {activeSection === "students" && (
            <section className="accounts-section">
              <div className="accounts-actions">
                <div><p className="teacher-eyebrow">学校统一发放</p><h2>班级与学生账号</h2><p>不收集手机号。初始密码登录后必须修改；监护人核验和学生本人同意缺一不可。</p></div>
                <div><button type="button" onClick={() => setClassFormOpen((open) => !open)}>创建班级</button><button className="primary" type="button" onClick={() => setStudentFormOpen((open) => !open)} disabled={!classes.length}>创建学生账号</button></div>
              </div>

              {classFormOpen && <form className="teacher-form-grid" onSubmit={createClass}><h3>创建班级并指定真人安全联系人</h3><label>班级名称<input value={className} onChange={(event) => setClassName(event.target.value)} required maxLength={80} placeholder="例如：七年级 2 班" /></label><label>安全联系人<input value={contactName} onChange={(event) => setContactName(event.target.value)} required maxLength={80} placeholder="姓名或岗位" /></label><label>校内联系电话<input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} required maxLength={32} inputMode="tel" placeholder="学校可用的值班电话" /></label><div className="form-actions"><button type="submit" className="primary" disabled={classBusy}>{classBusy ? "正在创建…" : "创建班级"}</button><button type="button" onClick={() => setClassFormOpen(false)}>取消</button></div></form>}

              {studentFormOpen && <form className="teacher-form-grid student-create-form" onSubmit={createStudent}><h3>创建学生学校账号</h3><label>所属班级<select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} required><option value="">请选择</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>匿名用户名<input value={studentUsername} onChange={(event) => setStudentUsername(event.target.value)} required minLength={3} maxLength={64} autoComplete="off" placeholder="不使用姓名、学号或可识别昵称" /></label><label>初始密码<input type="password" value={studentPassword} onChange={(event) => setStudentPassword(event.target.value)} required minLength={12} autoComplete="new-password" placeholder="至少 12 个字符" /></label><label>年龄段<select value={studentAgeBand} onChange={(event) => setStudentAgeBand(event.target.value as "under14" | "14plus")}><option value="under14">14 岁以下</option><option value="14plus">14 岁及以上</option></select></label><label className="teacher-check"><input aria-label="学校已核验监护人同意" type="checkbox" checked={guardianVerified} onChange={(event) => setGuardianVerified(event.target.checked)} /><span><strong>学校已核验监护人同意</strong><small>未勾选时账号可创建，但学生不能进入；14 岁以下尤其必须完成核验。</small></span></label><div className="form-actions"><button type="submit" className="primary" disabled={studentBusy}>{studentBusy ? "正在创建…" : "创建账号"}</button><button type="button" onClick={() => setStudentFormOpen(false)}>取消</button></div></form>}

              <div className="class-strip" aria-label="班级概况">{classes.length ? classes.map((item) => <button key={item.id} type="button" className={selectedClassId === item.id ? "is-active" : ""} onClick={() => { setSelectedClassId(item.id); void loadTeacherData(item.id); }}><strong>{item.name}</strong><span>{item.studentCount} 个账号</span><small>安全联系人：{item.safetyContactName || "未设置"}</small></button>) : <p>还没有班级。</p>}</div>

              <div className="account-table-wrap">
                <div className="account-table-summary"><strong>{selectedClass ? selectedClass.name : "全部班级"}</strong><span>{activeStudents} 个启用账号 · {consentedStudents} 个已完成双重同意</span></div>
                {students.length ? <div className="account-table" role="table" aria-label="学生账号和同意状态"><div className="account-row account-head" role="row"><span role="columnheader">匿名学校账号</span><span role="columnheader">年龄段</span><span role="columnheader">监护人核验</span><span role="columnheader">学生同意</span><span role="columnheader">账号状态</span><span role="columnheader">操作</span></div>{students.map((student) => <div key={student.id} className="account-row" role="row"><span role="cell"><strong>{student.username}</strong><small>不显示姓名或可识别称呼</small></span><span role="cell">{student.ageBand === "under14" ? "14 岁以下" : "14 岁及以上"}</span><span role="cell"><i className={student.guardianConsentVerified ? "status-ok" : "status-wait"}>{student.guardianConsentVerified ? "已核验" : "未核验"}</i></span><span role="cell"><i className={student.studentConsented ? "status-ok" : "status-wait"}>{student.studentConsented ? "已同意" : "待本人同意"}</i></span><span role="cell"><i className={student.active ? "status-ok" : "status-off"}>{student.active ? "启用" : "已停用"}</i></span><span role="cell" className="account-buttons"><button type="button" disabled={updatingId === student.id} onClick={() => void updateStudent(student, { guardianConsentVerified: !student.guardianConsentVerified })}>{student.guardianConsentVerified ? "撤销监护人核验" : "确认监护人已核验"}</button><button type="button" disabled={updatingId === student.id} onClick={() => void updateStudent(student, { active: !student.active })}>{student.active ? "停用" : "启用"}</button></span></div>)}</div> : <div className="teacher-empty-state compact"><h3>这个范围还没有学生账号</h3><p>创建后将显示真实的同意和启用状态；这里不会填充示例学生。</p></div>}
              </div>
            </section>
          )}

          {activeSection === "safety" && (
            <section className="safety-section">
              <div className="safety-boundary"><strong>先核对真人状态，不推断、不审问</strong><p>事件仅说明本地规则在心情记录、AI 对话或语音转写中被触发。工作台不显示原文，也不能证明已联系到学生。</p></div>
              <div className="teacher-panel-heading"><div><p className="teacher-eyebrow">最少必要安全事件</p><h2>人工核对队列</h2></div><span>{unreviewedEvents} 项待教师查看</span></div>
              {safetyEvents.length ? <div className="safety-event-list">{safetyEvents.map((item) => <article key={item.id} className={`safety-event is-${item.status}`}><span className="event-mark" aria-hidden="true">{item.status === "new" ? "!" : "✓"}</span><div className="event-main"><div><strong>{item.studentUsername}</strong><span>{item.className}</span><i>{statusLabels[item.status]}</i></div><dl><div><dt>事件码</dt><dd>本地危机词规则</dd></div><div><dt>来源</dt><dd>{sourceLabels[item.sourceType]}</dd></div><div><dt>触发时间</dt><dd>{formatDate(item.createdAt)}</dd></div></dl><p>不含学生原文。请通过学校既有真人渠道核对安全状态。</p></div><div className="event-actions">{item.status === "new" && <button type="button" onClick={() => void updateSafetyEvent(item, "acknowledged")} disabled={updatingId === item.id}>我已看到，开始核对</button>}{item.status === "acknowledged" && <button type="button" onClick={() => void updateSafetyEvent(item, "resolved")} disabled={updatingId === item.id}>记录为已完成核对</button>}{item.status === "resolved" && <span>完成于 {item.resolvedAt ? formatDate(item.resolvedAt) : "已记录"}</span>}</div></article>)}</div> : <div className="teacher-empty-state compact"><h3>当前没有安全事件</h3><p>这不是安全保证；日常支持仍应依靠老师对学生的真实了解。</p></div>}

              <section className="cccr-card" aria-labelledby="cccr-title"><div><p className="teacher-eyebrow">Cue → Check → Choose → Reflect</p><h2 id="cccr-title">教师人工核对流程</h2></div><ol><li><b>1</b><strong>Cue · 看线索</strong><p>只读事件码、来源、时间与账号。</p></li><li><b>2</b><strong>Check · 找本人</strong><p>尽快确认学生是否安全，不要求解释全部。</p></li><li><b>3</b><strong>Choose · 选支持</strong><p>按学校预案联系监护人、校医或紧急服务。</p></li><li><b>4</b><strong>Reflect · 留痕复盘</strong><p>只记录必要处置状态，不复制聊天原文。</p></li></ol></section>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
