import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { findCasesByProvince, type HuadangCase } from "./datasets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Per-university source files live here, one JSON per school (e.g. pku-2025.json).
const GROUPS_DIR = resolve(__dirname, "../data/college-groups");

type Major = { name: string | null; code: string | null; plan: number | null; min_score: number | null; min_rank: number | null };
type Group = {
  group_code: string;
  track: string | null;
  subject_require: string | null;
  category: string | null;
  majors_count: number;
  majors: Major[];
  group_min_score: number | null;
  group_min_rank: number | null;
};
type Province = { province: string; groups_count: number; majors_total: number; groups: Group[] };
type University = { university: string; code: number | null; year: number; provinces: Province[] };
type Dataset = { meta: any; universities: University[] };

// ---------------------------------------------------------------------------
// Normalization layer.
//
// The ~79 source files were produced by many different extraction agents and
// use wildly inconsistent key names and shapes (e.g. university name lives in
// `uni` | `university` | `_university` | `meta.uni`; `provinces` is sometimes a
// list and sometimes a province-id-keyed object; the per-group major list is
// `majors` | `items`; major name is `name` | `sp_name` | `spname` | ...).
//
// We map every known variant onto the single canonical shape above. This is a
// pure key/shape remap — values are copied through untouched. Missing values
// stay missing (null / empty), they are never invented.
// ---------------------------------------------------------------------------

function asArray<T = any>(v: any): T[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v) as T[];
  return [];
}

function firstString(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.length) return v;
  }
  return null;
}

function firstNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

const MAJOR_NAME_KEYS = ["name", "sp_name", "spname", "full_name", "spname_full", "name_in_plan", "short", "info_short"];
const MAJOR_CODE_KEYS = ["spcode", "code", "sp_code", "major_code", "spname_code", "zycode", "zy_code", "majorcode"];
const MAJOR_PLAN_KEYS = ["plan", "num", "plan_num", "total_num"];
const MAJOR_SCORE_KEYS = ["min_score", "min", "score"];
const MAJOR_RANK_KEYS = ["min_rank", "min_section", "rank"];

function normMajor(m: any): Major {
  if (!m || typeof m !== "object") return { name: null, code: null, plan: null, min_score: null, min_rank: null };
  return {
    name: firstString(m, MAJOR_NAME_KEYS),
    code: firstString(m, MAJOR_CODE_KEYS),
    plan: firstNumber(m, MAJOR_PLAN_KEYS),
    min_score: firstNumber(m, MAJOR_SCORE_KEYS),
    min_rank: firstNumber(m, MAJOR_RANK_KEYS),
  };
}

const GROUP_CODE_KEYS = ["group_code", "code", "group", "group_id", "special_group_id", "sg_name"];
const GROUP_TRACK_KEYS = ["track", "track_name", "type", "type_name", "regime", "zslx", "zslx_name"];
const GROUP_SUBJECT_KEYS = ["subject_require", "subject_req", "reselect_requirement", "xuanke", "xuanke_detail", "xuanke_raw"];
const GROUP_CATEGORY_KEYS = ["category", "batch", "zslx", "zslx_name"];
const GROUP_SCORE_KEYS = ["group_min_score", "min_score", "min"];
const GROUP_RANK_KEYS = ["group_min_rank", "min_rank", "min_section"];

function pickGroupScalar(g: any, keys: string[]): number | null {
  // Some files put the cutoff inside a `scores` array or a `min` object.
  const direct = firstNumber(g, keys);
  if (direct !== null) return direct;
  const sc = g?.scores;
  if (sc) {
    for (const row of asArray(sc)) {
      const v = firstNumber(row, ["min_score", "min", "score", ...keys]);
      if (v !== null) return v;
    }
  }
  if (g?.min && typeof g.min === "object") {
    const v = firstNumber(g.min, keys.concat(["score", "rank", "min", "min_score", "min_rank"]));
    if (v !== null) return v;
  }
  return null;
}

