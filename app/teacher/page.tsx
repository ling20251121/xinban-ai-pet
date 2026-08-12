import type { Metadata } from "next";
import TeacherDashboard from "./TeacherDashboard";
import "./teacher.css";
import { redirect } from "next/navigation";
import { getRuntimeEnv } from "@/db";
import { isAdultEvaluationOnly } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "教师支持台｜心伴 AI-Pet",
  description: "以最少必要信息帮助教师及时看见学生的支持请求。",
};

export default function TeacherPage() {
  if (isAdultEvaluationOnly(getRuntimeEnv())) redirect("/evaluate");
  return <TeacherDashboard />;
}
