// recommend — given (score, province, subjects), bucket schools into 冲 / 稳 / 保
// based on each school's most-recent matching-track minimum score in that province.
//
// Algorithm is intentionally transparent (no opaque model):
//   delta = userScore - schoolMinScore(latest matching year)
//   bucket =
//     delta >= +15 → '保'  (safety — well above last year's cutoff)
//     -5 <= delta < +15 → '稳'  (stable match)
//     -25 <= delta < -5 → '冲'  (reach)
//     delta < -25 → out of range
//
// Reach/match/safety thresholds are heuristics — adjustable. The raw `delta`
// is surfaced so callers can override.
//
// Data source: docs/school-index.json (built by `probe`). All evaluation is
// local — no network calls — so 2700+ schools score in milliseconds.
import { PROVINCES, TRACK_NAMES, type ProvinceId, type Subject } from "./codes.js";
import { loadIndex, filterIndex, type SchoolRow, type IndexFilter } from "./index-loader.js";

// Provinces where 2024 or 2025 was the FIRST year under 新高考 — historical
// score-based ranking will be unreliable until the reform settles.
// Source: 100-agent scan (河南/四川/陕西/山西/云南/甘肃 + 安徽/江西/广西/贵州 2024).
const NEW_REFORM_FIRST_YEAR: Partial<Record<ProvinceId, number>> = {
  34: 2024, // 安徽
  36: 2024, // 江西
  45: 2024, // 广西
  52: 2024, // 贵州
  41: 2025, // 河南
  51: 2025, // 四川
  61: 2025, // 陕西
  14: 2025, // 山西
  53: 2025, // 云南
  62: 2025, // 甘肃
  63: 2025, // 青海
  64: 2025, // 宁夏
  65: 2025  // 新疆
};

export type Bucket = "保" | "稳" | "冲" | "out";

export type RecommendInput = {
  score: number;
  provinceId: ProvinceId;
  subjects: Subject[];
  rank?: number;
  schoolIds?: Array<number | string>;  // optional: restrict to these schools
  filter?: IndexFilter;                // optional: filter via labels (985/211/etc.)
  limit?: number;                      // optional: cap per bucket
};

export type RecommendCandidate = {
  schoolId: number;
  zsCode: string;
  name: string;
  province: string;
  city: string;
  belong: string;
  is985: boolean;
  is211: boolean;
  dualClass: string;
  baselineYear: number;
  baselineMinScore: number;
  baselineTrack: string;
  baselineTrackName: string;
  delta: number;
  bucket: Bucket;
};

export type RecommendOutput = {
  query: {
    score: number;
    province: { id: ProvinceId; name: string; reform: string };
    subjects: Subject[];
    track: string;
    trackName: string;
    rank?: number;
    reform_warning?: string;
  };
  evaluated: number;
  buckets: {
    "保": RecommendCandidate[];
    "稳": RecommendCandidate[];
    "冲": RecommendCandidate[];
    out: RecommendCandidate[];
    skipped: number;
  };
};

export function inferTrack(provinceId: ProvinceId, subjects: Subject[]): string {
  const reform = PROVINCES[provinceId].reform;
  if (reform === "3+3") return "3";
  if (reform === "3+1+2") {
    if (subjects.includes("物理")) return "2073";
    if (subjects.includes("历史")) return "2074";
    throw new Error("3+1+2 provinces require either 物理 or 历史 in --subjects");
  }
  const sciCount = subjects.filter((s) => ["物理", "化学", "生物"].includes(s)).length;
  const libCount = subjects.filter((s) => ["历史", "政治", "地理"].includes(s)).length;
  return sciCount >= libCount ? "1" : "2";
}

function bucketOf(delta: number): Bucket {
  if (delta >= 15) return "保";
  if (delta >= -5) return "稳";
  if (delta >= -25) return "冲";
  return "out";
}

function evaluateRow(
  row: SchoolRow,
  provinceId: ProvinceId,
  track: string,
  userScore: number
): RecommendCandidate | null {
  const entries = row.pro_type_min?.[String(provinceId)] ?? [];
  if (entries.length === 0) return null;
  // Find the most recent year with a score for the target track.
  // Years are not guaranteed sorted, so sort descending here.
  const sortedYears = [...entries].sort((a, b) => b.year - a.year);
  for (const entry of sortedYears) {
    const score = entry.type?.[track];
    if (!score) continue;
    const min = Number(score);
    if (!Number.isFinite(min) || min <= 0) continue;
    const delta = userScore - min;
    return {
      schoolId: row.gaokao_cn_id,
      zsCode: row.zs_code,
      name: row.name,
      province: row.province,
      city: row.city,
      belong: row.belong,
      is985: row.f985,
      is211: row.f211,
      dualClass: row.dual_class,
      baselineYear: entry.year,
      baselineMinScore: min,
      baselineTrack: track,
      baselineTrackName: TRACK_NAMES[track] ?? track,
      delta,
      bucket: bucketOf(delta)
    };
  }
  return null;
}

export function recommend(input: RecommendInput): RecommendOutput {
  const index = loadIndex();
  let rows: SchoolRow[] = index.rows;

  if (input.schoolIds && input.schoolIds.length > 0) {
    const wanted = new Set(input.schoolIds.map((s) => Number(s)));
    rows = rows.filter((r) => wanted.has(r.gaokao_cn_id));
  }
  if (input.filter) {
    rows = filterIndex({ generated_at: index.generated_at, rows }, input.filter);
  }

  const track = inferTrack(input.provinceId, input.subjects);
  const province = PROVINCES[input.provinceId];

  const buckets: Record<Bucket, RecommendCandidate[]> = { "保": [], "稳": [], "冲": [], out: [] };
  let skipped = 0;
  for (const row of rows) {
    const c = evaluateRow(row, input.provinceId, track, input.score);
    if (!c) {
      skipped++;
      continue;
    }
    buckets[c.bucket].push(c);
  }

  // Sort each bucket by absolute delta (closest to threshold first for 冲,
  // largest cushion first for 稳/保).
  buckets["冲"].sort((a, b) => b.delta - a.delta);   // least-reach first
  buckets["稳"].sort((a, b) => a.delta - b.delta);   // tightest match first (interesting)
  buckets["保"].sort((a, b) => a.delta - b.delta);   // tightest safety first
  buckets.out.sort((a, b) => b.delta - a.delta);

  if (input.limit && input.limit > 0) {
    buckets["冲"] = buckets["冲"].slice(0, input.limit);
    buckets["稳"] = buckets["稳"].slice(0, input.limit);
    buckets["保"] = buckets["保"].slice(0, input.limit);
    buckets.out = buckets.out.slice(0, input.limit);
  }

  const firstReformYear = NEW_REFORM_FIRST_YEAR[input.provinceId];
  const reform_warning = firstReformYear !== undefined
    ? `${province.name} 在 ${firstReformYear} 年首次进入新高考 (${province.reform})。历年位次跨改革前后不可直接对比；推荐结果按最近一年最低分粗估，请结合 2024/2025 真实录取数据校正。`
    : undefined;

  return {
    query: {
      score: input.score,
      province: { id: input.provinceId, name: province.name, reform: province.reform },
      subjects: input.subjects,
      track,
      trackName: TRACK_NAMES[track] ?? track,
      rank: input.rank,
      ...(reform_warning ? { reform_warning } : {})
    },
    evaluated: rows.length,
    buckets: { ...buckets, skipped }
  };
}
