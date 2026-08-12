import type { Metadata } from "next";
import LoginPanel from "./LoginPanel";
import "./login.css";
import { redirect } from "next/navigation";
import { getRuntimeEnv } from "@/db";
import { schoolSurfacesEnabled } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "登录｜心伴 AI-Pet",
  description: "仅限 18+ 成人测试者使用部署方发放的虚构角色凭据进入合成沙盒。",
};

export default function LoginPage() {
  if (!schoolSurfacesEnabled(getRuntimeEnv())) redirect("/evaluate");
  return <LoginPanel />;
}
