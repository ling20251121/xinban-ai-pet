import type { Metadata } from "next";
import LoginPanel from "./LoginPanel";
import "./login.css";
import { redirect } from "next/navigation";
import { getRuntimeEnv } from "@/db";
import { isAdultEvaluationOnly } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "登录｜心伴 AI-Pet",
  description: "使用学校发放的心伴 AI-Pet 账号登录。",
};

export default function LoginPage() {
  if (isAdultEvaluationOnly(getRuntimeEnv())) redirect("/evaluate");
  return <LoginPanel />;
}
