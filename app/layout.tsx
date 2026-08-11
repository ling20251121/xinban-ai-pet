import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`);
  const title = "心伴 AI-Pet";
  const description = "面向中国中小学生的日常心情记录、AI 低压力回应与教师人工支持研究原型。";

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
      images: [{ url: new URL("/og.png", origin), width: 1672, height: 941, alt: "心伴 AI-Pet：今天的心情，值得被轻轻接住。" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [new URL("/og.png", origin)],
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
