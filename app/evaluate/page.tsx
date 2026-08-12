import type { Metadata } from "next";
import EvaluationApp from "./EvaluationApp";
import "./evaluate.css";

export const metadata: Metadata = {
  title: "成人情境评估｜心伴 AI-Pet",
  description: "教师与专家使用固定合成学生情境评估心伴研究原型。",
};

export default function EvaluatePage() {
  return <EvaluationApp />;
}
