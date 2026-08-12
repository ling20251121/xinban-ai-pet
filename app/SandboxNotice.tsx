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
      {surface === "teacher" ? (
        <span className="sandbox-notice__reset-hint">重置由部署管理员执行</span>
      ) : (
        <a href="/login">切换虚构角色</a>
      )}
    </aside>
  );
}