function normGroup(g: any): Group {
  if (!g || typeof g !== "object") {
    return { group_code: "", track: null, subject_require: null, category: null, majors_count: 0, majors: [], group_min_score: null, group_min_rank: null };
  }
  // major list lives under `majors` or `items`
  const rawMajors = Array.isArray(g.majors) ? g.majors
    : Array.isArray(g.items) ? g.items
    : (g.majors && typeof g.majors === "object") ? asArray(g.majors)
    : (g.items && typeof g.items === "object") ? asArray(g.items)
    : [];
  const majors = rawMajors.map(normMajor);
  const code = firstString(g, GROUP_CODE_KEYS) ?? "";
  return {
    group_code: code,
    track: firstString(g, GROUP_TRACK_KEYS),
    subject_require: firstString(g, GROUP_SUBJECT_KEYS),
    category: firstString(g, GROUP_CATEGORY_KEYS),
    majors_count: majors.length,
    majors,
    group_min_score: pickGroupScalar(g, GROUP_SCORE_KEYS),
    group_min_rank: pickGroupScalar(g, GROUP_RANK_KEYS),
  };
}

// Order matters: lookups elsewhere key on the Chinese province name, and a few
// files store a pinyin slug in `province` with the Chinese name in
// `province_cn`. Prefer the explicitly-Chinese keys first, then fall back to a
// CJK-aware pick so we never surface a pinyin slug when a Chinese name exists.
const PROV_NAME_KEYS = ["province_cn", "province_name", "province", "name"];
const HAS_CJK = /[一-鿿]/;

function provinceName(p: any): string | null {
  // First a value that actually contains Chinese characters.
  for (const k of PROV_NAME_KEYS) {
    const v = p?.[k];
    if (typeof v === "string" && HAS_CJK.test(v)) return v;
  }
  // Otherwise the first non-empty candidate (e.g. a pinyin slug, better than "").
  return firstString(p, PROV_NAME_KEYS);
}

// `keyName` is the object key when `provinces` is a province-keyed map. Several
// files key the map by province name and omit the inner `province` field, so we
// use the key as a fallback name (but only if it isn't a numeric province id).
function normProvince(p: any, keyName?: string): Province {
  if (!p || typeof p !== "object") return { province: "", groups_count: 0, majors_total: 0, groups: [] };
  const groups = asArray(p.groups).map(normGroup);
  const majors_total = groups.reduce((s, g) => s + g.majors_count, 0);
  let province = provinceName(p) ?? "";
  if (!province && typeof keyName === "string" && !/^\d+$/.test(keyName)) province = keyName;
  return {
    province,
    groups_count: groups.length,
    majors_total,
    groups,
  };
}

function normProvinces(provincesRaw: any): Province[] {
  if (Array.isArray(provincesRaw)) return provincesRaw.map(p => normProvince(p));
  if (provincesRaw && typeof provincesRaw === "object") {
    return Object.entries(provincesRaw).map(([k, v]) => normProvince(v, k));
  }
  return [];
}

const UNI_NAME_KEYS = ["university", "uni", "_university"];
const UNI_CODE_KEYS = ["code", "recruit_code", "_code_enroll", "_code_enroll_guobiao", "code_enroll", "_university_code", "zs_code"];
const UNI_YEAR_KEYS = ["year", "_year"];

function normUniversity(raw: any): University | null {
  if (!raw || typeof raw !== "object") return null;
  // Some files nest the descriptive fields under `meta`.
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : null;
  const head = (k: string[]) => firstString(raw, k) ?? (meta ? firstString(meta, k) : null);
  const headNum = (k: string[]) => firstNumber(raw, k) ?? (meta ? firstNumber(meta, k) : null);

  const university = head(UNI_NAME_KEYS);
  if (!university) return null; // cannot index a school with no resolvable name

  const provincesRaw = Array.isArray(raw.provinces) || (raw.provinces && typeof raw.provinces === "object")
    ? raw.provinces
    : (meta && (Array.isArray(meta.provinces) || (meta.provinces && typeof meta.provinces === "object")) ? meta.provinces : []);

  return {
    university,
    code: headNum(UNI_CODE_KEYS),
    year: headNum(UNI_YEAR_KEYS) ?? 0,
    provinces: normProvinces(provincesRaw),
  };
}

// ---------------------------------------------------------------------------
// Year resolution (#11): never hardcode a year. Scan the directory, group
// files by the `<slug>-<year>.json` suffix, and load the requested year or
// fall back to the most recent year actually present on disk.
// ---------------------------------------------------------------------------

