import type { Metadata } from "next";
import TeacherDashboard from "./TeacherDashboard";
import "./teacher.css";

export const metadata: Metadata = {
  title: "教师支持台｜心伴 AI-Pet",
  description: "以最少必要信息帮助教师及时看见学生的支持请求。",
};

export default function TeacherPage() {
  return <TeacherDashboard />;
}
