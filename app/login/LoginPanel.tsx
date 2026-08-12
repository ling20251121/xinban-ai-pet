"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";

type LoginRole = "student" | "teacher";

type LoginUser = {
  role: LoginRole;
  mustChangePassword?: boolean;
};

function safeNext(role: LoginRole) {
  return role === "teacher" ? "/teacher" : "/";
}

export default function LoginPanel() {
  const [role, setRole] = useState<LoginRole>("student");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [bootstrapUsername, setBootstrapUsername] = useState("");
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapDisplayName, setBootstrapDisplayName] = useState("");
  const [bootstrapShowPassword, setBootstrapShowPassword] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { authenticated?: boolean; user?: LoginUser }) => {
        if (!active) return;
        if (data.authenticated && data.user) {
          window.location.replace(safeNext(data.user.role));
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await response.json()) as { user?: LoginUser; error?: string };
      if (!response.ok || !data.user) {
        const message = response.status === 429
          ? "尝试次数较多，请稍后再试，或联系老师重置密码。"
          : response.status === 401
            ? "用户名或密码不正确。请检查学校发放的信息。"
            : data.error || "暂时无法登录，请稍后再试。";
        throw new Error(message);
      }
      window.location.replace(safeNext(data.user.role));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "暂时无法登录，请稍后再试。 ");
      setBusy(false);
    }
  }

  async function bootstrapTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBootstrapBusy(true);
    setBootstrapError("");
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bootstrapToken,
          username: bootstrapUsername.trim(),
          password: bootstrapPassword,
          displayName: bootstrapDisplayName.trim() || undefined,
        }),
      });
      const data = (await response.json()) as { user?: LoginUser; error?: string };
      if (!response.ok || !data.user) {
        const message = response.status === 409
          ? "系统已经完成首次初始化。请使用教师账号登录。"
          : response.status === 403
            ? "部署初始化口令无效，请向部署管理员确认。"
            : response.status === 429
              ? "尝试次数较多，请稍后再试。"
              : data.error || "暂时无法创建首个教师账号。";
        throw new Error(message);
      }
      setBootstrapToken("");
      setBootstrapPassword("");
      window.location.replace("/teacher");
    } catch (bootstrapCreateError) {
      setBootstrapError(
        bootstrapCreateError instanceof Error
          ? bootstrapCreateError.message
          : "暂时无法创建首个教师账号。",
      );
      setBootstrapBusy(false);
    }
  }

  return (
    <main className="login-page" lang="zh-CN">
      <section className="login-visual" aria-labelledby="login-welcome">
        <a className="login-brand" href="/login" aria-label="心伴 AI-Pet 登录页">
          <Image src="/dog.svg" alt="" width={56} height={56} priority />
          <span><strong>心伴</strong><small>AI-Pet</small></span>
        </a>
        <div className="login-visual-copy">
          <p className="login-eyebrow">今天也可以慢慢说</p>
          <h1 id="login-welcome">给心情留一个柔软的位置</h1>
          <p>记录此刻，必要时找真人；只有你主动选择，才会进入一次有时间和轮次限制的 AI 对话。</p>
        </div>
        <div className="login-pet-stage" aria-hidden="true">
          <span className="login-orbit"></span>
          <Image src="/dog.svg" alt="" width={310} height={310} priority />
        </div>
        <div className="login-boundary">
          <strong>AI 不是心理诊断</strong>
          <p>如有立即危险，请离开危险地点并找身边成年人，拨打 110 或 120。</p>
        </div>
      </section>

      <section className="login-form-pane" aria-labelledby="login-title">
        <div className="login-card">
          <p className="login-eyebrow">学校账号登录</p>
          <h2 id="login-title">欢迎回来</h2>
          <p className="login-intro">账号由学校统一发放，不需要填写手机号、姓名或其他个人资料。</p>

          <div className="role-tabs" role="group" aria-label="选择登录入口">
            <button type="button" className={role === "student" ? "is-active" : ""} onClick={() => setRole("student")} aria-pressed={role === "student"}>学生登录</button>
            <button type="button" className={role === "teacher" ? "is-active" : ""} onClick={() => setRole("teacher")} aria-pressed={role === "teacher"}>教师登录</button>
          </div>

          <form className="login-form" onSubmit={login} aria-busy={busy || checking}>
            <label htmlFor="login-username">用户名</label>
            <input id="login-username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} required disabled={busy || checking} placeholder="输入学校发放的用户名" />

            <label htmlFor="login-password">密码</label>
            <div className="password-field">
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy || checking} placeholder="输入密码" />
              <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? "隐藏" : "显示"}</button>
            </div>

            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={busy || checking || !username.trim() || !password}>
              {checking ? "正在确认登录状态……" : busy ? "正在登录……" : `进入${role === "teacher" ? "教师工作台" : "心情空间"}`}
            </button>
          </form>

          <div className="login-help">
            <strong>忘记密码或账号停用？</strong>
            <p>请联系学校负责老师重置。为了安全，登录页不通过电话或邮箱找回。</p>
          </div>
          {role === "teacher" && (
            <details
              className="bootstrap-panel"
              open={bootstrapOpen}
              onToggle={(event) => setBootstrapOpen(event.currentTarget.open)}
            >
              <summary>首次部署：创建第一个教师账号</summary>
              <div className="bootstrap-copy">
                <strong>仅在系统尚无教师账号时可用</strong>
                <p>初始化口令由部署管理员设置并另行提供。页面不会显示、保存或找回这个口令；首个账号创建成功后，此入口会被服务端永久关闭。</p>
              </div>
              <form className="bootstrap-form" onSubmit={bootstrapTeacher} aria-busy={bootstrapBusy}>
                <label htmlFor="bootstrap-token">部署初始化口令</label>
                <input id="bootstrap-token" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} required minLength={24} disabled={bootstrapBusy} placeholder="向部署管理员获取" />
                <label htmlFor="bootstrap-username">教师用户名</label>
                <input id="bootstrap-username" autoComplete="username" value={bootstrapUsername} onChange={(event) => setBootstrapUsername(event.target.value)} required minLength={4} maxLength={48} pattern="[a-z0-9][a-z0-9._-]{3,47}" disabled={bootstrapBusy} placeholder="4–48 位小写字母或数字" />
                <label htmlFor="bootstrap-display-name">工作台显示称呼 <small>可选</small></label>
                <input id="bootstrap-display-name" autoComplete="name" value={bootstrapDisplayName} onChange={(event) => setBootstrapDisplayName(event.target.value)} maxLength={40} disabled={bootstrapBusy} placeholder="例如：心理老师" />
                <label htmlFor="bootstrap-password">设置教师密码</label>
                <div className="password-field">
                  <input id="bootstrap-password" type={bootstrapShowPassword ? "text" : "password"} autoComplete="new-password" value={bootstrapPassword} onChange={(event) => setBootstrapPassword(event.target.value)} required minLength={12} maxLength={128} disabled={bootstrapBusy} aria-describedby="bootstrap-password-help" />
                  <button type="button" onClick={() => setBootstrapShowPassword((shown) => !shown)} aria-pressed={bootstrapShowPassword} aria-label={bootstrapShowPassword ? "隐藏教师密码" : "显示教师密码"}>{bootstrapShowPassword ? "隐藏" : "显示"}</button>
                </div>
                <p id="bootstrap-password-help" className="bootstrap-field-help">12–128 个字符，大小写字母、数字、符号至少三类，不能含空格。</p>
                {bootstrapError && <p className="login-error" role="alert">{bootstrapError}</p>}
                <button className="bootstrap-submit" type="submit" disabled={bootstrapBusy || !bootstrapToken || !bootstrapUsername || !bootstrapPassword}>{bootstrapBusy ? "正在创建……" : "创建首个教师账号"}</button>
              </form>
            </details>
          )}
          <p className="login-footnote">登录角色由学校账号决定，入口选择不会改变账号权限。</p>
        </div>
      </section>
    </main>
  );
}