function availableYears(): number[] {
  if (!existsSync(GROUPS_DIR)) return [];
  const years = new Set<number>();
  for (const f of readdirSync(GROUPS_DIR)) {
    const m = /-(\d{4})\.json$/.exec(f);
    if (m) years.add(Number(m[1]));
  }
  return [...years].sort((a, b) => b - a);
}

function filesForYear(year: number): string[] {
  if (!existsSync(GROUPS_DIR)) return [];
  return readdirSync(GROUPS_DIR)
    .filter(f => f.endsWith(`-${year}.json`))
    .map(f => join(GROUPS_DIR, f));
}

const cache = new Map<number, Dataset>();

function buildDataset(year: number): Dataset {
  const files = filesForYear(year);
  const universities: University[] = [];
  let provinces_scope = new Set<string>();
  for (const path of files) {
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      continue; // skip files that won't parse rather than crashing the CLI
    }
    const u = normUniversity(raw);
    if (!u) continue;
    universities.push(u);
    for (const p of u.provinces) if (p.province) provinces_scope.add(p.province);
  }
  return {
    meta: {
      year,
      source: "per-university files (data/college-groups)",
      universities_count: universities.length,
      provinces_scope: [...provinces_scope],
    },
    universities,
  };
}

/**
 * Load the dataset for a given year. If `year` is omitted (or not present on
 * disk) we fall back to the most recent year available. Returns the dataset
 * along with the year that was actually used so callers can surface it.
 */
export function loadDataset(year?: number): { dataset: Dataset; year: number } {
  const years = availableYears();
  let resolved: number | null = null;
  if (typeof year === "number" && years.includes(year)) resolved = year;
  else resolved = years[0] ?? null; // most recent, or null if dir is empty

  if (resolved === null) {
    const empty: Dataset = { meta: { year: year ?? null, universities_count: 0, provinces_scope: [] }, universities: [] };
    return { dataset: empty, year: year ?? 0 };
  }
  if (!cache.has(resolved)) cache.set(resolved, buildDataset(resolved));
  return { dataset: cache.get(resolved)!, year: resolved };
}

function load(year?: number): Dataset {
  return loadDataset(year).dataset;
}

export function findUniversity(name: string, year?: number): University | null {
  const ds = load(year);
  return ds.universities.find(u => typeof u.university === "string" && u.university.includes(name)) || null;
}

export function listGroups(uniName: string, provinceName: string, year?: number): Group[] {
  const u = findUniversity(uniName, year);
  if (!u) return [];
  const p = u.provinces.find(p => p.province === provinceName);
  return p ? p.groups : [];
}

/**
 * 调剂安全分 — given user's major preferences, compute risk per group.
 * Strategy:
 *   - must_have: 用户必须录到的专业（关键词）
 *   - acceptable: 可接受的专业（关键词）— 调剂落到这里也 OK
 *   - reject: 拒绝的专业（关键词）— 调剂落到这里 = 灾难
 *
 * safety_score = (matches in must_have ∪ acceptable) / total_in_group
 * verdict:
 *   - 🟢 >= 0.8 (safe to check 服从调剂)
 *   - 🟡 0.4-0.8 (moderate risk — review group composition)
 *   - 🔴 < 0.4 (high risk — do NOT check 服从调剂)
 */
export function safetyScore(group: Group, prefs: {
  must_have: string[];
  acceptable: string[];
  reject: string[];
}): { score: number; verdict: "safe" | "moderate" | "risky"; has_must: boolean; matched_majors: string[]; rejected_majors: string[] } {
  const matched: string[] = [];
  const rejected: string[] = [];
  let has_must = false;
  let acceptable_count = 0;
  for (const m of group.majors) {
    const name = m.name || "";
    if (prefs.must_have.some(kw => name.includes(kw))) {
      matched.push(name); acceptable_count++; has_must = true;
    } else if (prefs.acceptable.some(kw => name.includes(kw))) {
      matched.push(name); acceptable_count++;
    } else if (prefs.reject.some(kw => name.includes(kw))) {
      rejected.push(name);
    }
  }
  const total = group.majors.length || 1;
  const score = acceptable_count / total;
  const verdict = score >= 0.8 ? "safe" : score >= 0.4 ? "moderate" : "risky";
  return { score, verdict, has_must, matched_majors: matched, rejected_majors: rejected };
}

