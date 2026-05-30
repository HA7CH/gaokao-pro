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
import { PROVINCES, TRACK_NAMES, validateScore, type ProvinceId, type Subject } from "./codes.js";
import { loadIndex, filterIndex, type SchoolRow, type IndexFilter } from "./index-loader.js";

// ---------------------------------------------------------------------------
// 冲/稳/保 + reachability thresholds (finding #14)
// ---------------------------------------------------------------------------
// Single source of truth for the delta cut-points, shared with top.ts and
// recommend-major.ts so "reachable" means the same thing everywhere. delta =
// userScore - school's last-year min for the matching track.
//   delta >= SAFETY_DELTA            → 保 (safety, comfortably above cutoff)
//   MATCH_DELTA <= delta < SAFETY    → 稳 (stable match)
//   REACH_DELTA <= delta < MATCH     → 冲 (reach)
//   delta < REACH_DELTA              → out of range (not reachable)
// "reachable" is therefore exactly `delta >= REACH_DELTA`. recommend-major.ts
// previously used a stricter -15 for its per-major "reachable" flag and a
// looser -40 pre-filter; we unify on REACH_DELTA so a school that shows up in
// 冲 here is also "reachable" there. The looser pre-filter is kept as a
// separate, intentionally-permissive PREFILTER_DELTA (we widen the candidate
// net before the expensive per-school plan fetch, then mark true reach with
// REACH_DELTA).
export const SAFETY_DELTA = 15;
export const MATCH_DELTA = -5;
export const REACH_DELTA = -25;
// Pre-filter floor for the network-fetch path in recommend-major / fast-path
// in match. Slightly wider than REACH_DELTA so borderline schools aren't
// dropped before we have major-level data; final reach is still REACH_DELTA.
export const PREFILTER_DELTA = -40;

// Provinces where 2024 or 2025 was the FIRST year under 新高考 — historical
// score-based ranking is unreliable until the reform settles, so we surface a
// "don't extrapolate old-track data" warning (finding #6).
//
// Ground truth = the ingested 一分一段 dataset (cli/data/yifenyiduan): a
// province's first-new-exam year is when its physics/history files first
// appear (vs science/liberal for the prior 文/理 regime), cross-checked
// against the national reform批次 in docs/coverage-report-100agents.md:
//   批4 (first new exam 2024): 安徽 江西 广西 贵州 甘肃 黑龙江 吉林
//   批5 (first new exam 2025): 河南 山西 内蒙古 四川 云南 陕西 青海 宁夏
// 批1–3 provinces (上海/浙江 2017, 京津鲁琼 2020, 冀辽苏闽鄂湘粤渝 2021)
// reformed years ago and are NOT flagged — they have stable multi-year
// histories even though our dataset only reaches back to 2024.
// 新疆(65) was scheduled for 批5/2025 but its rollout slipped: the dataset
// shows it still on 文/理 (xinjiang-2025-science) through 2025, so it must
// NOT be flagged as a 2025 new-reform province (was the bug in finding #6).
const NEW_REFORM_FIRST_YEAR: Partial<Record<ProvinceId, number>> = {
  // 批4 — first 新高考 exam 2024
  34: 2024, // 安徽
  36: 2024, // 江西
  45: 2024, // 广西
  52: 2024, // 贵州
  62: 2024, // 甘肃  (was wrongly 2025)
  23: 2024, // 黑龙江 (was missing)
  22: 2024, // 吉林   (was missing)
  // 批5 — first 新高考 exam 2025
  41: 2025, // 河南
  51: 2025, // 四川
  61: 2025, // 陕西
  14: 2025, // 山西
  15: 2025, // 内蒙古 (was missing)
  53: 2025, // 云南
  63: 2025, // 青海
  64: 2025  // 宁夏
  // 新疆(65) intentionally omitted: still 文/理 through 2025 (rollout delayed).
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

// Map (province, subjects) → the gaokao.cn `type` track code used as the key
// into pro_type_min / rank tables. Returns one of: "3" 综合改革 (3+3),
// "2073" 物理类 / "2074" 历史类 (3+1+2), "1" 理工 / "2" 文史 (老高考 文/理).
// These string codes are the single source of truth for track identity here;
// callers that need a rank-table file key translate via chart-check.ts.
export function inferTrack(provinceId: ProvinceId, subjects: Subject[]): string {
  const reform = PROVINCES[provinceId].reform;
  // 港澳台 (71/81/82) — special channels (联招/DSE/学测), not mainland 普通批
  if (reform === "special") {
    throw new Error(`${PROVINCES[provinceId].name} 是港澳台特殊招生区域，不走内地普通批 recommend 流程。请用 \`gaokao-pro qatw ${provinceId}\` 查 联招/DSE/学测/独立招生 等通道。`);
  }
  if (reform === "3+3") return "3"; // 综合改革 — no 文/理 distinction
  if (reform === "3+1+2") {
    if (subjects.includes("物理")) return "2073"; // 物理类
    if (subjects.includes("历史")) return "2074"; // 历史类
    throw new Error("3+1+2 provinces require either 物理 or 历史 in --subjects");
  }
  // Old-reform (文/理) provinces: 山西/内蒙古 moved to 3+1+2, leaving 西藏 (54)
  // 和 新疆 (65) as the remaining 老高考 regions in this dataset (新疆 改革
  // 延期至 2027 首届). The decisive subject is
  // 物理 (理/science, type code "1") vs 历史 (文/liberal, type code "2"):
  // a 老高考 candidate takes 文综 OR 理综 as a fixed bundle, so 物理⇒理科,
  // 历史⇒文科. We do NOT count individual science vs liberal subjects (the old
  // fragile heuristic) because a 理科 candidate never sits 历史 and vice-versa.
  //
  // 西藏 additionally has an ethnic A类/B类 dual-track layered on top of 文/理.
  // We have no A/B-specific data, so 西藏 is modelled purely as 老高考 文/理
  // here — A/B distinctions are NOT represented and callers must treat 西藏
  // results as 文/理-level only. (Documented limitation, finding #7.)
  if (subjects.includes("物理")) return "1"; // 理工 (理科)
  if (subjects.includes("历史")) return "2"; // 文史 (文科)
  // No 物理/历史 given — fall back to subject majority (政/地/化/生 only).
  const sciCount = subjects.filter((s) => ["化学", "生物"].includes(s)).length;
  const libCount = subjects.filter((s) => ["政治", "地理"].includes(s)).length;
  return sciCount >= libCount ? "1" : "2";
}

function bucketOf(delta: number): Bucket {
  if (delta >= SAFETY_DELTA) return "保";
  if (delta >= MATCH_DELTA) return "稳";
  if (delta >= REACH_DELTA) return "冲";
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
  validateScore(input.score, input.provinceId); // finding #12: reject NaN/≤0/over-cap
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
    ? (() => {
        // 当前申报年: 高考填报截至 ~6/30, 之后转向下一届. 2026 view → 第N届.
        const currentApplyYear = (() => {
          const now = new Date();
          return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
        })();
        const cohortIdx = Math.max(1, currentApplyYear - firstReformYear + 1);
        return `${province.name} ${firstReformYear} 年首届新高考 (${province.reform}); ${currentApplyYear} 是第 ${cohortIdx} 届。历年位次跨改革前后不可直接对比；推荐按 2025 baseline 粗估，请用 2024/2025 真实录取数据校正。`;
      })()
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
