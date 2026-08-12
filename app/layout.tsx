import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`);
  const title = "心伴 AI-Pet";
  const description = "仅限 18 岁以上测试者的合成学校沙盒：扮演虚构学生与教师，评估心情记录、AI 对话和模拟处置流程。";

  return {
    metadataBase: origin,
    title: { default: title, template: `%s｜${title}` },
    description,
    icons: { icon: "/dog.svg", shortcut: "/dog.svg" },
    openGraph: {
      type: "website",
      url: origin,
      title,
      description,
      locale: "zh_CN",
      images: [{ url: new URL("/og-v5.png", origin), width: 1672, height: 941, alt: "心伴 AI-Pet：把今天的心情，慢慢说清楚。" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [new URL("/og-v5.png", origin)],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7568df",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
