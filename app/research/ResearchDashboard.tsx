"use client";

import { type FormEvent, useState } from "react";

type Group = {
  role: "teacher" | "expert"; participants: number; completed: number;
  avg_time_ms: number | null; avg_trust: number | null;
  avg_appropriateness: number | null; avg_usability: number | null;
  avg_safety: number | null; avg_sus: number | null; avg_workload: number | null;
};
type Summary = {
  participantCount: number; completedCount: number; minimumGroupSize: number;
  groups: Group[]; suppressedGroups: Array<"teacher" | "expert">;
  versions: { scenarioPack: string; output: string; prompt: string };
};

export default function ResearchDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [researchKey, setResearchKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadSummary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/research/summary", {
        headers: { "x-research-key": researchKey }, cache: "no-store",
      });
      const payload = await response.json() as Partial<Summary> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法读取研究汇总。");
      setSummary(payload as Summary);
    } catch (value) {
      setSummary(null);
      setError(value instanceof Error ? value.message : "无法读取研究汇总。");
    } finally { setLoading(false); }
  }

  async function downloadCsv() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/research/export", {
        headers: { "x-research-key": researchKey }, cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "导出失败。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "xinban-adult-evaluation.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (value) {
      setError(value instanceof Error ? value.message : "导出失败。");
    } finally { setLoading(false); }
  }

  return (
    <main className="research-shell">
      <header className="research-hero">
        <p className="eyebrow">EITT 成人形成性评估</p>
        <h1>研究者汇总</h1>
        <p>本页仅汇总教师与专家对<strong>合成学生情境</strong>的真实成人评价，不是学生效果数据，也不包含真实学生记录。</p>
      </header>
      <section className="research-card">
        <form onSubmit={loadSummary} className="research-auth">
          <label htmlFor="research-key">研究者访问密钥</label>
          <input id="research-key" type="password" autoComplete="off"
            value={researchKey} onChange={(event) => setResearchKey(event.target.value)}
            minLength={16} required />
          <button type="submit" disabled={loading}>{loading ? "正在读取…" : "读取汇总"}</button>
        </form>
        <p className="privacy-note">密钥只随本次请求发送，不写入浏览器存储。</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {summary && <>
        <section className="metric-grid" aria-label="评估完成概览">
          <article><span>成人评估者</span><strong>{summary.participantCount}</strong></article>
          <article><span>完成全部任务</span><strong>{summary.completedCount}</strong></article>
          <article><span>合成案例</span><strong>12</strong></article>
          <article><span>小组抑制阈值</span><strong>N≥{summary.minimumGroupSize}</strong></article>
        </section>
        <section className="research-card">
          <div className="section-head">
            <div><h2>分组形成性汇总</h2><p>少于 {summary.minimumGroupSize} 人的小组不显示，降低重新识别风险。</p></div>
            <button type="button" onClick={downloadCsv} disabled={loading}>导出匿名 CSV</button>
          </div>
          {summary.groups.length === 0 ? <div className="empty-state">
            <h3>尚无可展示分组</h3>
            <p>真实提交达到阈值后才显示；这里不会填充虚构统计。</p>
          </div> : <div className="group-grid">{summary.groups.map((group) =>
            <article key={group.role}>
              <h3>{group.role === "teacher" ? "教师评估者" : "专家评估者"}</h3>
              <dl>
                <div><dt>参与 / 完成</dt><dd>{group.participants} / {group.completed}</dd></div>
                <div><dt>平均决策用时</dt><dd>{group.avg_time_ms == null ? "—" : Math.round(group.avg_time_ms / 1000) + " 秒"}</dd></div>
                <div><dt>校准信任</dt><dd>{score(group.avg_trust)}</dd></div>
                <div><dt>情境适切</dt><dd>{score(group.avg_appropriateness)}</dd></div>
                <div><dt>可用性</dt><dd>{score(group.avg_usability)}</dd></div>
                <div><dt>安全边界</dt><dd>{score(group.avg_safety)}</dd></div>
                <div><dt>SUS 可用性</dt><dd>{metric(group.avg_sus, " / 100")}</dd></div>
                <div><dt>工作负荷</dt><dd>{metric(group.avg_workload, " / 100")}</dd></div>
              </dl>
            </article>)}</div>}
          {summary.suppressedGroups.length > 0 && <p className="privacy-note">
            已隐藏小样本分组：{summary.suppressedGroups.map((role) => role === "teacher" ? "教师" : "专家").join("、")}。
          </p>}
        </section>
        <footer className="version-note">案例包：{summary.versions.scenarioPack} · 冻结输出：{summary.versions.output} · 提示版本：{summary.versions.prompt}</footer>
      </>}
    </main>
  );
}

function score(value: number | null) {
  return value == null ? "—" : Number(value).toFixed(1) + " / 5";
}

function metric(value: number | null, suffix: string) {
  return value == null ? "—" : Number(value).toFixed(1) + suffix;
}
