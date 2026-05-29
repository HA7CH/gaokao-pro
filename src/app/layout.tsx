import type { Metadata, Viewport } from "next";
import { Noto_Serif_SC, Noto_Sans_SC, ZCOOL_XiaoWei } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const serif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cjk-serif",
  display: "swap",
  preload: false
});
const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cjk-sans",
  display: "swap",
  preload: false
});
const brush = ZCOOL_XiaoWei({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-cjk-brush",
  display: "swap",
  preload: false
});

export const metadata: Metadata = {
  title: {
    default: "高考PRO · AI 高考志愿规划 · 用 Claude Code 出冲稳保",
    template: "%s · 高考PRO"
  },
  description:
    "高考PRO 是开源免费的 AI 高考志愿规划工具。输入分数 + 省份 + 选科，从 3000+ 所院校里给出冲 / 稳 / 保推荐。覆盖 31 省 985 / 211 / 双一流、历年最低分、一分一段、强基 / 综评 / 中外合作 / 地方专项 / 就业报告。本地离线、无需注册，Claude Code / Codex / Cursor 原生支持。",
  metadataBase: new URL("https://gaokao.ha7ch.com"),
  alternates: { canonical: "https://gaokao.ha7ch.com/" },
  keywords: [
    "高考PRO", "gaokao-pro", "高考志愿", "高考填报志愿", "高考志愿规划",
    "AI 高考", "AI 填报志愿", "冲稳保", "高考分数", "高考位次",
    "985", "211", "双一流", "一分一段", "新高考", "3+1+2", "3+3",
    "强基计划", "综合评价", "中外合作办学", "国家专项", "高校专项", "地方专项",
    "院校专业组", "招生计划", "就业报告", "毕业生就业质量报告",
    "Claude Code 高考", "Cursor 高考", "Codex 高考", "高考 CLI", "高考 MCP",
    "中国教育在线", "掌上高考", "open source gaokao"
  ],
  authors: [{ name: "lawted", url: "https://www.xiaohongshu.com/user/profile/5d4113b2000000001202e2ee" }],
  creator: "lawted · HA7CH",
  publisher: "HA7CH",
  category: "education",
  applicationName: "高考PRO",
  formatDetection: { telephone: false, email: false, address: false },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 }
  },
  openGraph: {
    title: "高考PRO · AI 高考志愿规划",
    description: "用 Claude Code 规划你的高考。分数 + 省份 + 选科 → 3000+ 院校冲稳保。开源免费，覆盖 31 省 985/211/双一流。",
    url: "https://gaokao.ha7ch.com/",
    siteName: "高考PRO",
    locale: "zh_CN",
    type: "website",
    // No dedicated OG raster asset exists yet; reuse the brand icon as a stopgap
    // so social cards render an image instead of a blank preview.
    images: [
      {
        url: "/icon.svg",
        width: 64,
        height: 64,
        alt: "高考PRO",
        type: "image/svg+xml"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "高考PRO · AI 高考志愿规划",
    description: "分数 + 省份 + 选科 → 3000+ 院校冲稳保。开源免费，Claude Code / Codex / Cursor 原生支持。",
    creator: "@lawted",
    images: ["/icon.svg"]
  }
  // NOTE: favicon is provided by the App Router file convention (src/app/icon.svg),
  // which auto-emits the <link rel="icon"> tag. We intentionally omit a manual
  // metadata.icons entry to avoid a duplicate/conflicting /icon.svg reference.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the brand maroon used by the icon background (#8b1538).
  themeColor: "#8b1538"
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://gaokao.ha7ch.com/#website",
      url: "https://gaokao.ha7ch.com/",
      name: "高考PRO",
      alternateName: ["gaokao-pro", "gaokao.pro"],
      description: "AI 高考志愿规划工具。分数 + 省份 + 选科 → 3000+ 院校冲稳保。",
      inLanguage: "zh-CN",
      publisher: { "@id": "https://gaokao.ha7ch.com/#org" }
    },
    {
      "@type": "Organization",
      "@id": "https://gaokao.ha7ch.com/#org",
      name: "HA7CH",
      url: "https://ha7ch.com",
      logo: "https://gaokao.ha7ch.com/icon.svg",
      sameAs: ["https://github.com/HA7CH", "https://www.xiaohongshu.com/user/profile/5d4113b2000000001202e2ee"]
    },
    {
      "@type": "SoftwareApplication",
      name: "高考PRO",
      operatingSystem: "macOS, Linux, Windows",
      applicationCategory: "EducationalApplication",
      applicationSubCategory: "高考志愿规划",
      url: "https://gaokao.ha7ch.com/",
      downloadUrl: "https://www.npmjs.com/package/gaokao-pro",
      // Should track cli/package.json version (source of truth).
      softwareVersion: "0.3.4",
      offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
      author: { "@id": "https://gaokao.ha7ch.com/#org" },
      inLanguage: "zh-CN",
      description: "开源免费的 AI 高考志愿规划工具。覆盖 31 省 3000+ 院校、985 / 211 / 双一流、历年最低分、一分一段、强基/综评/中外合作/专项/就业报告。Claude Code / Codex / Cursor 原生支持。",
      keywords: "高考志愿规划, AI 高考, 冲稳保, 一分一段, 985 211 双一流"
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "高考PRO 是什么？",
          acceptedAnswer: { "@type": "Answer", text: "高考PRO 是开源免费的 AI 高考志愿规划工具：输入分数 + 省份 + 选科，给出 3000+ 院校的冲 / 稳 / 保推荐。本地离线、无需注册，跑在 Claude Code / Codex / Cursor 这类 AI 编辑器里。" }
        },
        {
          "@type": "Question",
          name: "数据从哪来？",
          acceptedAnswer: { "@type": "Answer", text: "数据来自中国教育在线 / 掌上高考的公开 JSON 接口 static-data.gaokao.cn（招生计划、历年最低分、实际录取），以及各省考试院 / 高校信息公开网公开的一分一段表、就业质量报告。无需 token、不抓登录态、不调用付费 API。" }
        },
        {
          "@type": "Question",
          name: "覆盖哪些省份？",
          acceptedAnswer: { "@type": "Answer", text: "31 省全部覆盖招生计划 / 历年分数 / 实际录取。一分一段已落地北京、河南文理、湖南历史；其余省份正在 OCR 上线中。" }
        },
        {
          "@type": "Question",
          name: "不会写代码、不会命令行能用吗？",
          acceptedAnswer: { "@type": "Answer", text: "可以——把首页那段 prompt 粘进 Claude Code / Codex / Cursor 即可，AI 会替你跑命令、问你分数和省份、给出推荐。如果家里没人用过这类 AI 工具，请找一位用过的人陪你跑一次。" }
        }
      ]
    }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${serif.variable} ${sans.variable} ${brush.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
