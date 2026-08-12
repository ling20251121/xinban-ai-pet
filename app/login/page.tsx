import type { Metadata } from "next";
import LoginPanel from "./LoginPanel";
import "./login.css";

export const metadata: Metadata = {
  title: "登录｜心伴 AI-Pet",
  description: "使用学校发放的心伴 AI-Pet 账号登录。",
};

export default function LoginPage() {
  return <LoginPanel />;
}
