import type { Metadata } from "next";
import TeacherDashboard from "./TeacherDashboard";
import "./teacher.css";
import { redirect } from "next/navigation";
import { getRuntimeEnv } from "@/db";
import { schoolSurfacesEnabled } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "教师支持台｜心伴 AI-Pet",
  description: "18+ 成人扮演虚构教师，查看合成班级汇总并测试 CCCR 模拟处置流程。",
};

export default function TeacherPage() {
  if (!schoolSurfacesEnabled(getRuntimeEnv())) redirect("/evaluate");
  return <TeacherDashboard />;
}
