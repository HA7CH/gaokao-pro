import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Per-university source files live here, one JSON per school (e.g. pku-2025.json).
const GROUPS_DIR = resolve(__dirname, "../data/college-groups");

type Major = { name: string | null; plan: number | null; min_score: number | null; min_rank: number | null };
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
const MAJOR_PLAN_KEYS = ["plan", "num", "plan_num", "total_num"];
const MAJOR_SCORE_KEYS = ["min_score", "min", "score"];
const MAJOR_RANK_KEYS = ["min_rank", "min_section", "rank"];

function normMajor(m: any): Major {
  if (!m || typeof m !== "object") return { name: null, plan: null, min_score: null, min_rank: null };
  return {
    name: firstString(m, MAJOR_NAME_KEYS),
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
