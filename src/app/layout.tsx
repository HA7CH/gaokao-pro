import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
});
const notoSerifSC = Noto_Serif_SC({
  weight: ["400", "700"],
  variable: "--font-noto-serif-sc",
  preload: false,
});

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
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "gaokao.pro",
    description: "高考志愿规划 CLI · 终端里跑。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${geist.variable} ${geistMono.variable} ${playfair.variable} ${notoSerifSC.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
