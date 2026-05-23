"use client";

import { useState } from "react";

type Status = "live" | "building" | "none";

type Row = {
  name: string;
  reform: "3+3" | "3+1+2" | "old";
  plan: Status;       // 招生计划 (gaokao-pro plan)
  scores: Status;     // 历年最低分 (gaokao-pro scores)
  rank: Status;       // 一分一段 (gaokao-pro rank)
  actual: Status;     // 实际录取+位次 (gaokao-pro actual)
};

// gaokao-pro coverage per province. plan + scores + actual are all live via
// gaokao.cn upstream for every province. The differentiator is `rank` — only
// Beijing currently has ingested 一分一段 data.
const PROVINCES: Row[] = [
  { name: "北京", reform: "3+3",   plan: "live", scores: "live", rank: "live", actual: "live" },
  { name: "天津", reform: "3+3",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "上海", reform: "3+3",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "重庆", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "河北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "山西", reform: "old",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "内蒙古", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "辽宁", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "吉林", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "黑龙江", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "江苏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "浙江", reform: "3+3",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "安徽", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "福建", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "江西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "山东", reform: "3+3",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "河南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "湖北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "湖南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "广东", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "广西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "海南", reform: "3+3",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "四川", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "贵州", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "云南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "西藏", reform: "old",   plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "陕西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "甘肃", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "青海", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "宁夏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" },
  { name: "新疆", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live" }
];

const PROMPT = `Run \`npx gaokao-pro@latest help\` to discover the CLI, then help me plan
my (or my child's) college applications for the 2026 高考.

Ask me for my score, 全省位次 if I know it, province, 选科 combination,
intended majors or career interests, and any preferences (target cities,
985/211 priority, budget). Use the CLI to ground every recommendation
in real admissions data — pull historical scores, search for matching
majors across schools, and translate score → 位次 when 一分一段 data
exists for my province. Always reply to me in Chinese.`;

function StatusDot({ kind }: { kind: Status }) {
  if (kind === "live") return <span className="status-cell live" aria-label="ready">●</span>;
  if (kind === "building") return <span className="status-cell building" aria-label="building">◐</span>;
  return <span className="status-cell none" aria-label="not yet">○</span>;
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
    <main className="page">
      <h1>
        Plan your gaokao w/{" "}
        <span className="accent">your Claude Code</span>
      </h1>
      <p className="lede">
        <span className="lede-prefix">$</span> npx gaokao-pro help
      </p>

      <section className="prompt-card" aria-labelledby="prompt-title">
        <div className="prompt-head">
          <span id="prompt-title" className="prompt-head-label">
            Copy into Claude Code, Codex, or Cursor
          </span>
          <button
            type="button"
            className="prompt-copy"
            onClick={copyPrompt}
            aria-label={copied ? "Copied" : "Copy prompt"}
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        </div>
        <pre className="prompt-body">{PROMPT}</pre>
      </section>

      <p className="install">
        <span className="install-label">install</span>
        curl -fsSL https://raw.githubusercontent.com/HA7CH/gaokao-pro/main/install.sh | bash
      </p>

      <p className="companion">
        Pairs with{" "}
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
          cv.ha7ch.com
        </a>{" "}
        for a tailored 简历 and{" "}
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer">
          job.ha7ch.com
        </a>{" "}
        once you graduate.
      </p>

      <section className="province-table" aria-labelledby="provinces-title">
        <h2 id="provinces-title" className="sr-only">
          Province coverage
        </h2>
        <div className="province-row header" aria-hidden>
          <span>Province</span>
          <span className="status-cell">招生计划</span>
          <span className="status-cell">历年分数</span>
          <span className="status-cell">一分一段</span>
          <span className="status-cell">实际录取</span>
        </div>
        {PROVINCES.map((p) => (
          <div key={p.name} className="province-row">
            <span className="province-name">
              {p.name}
              <span className="reform">{p.reform}</span>
            </span>
            <StatusDot kind={p.plan} />
            <StatusDot kind={p.scores} />
            <StatusDot kind={p.rank} />
            <StatusDot kind={p.actual} />
          </div>
        ))}
      </section>

      <p className="link-row">
        <a
          href="https://github.com/HA7CH/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/package/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="npm"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C23.99.786 23.204 0 22.227 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z" />
          </svg>
        </a>
        <span aria-hidden style={{ color: "var(--fg-dim)" }}>·</span>
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
          cv.ha7ch.com
        </a>
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer">
          job.ha7ch.com
        </a>
        <a
          href="https://ha7ch.com"
          target="_blank"
          rel="noopener noreferrer"
          className="link-right"
        >
          ha7ch.com
        </a>
      </p>
    </main>
  );
}
