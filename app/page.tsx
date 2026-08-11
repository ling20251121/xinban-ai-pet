import type { Metadata } from "next";
import StudentCompanion from "./StudentCompanion";

export const metadata: Metadata = {
  title: "今天的心情｜心伴 AI-Pet",
  description: "面向中小学生的轻量心情记录与真人支持研究原型。",
};

export default function Home() {
  return <StudentCompanion />;
}
