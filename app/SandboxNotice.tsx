type SandboxNoticeProps = {
  surface: "login" | "student" | "teacher";
};

const surfaceLabels: Record<SandboxNoticeProps["surface"], string> = {
  login: "角色入口",
  student: "虚构学生视角",
  teacher: "模拟教师工作台",
};

export default function SandboxNotice({ surface }: SandboxNoticeProps) {
  return (
    <aside className="sandbox-notice" aria-label="合成学校沙盒提醒">
      <span className="sandbox-notice__mark" aria-hidden="true">成人</span>
      <div className="sandbox-notice__copy">
        <strong>模拟演示 · 合成数据</strong>
        <span>{surfaceLabels[surface]} · 仅限 18 岁以上测试者；禁止输入真实学生、学校或联系方式。</span>
      </div>
      <nav className="sandbox-notice__actions" aria-label="体验模式切换">
        <a href="/login" aria-current={surface === "login" ? "page" : undefined}>
          {surface === "login" ? "完整界面体验" : "切换虚构角色"}
        </a>
        <a href="/evaluate">教师／专家评估</a>
        {surface === "teacher" && <span className="sandbox-notice__reset-hint">重置由部署管理员执行</span>}
      </nav>
    </aside>
  );
}
