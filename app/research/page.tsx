import type { Metadata } from "next";
import ResearchDashboard from "./ResearchDashboard";
import "./research.css";

export const metadata: Metadata = { title: "研究者汇总｜心伴 AI-Pet" };

export default function ResearchPage() {
  return <ResearchDashboard />;
}
