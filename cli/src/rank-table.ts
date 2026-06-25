// Loader for cli/data/yifenyiduan/{province}-{year}-{track}.json files.
// One file per (province, year, track) — see beijing-2024-combined.json as the canonical shape.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVINCES, type ProvinceId } from "./codes.js";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = dirname(__filename);

const CANDIDATE_DIRS = [
  resolve(SRC_DIR, "..", "data", "yifenyiduan"),         // cli/src/  → cli/data/yifenyiduan
  resolve(SRC_DIR, "..", "..", "data", "yifenyiduan")    // cli/dist/ → cli/data/yifenyiduan
];

function findDataDir(): string | null {
  for (const d of CANDIDATE_DIRS) {
    if (existsSync(d)) return d;
  }
  return null;
}

export type RankTableRow = { score: number; count: number; cumulative: number };

export type RankTable = {
  province: string;          // pinyin id e.g. "beijing"
  province_name: string;
  year: number;
  /** "physics" | "history" for 3+1+2 provinces; "combined" for 3+3; "science" | "liberal" for 老高考. */
  track: string;
  source: string;
  note?: string;
  count: number;
  rows: RankTableRow[];      // sorted by score descending
};

function pinyinFor(provinceId: ProvinceId): string {
  return PROVINCES[provinceId].pinyin;
}

/** Load a single rank table. Returns null if not present locally. */
export function loadRankTable(
  provinceId: ProvinceId,
  year: number,
  track: string
): RankTable | null {
  const dir = findDataDir();
  if (!dir) return null;
  const path = resolve(dir, `${pinyinFor(provinceId)}-${year}-${track}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RankTable;
}

/** List all (province, year, track) tuples we have data for. */
export function listRankTables(): Array<{ province: string; year: number; track: string }> {
  const dir = findDataDir();
  if (!dir) return [];
  const out: Array<{ province: string; year: number; track: string }> = [];
  for (const f of readdirSync(dir)) {
    const m = f.match(/^([a-z]+)-(\d{4})-([a-z]+)\.json$/);
    if (m) out.push({ province: m[1], year: Number(m[2]), track: m[3] });
  }
  return out.sort((a, b) => a.province.localeCompare(b.province) || b.year - a.year);
}

/** score → cumulative rank lookup (returns rank for highest score row whose score ≤ input). */
export function scoreToRank(table: RankTable, score: number): number | null {
  // rows are sorted descending by score; find first row whose score ≤ input.
  for (const row of table.rows) {
    if (row.score <= score) return row.cumulative;
  }
  return null;
}

/** rank → score lookup (lowest score whose cumulative ≥ input rank — i.e. the bar that gets you the rank). */
export function rankToScore(table: RankTable, rank: number): number | null {
  let best: number | null = null;
  for (const row of table.rows) {
    if (row.cumulative >= rank) {
      best = row.score;
      break;
    }
  }
  return best;
}

/**
 * Try to pick a sensible default rank-table track key when caller omits one.
 * Returns the file-name track key (see RankTable.track):
 *   3+3 → "combined", 3+1+2 → "physics", 老高考(含西藏) → "science".
 * NOTE: 西藏 additionally runs an A类/B类 民族 dual-track on top of 文/理;
 * we have no per-A/B 一分一段 data, so it collapses to the 老高考 "science"
 * table just like the other 文/理 provinces. See inferTrack() in recommend.ts.
 */
export function inferDefaultTrack(provinceId: ProvinceId): string {
  const reform = PROVINCES[provinceId].reform;
  if (reform === "3+3") return "combined";
  if (reform === "3+1+2") return "physics";
  return "science"; // old-reform 文/理 default to 理 (science) bucket
}

/**
 * Resolve the rank-table track key from a province + the student's subjects.
 * 3+3 → "combined"; 3+1+2 → "physics"/"history" by subject; 老高考 →
 * "science"/"liberal". Falls back to inferDefaultTrack when subjects are silent.
 */
export function resolveRankTrack(provinceId: ProvinceId, subjects: string[]): string {
  const reform = PROVINCES[provinceId].reform;
  if (reform === "3+3") return "combined";
  const has = (k: string) => subjects.some((s) => s.includes(k));
  if (reform === "3+1+2") return has("物理") ? "physics" : has("历史") ? "history" : inferDefaultTrack(provinceId);
  return has("物理") || has("理") ? "science" : has("历史") || has("文") ? "liberal" : inferDefaultTrack(provinceId);
}

/** Newest year for which we hold a rank table for (province, track), or null. */
export function newestRankTableYear(provinceId: ProvinceId, track: string): number | null {
  const pin = pinyinFor(provinceId);
  const years = listRankTables()
    .filter((t) => t.province === pin && t.track === track)
    .map((t) => t.year);
  return years.length ? Math.max(...years) : null;
}

/**
 * Derive an equivalent 分数 from a student-supplied 全省位次 (rank), using the
 * newest available 一分一段 table for (province, track inferred from subjects).
 * Lets a student who only knows their 位次 still run recommend/top. Returns null
 * when we have no table for that province or the rank is out of the table's range.
 */
export function deriveScoreFromRank(
  provinceId: ProvinceId,
  subjects: string[],
  rank: number
): { score: number; year: number; track: string } | null {
  const track = resolveRankTrack(provinceId, subjects);
  const year = newestRankTableYear(provinceId, track);
  if (year === null) return null;
  const table = loadRankTable(provinceId, year, track);
  if (!table) return null;
  const score = rankToScore(table, rank);
  if (score === null) return null;
  return { score, year, track };
}