// ---------------------------------------------------------------------------
// 滑档 (slip-grade) risk evaluation.
//
// Combines:
//   - score gap vs the group's historical 投档最低分
//   - rank gap vs 最低位次 (when both candidate and group expose it)
//   - province-level 调剂 availability (read from zhiyuan-rules-2026.json)
//   - optional safetyScore against caller's major preferences
//   - within-group major-score gradient (大热门 vs 冷门 spread)
//
// Deterministic / pure: same inputs ⇒ same verdict. Conservative by design —
// when in doubt we elevate the warning, because parents will read this and
// make a real decision off it.
// ---------------------------------------------------------------------------

const RULES_PATH = resolve(__dirname, "../data/datasets/zhiyuan-rules-2026.json");

type ProvinceRule = {
  province: string;
  reform?: string;
  本科批?: any;
  本科段?: any;
  常规批?: any;
  本科批B?: any;
  本科C段?: any;
  滑档风险?: string;
  策略?: string;
  [k: string]: any;
};

let rulesCache: { provinces: ProvinceRule[] } | null = null;

function loadRules(): { provinces: ProvinceRule[] } {
  if (rulesCache) return rulesCache;
  if (!existsSync(RULES_PATH)) {
    rulesCache = { provinces: [] };
    return rulesCache;
  }
  try {
    const raw = JSON.parse(readFileSync(RULES_PATH, "utf-8"));
    rulesCache = { provinces: Array.isArray(raw?.provinces) ? raw.provinces : [] };
  } catch {
    rulesCache = { provinces: [] };
  }
  return rulesCache;
}

// Locate a province's 本科批 (or moral-equivalent) rules block. Some entries
// store the candidate-relevant fields under different keys (本科批 / 本科段 /
// 常规批 / 本科C段). Walk a small allow-list, returning the first non-empty
// block. Returns null when the province has no parsable structured block —
// caller must NOT invent fallback values; only the textual fields are still
// available on the outer rule object.
function pickBatchBlock(rule: ProvinceRule): { block: any; key: string } | null {
  const CANDIDATES = ["本科批", "本科段", "常规批", "本科批B", "本科C段"];
  for (const k of CANDIDATES) {
    const v = rule[k];
    if (v && typeof v === "object" && !("-" in v)) return { block: v, key: k };
  }
  return null;
}

// Resolve `调剂` boolean from a batch block. Returns null when not present —
// callers treat null as "unknown" (and warn conservatively).
function readTiaoji(block: any): boolean | null {
  if (!block || typeof block !== "object") return null;
  if (typeof block["调剂"] === "boolean") return block["调剂"];
  // Some provinces nest 调剂 inside sub-段 (e.g. 天津 A段/B段). Probe one
  // level deep before giving up.
  for (const v of Object.values(block)) {
    if (v && typeof v === "object" && typeof (v as any)["调剂"] === "boolean") {
      return (v as any)["调剂"] as boolean;
    }
  }
  return null;
}

function readUnit(block: any): string | null {
  if (!block || typeof block !== "object") return null;
  if (typeof block.unit === "string") return block.unit;
  for (const v of Object.values(block)) {
    if (v && typeof v === "object" && typeof (v as any).unit === "string") {
      return (v as any).unit as string;
    }
  }
  return null;
}

export type ProvinceTiaojiInfo = {
  has_tiaoji: boolean | null; // null = unknown (province rules don't expose it)
  unit: string | null;
  slip_warning: string;
  strategy: string | null;
  reform: string | null;
};

export function provinceTiaojiInfo(provinceName: string): ProvinceTiaojiInfo {
  const rules = loadRules();
  // Some entries appear twice (e.g. 浙江 / 山东 cross-referenced with "见上").
  // Prefer the first entry that has a structured batch block.
  let chosen: ProvinceRule | null = null;
  for (const p of rules.provinces) {
    if (p.province !== provinceName) continue;
    if (pickBatchBlock(p)) { chosen = p; break; }
    if (!chosen) chosen = p; // fallback to first match even if blockless
  }
  if (!chosen) {
    return { has_tiaoji: null, unit: null, slip_warning: "", strategy: null, reform: null };
  }
  const picked = pickBatchBlock(chosen);
  const block = picked?.block ?? null;
  return {
    has_tiaoji: readTiaoji(block),
    unit: readUnit(block),
    slip_warning: typeof chosen["滑档风险"] === "string" ? chosen["滑档风险"] : "",
    strategy: typeof chosen["策略"] === "string" ? chosen["策略"] : null,
    reform: typeof chosen.reform === "string" ? chosen.reform : null,
  };
}

