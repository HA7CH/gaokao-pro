// 广东省教育考试院 (eea.gd.gov.cn) — 一分一段表 fallback adapter.
//
// Status: STUB. The data lives in ZIP-bundled PDFs (e.g.
// https://eea.gd.gov.cn/attachment/0/583/583759/4734345.zip for 2025),
// which need OCR/manual extraction before they become queryable JSON.
//
// This file is the contract. When extracted JSON data lands at
// `cli/data/yifenyiduan/guangdong-{year}-{track}.json`, the `fetchRankTable`
// stub below will read and return it instead of throwing.
//
// Why this exists pre-data: it documents the shape and lets `rank` /
// `--rank` consumers code against the interface without waiting for the
// data ingest.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = dirname(__filename);

export type RankTable = {
  province: "guangdong";
  year: number;
  track: "物理类" | "历史类";
  // 分数 → 累计人数 (该分数及以上). Ascending by score? Descending? The schema
  // is "ascending rank, descending score" — i.e. row[0] is the highest score
  // and lowest rank.
  rows: Array<{ score: number; cumulative: number }>;
};

export const GUANGDONG_SOURCE = {
  province: "广东",
  bureau: "广东省教育考试院",
  url: "https://eea.gd.gov.cn/ptgk/",
  // 2025 release index:
  attachments: {
    2025: "https://eea.gd.gov.cn/attachment/0/583/583759/4734345.zip"
  },
  notes: [
    "Zip contains 16 PDFs: 1=历史类总表, 2=物理类总表, 3-16=各类艺术/体育子类",
    "PDF tables are landscape, multi-column, page-paginated — need OCR or tabula",
    "Refresh cadence: published once per year, ~June 25 after gaokao results"
  ]
} as const;

function dataPathFor(year: number, track: "物理类" | "历史类"): string {
  const trackKey = track === "物理类" ? "wuli" : "lishi";
  return resolve(SRC_DIR, "..", "..", "data", "yifenyiduan", `guangdong-${year}-${trackKey}.json`);
}

/**
 * Return the 一分一段 table for 广东 / year / track if extracted JSON exists locally.
 * Throws with the official source URL if not — never auto-downloads PDFs.
 */
export function fetchRankTable(year: number, track: "物理类" | "历史类"): RankTable {
  const path = dataPathFor(year, track);
  if (!existsSync(path)) {
    throw new Error(
      `广东 ${year} ${track} 一分一段表尚未导入 (looked at ${path}).\n` +
        `下载源: ${GUANGDONG_SOURCE.attachments[year as 2025] ?? GUANGDONG_SOURCE.url}\n` +
        `导入步骤详见 docs/data-sources.md → 一分一段表 ingest pipeline.`
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as RankTable;
}

/** score → rank lookup (returns cumulative rank for highest score ≤ input). */
export function scoreToRank(table: RankTable, score: number): number | null {
  for (const row of table.rows) {
    if (row.score <= score) return row.cumulative;
  }
  return null;
}

/** rank → score lookup (returns lowest score whose cumulative ≥ input rank). */
export function rankToScore(table: RankTable, rank: number): number | null {
  let best: number | null = null;
  for (const row of table.rows) {
    if (row.cumulative >= rank) best = row.score;
    else break;
  }
  return best;
}
