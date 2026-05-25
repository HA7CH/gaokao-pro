"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Status = "live" | "building" | "none";

type Row = {
  name: string;
  reform: "3+3" | "3+1+2" | "old";
  plan: Status;
  scores: Status;
  rank: Status;
  actual: Status;
};

const PROVINCES: Row[] = [
  { name: "北京", reform: "3+3", plan: "live", scores: "live", rank: "live", actual: "live" },
  { name: "天津", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "上海", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "重庆", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "河北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "山西", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "内蒙古", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "辽宁", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "吉林", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "黑龙江", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "江苏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "浙江", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "安徽", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "福建", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "江西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "山东", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "河南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "湖北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "湖南", reform: "3+1+2", plan: "live", scores: "live", rank: "live", actual: "live" },
  { name: "广东", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "广西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "海南", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "四川", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "贵州", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "云南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "西藏", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "陕西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "甘肃", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "青海", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "宁夏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "新疆", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
];

const PROMPT = `跑 \`npx gaokao-pro@latest help\` 把命令摸清楚，然后帮我规划 2026 年的高考志愿。

先问我：分数（估分 / 模考分 / 高考分都行，标清楚是哪种）、省份、选科组合、目标专业方向或职业兴趣、偏好（目标城市 / 是否限定 985/211 / 学费预算）。如果给的是估分或模考分，参考 2023-2025 历年一分一段做粗估位次；等高考真实分数出来再用 2026 当年一分一段精算。

每条推荐都用 CLI 拉真实数据支撑——查历年最低分、跨校搜专业、把分数换算成位次区间。`;

function StatusIcon({ kind }: { kind: Status }) {
  if (kind === "live") {
    return (
      <svg viewBox="0 0 24 24" className="size-[1.125rem]" aria-hidden focusable="false">
        <path
          fill="currentColor"
          d="m10.6 13.8l-2.15-2.15q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7L9.9 15.9q.3.3.7.3t.7-.3l5.65-5.65q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
        />
      </svg>
    );
  }
  if (kind === "building") {
    return (
      <span className="text-base leading-none inline-block saturate-[0.85]" role="img" aria-label="Building">
        🚧
      </span>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-[1.125rem]" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="m12 13.4l2.9 2.9q.275.275.7.275t.7-.275t.275-.7t-.275-.7L13.4 12l2.9-2.9q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275L12 10.6L9.1 7.7q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7l2.9 2.9l-2.9 2.9q-.275.275-.275.7t.275.7t.7.275t.7-.275zm0 8.6q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
      />
    </svg>
  );
}

function statusColor(kind: Status): string {
  if (kind === "live") return "text-success";
  if (kind === "building") return "text-warning";
  return "text-muted-foreground";
}

export default function Home() {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore older browsers
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 md:py-24">
      <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[1.1]">
        用 Claude Code 规划你的高考
      </h1>
      <p className="mt-6 font-mono text-base md:text-lg text-muted-foreground">
        <span className="text-ring mr-2 select-none">$</span>
        npx gaokao-pro help
      </p>

      {/* Prompt card */}
      <section className="mt-10 border border-border rounded-[var(--radius-md)] bg-muted overflow-hidden" aria-labelledby="prompt-title">
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-background border-b border-border">
          <span id="prompt-title" className="font-mono text-[0.6875rem] tracking-wider uppercase text-muted-foreground">
            粘贴进 Claude Code / Codex / Cursor
          </span>
          <button
            type="button"
            className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={copyPrompt}
            aria-label={copied ? "Copied" : "Copy prompt"}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <pre className="px-5 py-4 font-mono text-[0.8125rem] leading-relaxed whitespace-pre overflow-x-auto text-foreground">
          {PROMPT}
        </pre>
      </section>

      {/* Companion links */}
      <p className="mt-3.5 font-mono text-xs text-muted-foreground">
        搭配{" "}
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
          cv.ha7ch.com
        </a>{" "}
        写简历，毕业后用{" "}
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
          job.ha7ch.com
        </a>{" "}
        找工作。
      </p>

      {/* Province table */}
      <section className="mt-12 group/table" aria-labelledby="provinces-title">
        <h2 id="provinces-title" className="sr-only">Province coverage</h2>

        {/* Header */}
        <div className="grid grid-cols-[1.2fr_repeat(4,1fr)] sm:grid-cols-[1fr_6rem_6rem_6rem_6rem] gap-1 sm:gap-3 px-1 pb-2 items-center" aria-hidden>
          <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-wider uppercase text-ring">省份</span>
          <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-wider uppercase text-ring text-center">招生计划</span>
          <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-wider uppercase text-ring text-center">历年分数</span>
          <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-wider uppercase text-ring text-center">一分一段</span>
          <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-wider uppercase text-ring text-center">实际录取</span>
        </div>

        {/* Rows */}
        {PROVINCES.map((p) => (
          <div
            key={p.name}
            className="grid grid-cols-[1.2fr_repeat(4,1fr)] sm:grid-cols-[1fr_6rem_6rem_6rem_6rem] gap-1 sm:gap-3 px-1 py-1.5 sm:py-2 items-center transition-opacity duration-150 group-hover/table:[&:not(:hover)]:opacity-35 hover:opacity-100"
          >
            <span className="text-sm sm:text-[0.9375rem] font-medium tracking-tight text-foreground transition-transform duration-150 hover:translate-x-0.5 whitespace-nowrap">
              {p.name}
              <span className="ml-1 sm:ml-2 text-[0.625rem] sm:text-[0.6875rem] font-normal text-muted-foreground">{p.reform}</span>
            </span>
            <span className={`flex items-center justify-center ${statusColor(p.plan)}`}>
              <StatusIcon kind={p.plan} />
            </span>
            <span className={`flex items-center justify-center ${statusColor(p.scores)}`}>
              <StatusIcon kind={p.scores} />
            </span>
            <span className={`flex items-center justify-center ${statusColor(p.rank)}`}>
              <StatusIcon kind={p.rank} />
            </span>
            <span className={`flex items-center justify-center ${statusColor(p.actual)}`}>
              <StatusIcon kind={p.actual} />
            </span>
          </div>
        ))}
      </section>

      {/* Footer links */}
      <div className="mt-12 font-mono text-[0.8125rem] text-muted-foreground flex flex-wrap items-center gap-1">
        <a
          href="https://github.com/HA7CH/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="inline-flex items-center p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/package/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="npm"
          className="inline-flex items-center p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
            <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C23.99.786 23.204 0 22.227 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z" />
          </svg>
        </a>
        <span aria-hidden className="text-ring"> · </span>
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer" className="relative text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-border hover:after:bg-muted-foreground after:transition-colors">
          cv.ha7ch.com
        </a>
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer" className="relative text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-border hover:after:bg-muted-foreground after:transition-colors">
          job.ha7ch.com
        </a>
        <a href="https://ha7ch.com" target="_blank" rel="noopener noreferrer" className="relative ml-auto text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-border hover:after:bg-muted-foreground after:transition-colors">
          ha7ch.com
        </a>
      </div>
    </main>
  );
}