export type SlipRiskVerdict = "high_risk" | "moderate_risk" | "low_risk" | "comfortable";

export type SlipRiskPrecedent = {
  case_id: string;
  year: number;
  category: string;
  is_composite: boolean;
  one_line_lesson: string;
};

export type SlipRiskResult = {
  university: string;
  province: string;
  group_code: string;
  group_min_score: number | null;
  group_min_rank: number | null;
  candidate_score: number;
  candidate_rank: number | null;
  score_gap: number | null;        // candidate - group_min_score; positive = above
  rank_gap: number | null;         // group_min_rank - candidate_rank; positive = ahead
  province_rules: {
    has_tiaoji: boolean | null;
    unit: string | null;
    slip_warning: string;
    strategy: string | null;
    reform: string | null;
  };
  safety: ReturnType<typeof safetyScore> | null;
  major_gradient: {
    min: number | null;
    max: number | null;
    spread: number | null;   // max - min; large spread = 大热门/冷门 mix
    sampled: number;
  };
  verdict: SlipRiskVerdict;
  reasons: string[];
  precedents: SlipRiskPrecedent[];  // ≤3 huadang cases matching the pattern
};

export type SlipRiskInput = {
  uniName: string;
  provinceName: string;
  groupCode: string;
  candidateScore: number;
  candidateRank?: number | null;
  year?: number;
  prefs?: { must_have: string[]; acceptable: string[]; reject: string[] };
};

