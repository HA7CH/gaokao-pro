import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gaokao.pro · 用 Claude Code 规划你的高考",
  description:
    "中国高考志愿规划 CLI。输入分数 + 省份 + 选科，从 3000+ 所院校里给出冲 / 稳 / 保推荐。本地离线、无需注册、开源，Claude Code / Codex / Cursor 原生支持。",
  metadataBase: new URL("https://gaokao.ha7ch.com"),
  openGraph: {
    title: "gaokao.pro",
    description: "用 Claude Code 规划你的高考。分数进，学校出。",
    url: "https://gaokao.ha7ch.com",
    siteName: "gaokao.pro",
    type: "website"
  },
  twitter: { card: "summary", title: "gaokao.pro", description: "高考志愿规划 CLI · 终端里跑。" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
