import type { Metadata } from "next";
import StudentCompanion from "./StudentCompanion";
import { redirect } from "next/navigation";
import { getRuntimeEnv } from "@/db";
import { schoolSurfacesEnabled } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "今天的心情｜心伴 AI-Pet",
  description: "18+ 成人扮演虚构学生，体验合成心情记录、语音与 Qwen 对话的演示沙盒。",
};

export default function Home() {
  if (!schoolSurfacesEnabled(getRuntimeEnv())) redirect("/evaluate");
  return <StudentCompanion />;
}