export function slipRisk(input: SlipRiskInput): SlipRiskResult {
  const { uniName, provinceName, groupCode, candidateScore, candidateRank, year, prefs } = input;

  const uni = findUniversity(uniName, year);
  if (!uni) throw new Error(`university not found in dataset: ${uniName}`);
  const province = uni.provinces.find(p => p.province === provinceName);
  if (!province) throw new Error(`province not found for ${uni.university}: ${provinceName}`);
  // Tolerant code match: dataset uses bare "01", caller may pass "01" or "1".
  const trimmedCode = String(groupCode).trim();
  const group = province.groups.find(g => g.group_code === trimmedCode)
    ?? province.groups.find(g => g.group_code.replace(/^0+/, "") === trimmedCode.replace(/^0+/, ""));
  if (!group) {
    const known = province.groups.map(g => g.group_code).join(", ") || "(none)";
    throw new Error(`group not found for ${uni.university}/${provinceName}: ${groupCode} (known: ${known})`);
  }

  const score_gap = group.group_min_score === null ? null : candidateScore - group.group_min_score;
  const rank_gap = (group.group_min_rank === null || candidateRank == null) ? null : group.group_min_rank - candidateRank;

  const provInfo = provinceTiaojiInfo(provinceName);
  const safety = prefs ? safetyScore(group, prefs) : null;

  // Major-gradient: the spread of historical min_score across named majors in
  // the group. Large spread + candidate near the floor = even with 调剂 they
  // may land in 冷门.
  const majorScores = group.majors.map(m => m.min_score).filter((x): x is number => typeof x === "number");
  const gMin = majorScores.length ? Math.min(...majorScores) : null;
  const gMax = majorScores.length ? Math.max(...majorScores) : null;
  const gSpread = (gMin !== null && gMax !== null) ? gMax - gMin : null;

  // ----- verdict synthesis (conservative thresholds) -----
  const reasons: string[] = [];
  // 0=comfortable, 1=low_risk, 2=moderate_risk, 3=high_risk
  // Typed as plain `number` so subsequent `Math.max(level, N)` reassignments
  // don't run afoul of TS literal-type narrowing.
  let level = 0;

  if (group.group_min_score === null) {
    reasons.push(`该组无历史投档分数据 (${uni.university}/${provinceName} 组${group.group_code})，无法精确比对，按谨慎口径上调风险。`);
    level = Math.max(level, 2);
  } else if (score_gap !== null) {
    if (score_gap < 0) {
      reasons.push(`考生分 ${candidateScore} < 该组投档线 ${group.group_min_score}，差 ${Math.abs(score_gap)} 分 → 直接滑档高风险。`);
      level = 3;
    } else if (score_gap < 3) {
      reasons.push(`考生分 ${candidateScore} 仅高于投档线 ${group.group_min_score} 共 ${score_gap} 分，处于压线带，年度波动随时打穿。`);
      level = Math.max(level, 2);
    } else if (score_gap < 8) {
      reasons.push(`考生分 ${candidateScore} 高于投档线 ${group.group_min_score} 共 ${score_gap} 分，安全垫薄，仍属中等风险。`);
      level = Math.max(level, 1);
    } else if (score_gap < 15) {
      reasons.push(`考生分 ${candidateScore} 高于投档线 ${group.group_min_score} 共 ${score_gap} 分，垫子合理，低风险。`);
      level = Math.max(level, 1);
    } else {
      reasons.push(`考生分 ${candidateScore} 远高于投档线 ${group.group_min_score} (差 ${score_gap} 分)，可视为保底。`);
      // leave level at 0 unless other signals raise it
    }
  }

  if (rank_gap !== null) {
    // 位次更小=排名更靠前。group_min_rank - candidate_rank > 0 ⇒ 考生位次更优。
    if (rank_gap < 0) {
      reasons.push(`考生位次 ${candidateRank} 落后于该组历史最低位次 ${group.group_min_rank}，位次维度高风险。`);
      level = 3;
    } else if (rank_gap === 0) {
      reasons.push(`考生位次与历史最低位次同一档，压线。`);
      level = Math.max(level, 2);
    } else if (group.group_min_rank !== null && rank_gap < group.group_min_rank * 0.05) {
      // 5% 安全带：位次浮动常态在 5% 以内
      reasons.push(`考生位次仅领先 ${rank_gap}，不足 5% 安全带，位次浮动易打穿。`);
      level = Math.max(level, 2);
    }
  } else if (candidateRank == null) {
    reasons.push("未提供 candidateRank，无法做位次维度交叉验证；新高考省份建议补齐 (gaokao-pro rank 可查)。");
  }

  // Province 调剂 layer.
  if (provInfo.has_tiaoji === false) {
    reasons.push(`${provinceName} 本科批为专业平行模式 (调剂=false)，无服从调剂兜底，未投中即落征集/下批。${provInfo.slip_warning ? "省考试院滑档提示：" + provInfo.slip_warning : ""}`);
    // 无调剂时压线/压线下=直接 high_risk
    if (score_gap !== null && score_gap < 3) level = 3;
    else level = Math.max(level, 2);
  } else if (provInfo.has_tiaoji === true) {
    if (safety && safety.verdict === "risky" && safety.rejected_majors.length > 0) {
      reasons.push(`勾服从调剂会落到您 reject 的专业 (${safety.rejected_majors.slice(0, 3).join("、")}${safety.rejected_majors.length > 3 ? "…" : ""})；不勾则压线即退档。两难，建议换组。`);
      level = Math.max(level, 2);
    } else if (safety && safety.verdict === "moderate") {
      reasons.push(`服从调剂落到非首选专业的概率非可忽略 (safety=${safety.score.toFixed(2)}, 已匹配 ${safety.matched_majors.length}/${group.majors.length})。`);
      level = Math.max(level, 1);
    } else if (safety && safety.verdict === "safe") {
      reasons.push(`组内可接受专业占比高 (safety=${safety.score.toFixed(2)})，勾服从调剂相对放心。`);
    }
  } else {
    reasons.push(`${provinceName} 调剂规则未在 rules 表中明确，按谨慎口径处理。`);
    level = Math.max(level, 1);
  }

  // Major-gradient layer: large spread = 大热门/冷门 mix; candidate near the
  // floor will likely land in 冷门 even with 调剂.
  if (gSpread !== null && gSpread >= 15 && score_gap !== null && score_gap < 10) {
    reasons.push(`组内专业最高/最低分差 ${gSpread} 分 (${gMin}–${gMax})，热门冷门梯度大；考生分接近组底，调剂大概率落入冷门专业。`);
    level = Math.max(level, 2);
  } else if (gSpread !== null && gSpread >= 15) {
    reasons.push(`组内专业最高/最低分差 ${gSpread} 分 (${gMin}–${gMax})，可接受的专业请按对应分位审查。`);
  }

  if (provInfo.strategy) {
    reasons.push(`参考策略（${provinceName}）：${provInfo.strategy}`);
  }

  const verdict: SlipRiskVerdict =
    level === 3 ? "high_risk" :
    level === 2 ? "moderate_risk" :
    level === 1 ? "low_risk" :
    "comfortable";

  // Auto-attach huadang precedents for moderate+ verdicts. Picks ≤3 cases from
  // the same province whose category matches the dominant risk signal in this
  // run, so parents see "this exact pattern has burned others before".
  const precedents: SlipRiskPrecedent[] = (verdict === "comfortable")
    ? []
    : pickPrecedents({
        provinceName,
        verdict,
        score_gap,
        has_tiaoji: provInfo.has_tiaoji,
        safety,
        spread: gSpread,
        reform: provInfo.reform,
      });

  return {
    university: uni.university,
    province: provinceName,
    group_code: group.group_code,
    group_min_score: group.group_min_score,
    group_min_rank: group.group_min_rank,
    candidate_score: candidateScore,
    candidate_rank: candidateRank ?? null,
    score_gap,
    rank_gap,
    province_rules: {
      has_tiaoji: provInfo.has_tiaoji,
      unit: provInfo.unit,
      slip_warning: provInfo.slip_warning,
      strategy: provInfo.strategy,
      reform: provInfo.reform,
    },
    safety,
    major_gradient: { min: gMin, max: gMax, spread: gSpread, sampled: majorScores.length },
    verdict,
    reasons,
    precedents,
  };
}

