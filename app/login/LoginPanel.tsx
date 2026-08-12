"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";
import SandboxNotice from "../SandboxNotice";

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
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [syntheticOnlyConfirmed, setSyntheticOnlyConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const session = data as { authenticated?: boolean; user?: LoginUser };
        if (!active) return;
        if (session.authenticated && session.user) {
          window.location.replace(safeNext(session.user.role));
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
        body: JSON.stringify({
          username: username.trim(),
          password,
          adultConfirmed,
          syntheticOnlyConfirmed,
        }),
      });
      const data = (await response.json()) as { user?: LoginUser; error?: string };
      if (!response.ok || !data.user) {
        const message = response.status === 429
          ? "尝试次数较多，请稍后再试，或联系演示部署方重置凭据。"
          : response.status === 401
            ? "用户名或密码不正确。请检查部署方发放的演示凭据。"
            : data.error || "暂时无法登录，请稍后再试。";
        throw new Error(message);
      }
      window.location.replace(safeNext(data.user.role));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "暂时无法登录，请稍后再试。 ");
      setBusy(false);
    }
  }

  return (
    <main className="login-page" lang="zh-CN">
      <SandboxNotice surface="login" />
      <section className="login-visual" aria-labelledby="login-welcome">
        <a className="login-brand" href="/login" aria-label="心伴 AI-Pet 登录页">
          <Image src="/dog.svg" alt="" width={56} height={56} priority />
          <span><strong>心伴</strong><small>AI-Pet</small></span>
        </a>
        <div className="login-visual-copy">
          <p className="login-eyebrow">今天也可以慢慢说</p>
          <h1 id="login-welcome">给心情留一个柔软的位置</h1>
          <p>扮演合成情境，体验心情记录、语音、AI 对话与模拟教师处置闭环。</p>
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
          <p className="login-eyebrow">合成学校沙盒</p>
          <h2 id="login-title">选一个虚构角色</h2>
          <p className="login-intro">18 岁以上测试者可扮演虚构学生或教师，体验心情、语音、Qwen 对话和人工处置闭环。</p>

          <nav className="experience-mode-picker" aria-label="选择体验方式">
            <a className="is-current" href="/login" aria-current="page">
              <span>体验模式 A</span>
              <strong>完整学生／教师界面</strong>
              <small>成人扮演固定虚构角色，真实运行界面和 API 流程。</small>
            </a>
            <a href="/evaluate">
              <span>体验模式 B</span>
              <strong>教师／专家匿名评估</strong>
              <small>评价固定合成案例与冻结 AI 输出，不录入学生资料。</small>
            </a>
          </nav>

          <section className="demo-credentials" aria-labelledby="demo-credentials-title">
            <strong id="demo-credentials-title">演示凭据不在页面公开</strong>
            <p>请使用部署方单独发放的虚构账号和一次性初始密码。这些账号不对应任何真实学生。</p>
          </section>

          <div className="role-tabs" role="group" aria-label="选择登录入口">
            <button type="button" className={role === "student" ? "is-active" : ""} onClick={() => setRole("student")} aria-pressed={role === "student"}>扮演虚构学生</button>
            <button type="button" className={role === "teacher" ? "is-active" : ""} onClick={() => setRole("teacher")} aria-pressed={role === "teacher"}>扮演虚构教师</button>
          </div>

          <form className="login-form" onSubmit={login} aria-busy={busy || checking}>
            <label htmlFor="login-username">用户名</label>
            <input id="login-username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} required disabled={busy || checking} placeholder="输入部署方发放的虚构用户名" />

            <label htmlFor="login-password">密码</label>
            <div className="password-field">
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy || checking} placeholder="输入密码" />
              <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? "隐藏" : "显示"}</button>
            </div>

            <fieldset className="sandbox-confirmations">
              <legend>进入沙盒前必须确认</legend>
              <div className="sandbox-confirmation-row">
                <input id="adult-confirmed" type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} required />
                <span><label htmlFor="adult-confirmed">我已满 18 岁</label><small>本演示不向未成年人开放。</small></span>
              </div>
              <div className="sandbox-confirmation-row">
                <input id="synthetic-only-confirmed" type="checkbox" checked={syntheticOnlyConfirmed} onChange={(event) => setSyntheticOnlyConfirmed(event.target.checked)} required />
                <span><label htmlFor="synthetic-only-confirmed">我只扮演虚构角色</label><small>我不会输入真实个人、学生、学校或联系信息。</small></span>
              </div>
            </fieldset>

            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={busy || checking || !username.trim() || !password || !adultConfirmed || !syntheticOnlyConfirmed}>
              {checking ? "正在确认登录状态……" : busy ? "正在登录……" : `进入${role === "teacher" ? "教师工作台" : "心情空间"}`}
            </button>
          </form>

          <div className="login-help">
            <strong>忘记密码或账号停用？</strong>
            <p>请联系演示部署方重置。不要使用个人常用密码，也不要填写真实姓名、学号、班级、手机号或学校名称。</p>
          </div>
          {role === "teacher" && (
            <div className="bootstrap-panel sandbox-admin-note">
              <strong>虚构账号由部署管理员初始化</strong>
              <p>管理口令不会进入公开浏览器。请使用部署方离线生成并单独发放的虚构教师凭据。</p>
            </div>
          )}
          <p className="login-footnote">登录角色由合成演示账号决定。本沙盒不是学校服务，请勿邀请未成年人参与。</p>
        </div>
      </section>
    </main>
  );
}
