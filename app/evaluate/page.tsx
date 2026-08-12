import type { Metadata } from "next";
import EvaluationApp from "./EvaluationApp";
import "./evaluate.css";

export const metadata: Metadata = {
  title: "成人情境评估｜心伴 AI-Pet",
  description: "教师与专家使用固定合成学生情境评估心伴研究原型。",
};

export default function EvaluatePage() {
  return (
    <>
      <header className="eval-mode-bar">
        <div>
          <strong>心伴双模式演示</strong>
          <span>两条路径同时保留，学生情境均为合成内容。</span>
        </div>
        <nav aria-label="体验模式切换">
          <a href="/login">体验完整学生／教师界面</a>
          <span aria-current="page">教师／专家评估</span>
        </nav>
      </header>
      <EvaluationApp />
    </>
  );
}