// Pick ≤3 most-relevant huadang cases for the slip-risk run.
// Ranking: category match with the dominant risk signal first, then province,
// then most recent year. If no province match, fall back to category-only.
function pickPrecedents(ctx: {
  provinceName: string;
  verdict: SlipRiskVerdict;
  score_gap: number | null;
  has_tiaoji: boolean | null;
  safety: ReturnType<typeof safetyScore> | null;
  spread: number | null;
  reform: string | null;
}): SlipRiskPrecedent[] {
  // Infer ranked category preferences from the risk signals.
  const wanted: string[] = [];
  if (ctx.has_tiaoji === false) wanted.push("无调剂兜底");
  if (ctx.safety && ctx.safety.rejected_majors.length > 0) wanted.push("不勾服从");
  if (ctx.safety && ctx.safety.verdict === "risky") wanted.push("组内冷热门差大");
  if (ctx.spread !== null && ctx.spread >= 15) wanted.push("组内冷热门差大");
  if (ctx.score_gap !== null && ctx.score_gap < 3 && ctx.has_tiaoji !== false) wanted.push("不勾服从");
  // 新高考首届 catch-all for 山西/内蒙古/河南/四川/陕西/云南/青海/宁夏
  if (ctx.reform && (ctx.reform.includes("第2年") || ctx.reform.includes("首届"))) wanted.push("新高考首届");
  if (wanted.length === 0) wanted.push("不勾服从");  // default-pattern fallback

  let cases: HuadangCase[];
  try {
    cases = findCasesByProvince(ctx.provinceName);
  } catch {
    return [];
  }
  // Prefer category-matched cases, then any in-province, then recent year first.
  const score = (c: HuadangCase): number => {
    const idx = wanted.indexOf(c.category);
    const catScore = idx === -1 ? 0 : (100 - idx * 10);
    const yearScore = (c.year - 2020); // 2025 → 5
    const realBonus = c.is_composite ? 0 : 2;
    return catScore + yearScore + realBonus;
  };
  const ranked = cases
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3);
  return ranked.map((c) => ({
    case_id: c.case_id,
    year: c.year,
    category: c.category,
    is_composite: c.is_composite,
    one_line_lesson: c.lesson.length > 140 ? c.lesson.slice(0, 137) + "…" : c.lesson,
  }));
}

export function listAllUniversities(year?: number): string[] {
  return load(year).universities.map(u => u.university).filter(Boolean);
}

export function datasetStats(year?: number) {
  const { dataset: ds, year: usedYear } = loadDataset(year);
  let total_groups = 0, total_majors = 0;
  for (const u of ds.universities) {
    for (const p of u.provinces) {
      total_groups += p.groups_count;
      total_majors += p.majors_total;
    }
  }
  return {
    universities: ds.universities.length,
    total_groups,
    total_majors,
    provinces_scope: ds.meta?.provinces_scope || [],
    year: usedYear,
    available_years: availableYears(),
  };
}
