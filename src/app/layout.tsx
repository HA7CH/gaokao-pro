import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gaokao.pro — college planning from your terminal",
  description:
    "Chinese 高考 college planner. Input your score + province + subjects, get 冲/稳/保 recommendations from 2,400+ universities — offline, no signup. Open source, Claude-Code-native.",
  metadataBase: new URL("https://gaokao.ha7ch.com"),
  openGraph: {
    title: "gaokao.pro",
    description:
      "Chinese 高考 college planner from your terminal. Score in, schools out.",
    url: "https://gaokao.ha7ch.com",
    siteName: "gaokao.pro",
    type: "website"
  },
  twitter: { card: "summary", title: "gaokao.pro", description: "高考 college planner from your terminal." }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
