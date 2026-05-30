// Loaders for the static datasets shipped in cli/data/datasets/.
// These are the human-curated artifacts produced by the multi-agent fan-outs:
//   schools-adapters-2024.json: per-school 招生网 URL + 强基/综评/中外/专项/民族/预科/运动/艺术 flags
//   provinces-specialty-2024.json: per-province 提前批 + cross-province 国家/高校/地方专项 + 港澳台联招
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = dirname(__filename);

const CANDIDATE_DATA_DIRS = [
  resolve(SRC_DIR, "..", "data", "datasets"),
  resolve(SRC_DIR, "..", "..", "data", "datasets")
];

function findDir(): string | null {
  for (const d of CANDIDATE_DATA_DIRS) {
    if (existsSync(d)) return d;
  }
  return null;
}

// Returns null only when the file is genuinely absent (callers turn that into a
// clear "missing dataset" error). A present-but-corrupt file throws here with the
// offending path so the failure isn't a downstream null/undefined deref.
function load<T>(filename: string): T | null {
  const dir = findDir();
  if (!dir) return null;
  const path = resolve(dir, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    throw new Error(
      `dataset ${filename} is unreadable or not valid JSON (${path}): ${e instanceof Error ? e.message : e}. ` +
        `Re-run the dataset fan-out to regenerate it.`
    );
  }
}

// Builds a uniform "missing dataset" error so callers don't null-deref later.
function missingDataset(filename: string): Error {
  const where = findDir() ?? CANDIDATE_DATA_DIRS.join(" | ");
  return new Error(
    `dataset ${filename} not found in ${where}. ` +
      `Ensure cli/data/datasets/ ships with the build, or re-run the dataset fan-out to regenerate it.`
  );
}

// ---- Types ----

export type ProgramFlag = { offers: boolean | null; url: string | null };
export type GaoxiaoZhuanxiang = { offers: boolean | null; name: string | null; url: string | null };

export type SchoolAdapter = {
  name: string;
  zs_code: string;
  zsw_url: string | null;
  programs: {
    qiangji: ProgramFlag;
    zonghepingjia: ProgramFlag;
    zhongwai_hezuo: ProgramFlag;
    guojia_zhuanxiang: boolean | null;
    gaoxiao_zhuanxiang: GaoxiaoZhuanxiang;
    minzu_ban: boolean | null;
    yuke_ban: boolean | null;
    gao_shui_yundong: boolean | null;
    high_art: boolean | null;
  };
  contact: { phone: string | null; email: string | null };
  note?: string;
};

export type SchoolsAdaptersFile = {
  schools: SchoolAdapter[];
};

export type ProvinceSpecialty = {
  province: string;
  year: number;
  data_quality?: "verified" | "partial";
  tiqian?: { types?: string[]; rules?: string };
  qiangji_implementing?: string[];
  zonghepingjia_implementing?: string[];
  guojia_zhuanxiang?: boolean;
  gaoxiao_zhuanxiang?: boolean;
  difang_zhuanxiang?: boolean;
  source?: string[];
};

export type CrossProvincePrograms = {
  guojia_zhuanxiang?: Record<string, unknown>;
  gaoxiao_zhuanxiang?: Record<string, unknown>;
  difang_zhuanxiang?: Record<string, unknown>;
  gangaotai_lianzhao?: Record<string, unknown>;
};

export type ProvincesSpecialtyFile = {
  provinces: ProvinceSpecialty[];
  cross_province_special_programs: CrossProvincePrograms;
};

// 高水平运动队 (high-level sports team) per-school per-sport detail.
// 2024 file is a flat sports[] list (string[]); 2025+ is per-sport object detail.
export type GaoshuiSport2024 = string;
export type GaoshuiSport2025 = {
  name: string;
  tier_required: string | null;
  exam_window: string | null;
  score_path: string | null;
  plan_count: number | null;
  notes: string | null;
};
export type GaoshuiSchool2024 = {
  school: string;
  zs_code: string;
  sports: GaoshuiSport2024[];
};
export type GaoshuiSchool2025 = {
  school: string;
  zs_code: string | null;
  sports: GaoshuiSport2025[];
};
export type GaoshuiYundongduiFile2024 = {
  _kind: string;
  _year: number;
  _source: string[];
  schools: GaoshuiSchool2024[];
};
export type GaoshuiYundongduiFile2025 = {
  _kind: string;
  _year: number;
  _source: string[];
  _notes?: string[];
  schools: GaoshuiSchool2025[];
};

// 综合评价 (comprehensive evaluation).
// 2024 file is region-grouped (regions: {shanghai|jiangsu|...: [...]}); 2026+ is school-grouped.
export type ZongheRegionSchool2024 = {
  school: string;
  zs_code: string;
  ratio?: string;
  seats?: number;
  note?: string;
};
export type ZongheRegionsFile2024 = {
  _kind: string;
  _year: number;
  _source: string[];
  regions: Record<string, ZongheRegionSchool2024[]>;
};
export type ZongheSchool2026 = {
  school: string;
  zs_code: string | null;
  provinces: string[];
  ratio: string | null;
  校测含?: string | null;
  seats: number | null;
  tiqian_pi: boolean | null;
  notes: string | null;
};
export type ZongheBySchoolFile2026 = {
  _kind: string;
  _year: number;
  _source: string[];
  _notes?: string[];
  schools: ZongheSchool2026[];
};

// ---- Caches ----

let schoolsCache: SchoolsAdaptersFile | null = null;
let provincesCache: ProvincesSpecialtyFile | null = null;
let gaoshui2024Cache: GaoshuiYundongduiFile2024 | null = null;
let gaoshui2025Cache: GaoshuiYundongduiFile2025 | null = null;
let zonghe2024Cache: ZongheRegionsFile2024 | null = null;
let zonghe2026Cache: ZongheBySchoolFile2026 | null = null;

export function loadSchoolsAdapters(): SchoolsAdaptersFile {
  if (schoolsCache) return schoolsCache;
  const data = load<SchoolsAdaptersFile>("schools-adapters-2024.json");
  if (!data) throw missingDataset("schools-adapters-2024.json");
  if (!Array.isArray(data.schools)) {
    throw new Error("schools-adapters-2024.json is missing its `schools` array — file is malformed.");
  }
  schoolsCache = data;
  return data;
}

export function loadProvincesSpecialty(): ProvincesSpecialtyFile {
  if (provincesCache) return provincesCache;
  const data = load<ProvincesSpecialtyFile>("provinces-specialty-2024.json");
  if (!data) throw missingDataset("provinces-specialty-2024.json");
  if (!Array.isArray(data.provinces)) {
    throw new Error("provinces-specialty-2024.json is missing its `provinces` array — file is malformed.");
  }
  provincesCache = data;
  return data;
}

// ---- Queries ----

export function findSchoolAdapter(query: string): SchoolAdapter | null {
  const file = loadSchoolsAdapters();
  const q = query.trim();
  // try zs_code exact match first
  const byCode = file.schools.find((s) => s.zs_code === q);
  if (byCode) return byCode;
  // then by name substring (case-insensitive on Chinese)
  return file.schools.find((s) => s.name.includes(q)) ?? null;
}

export function listSchoolsOfferingProgram(
  program: "qiangji" | "zonghepingjia" | "zhongwai_hezuo" | "guojia_zhuanxiang" | "gaoxiao_zhuanxiang" | "minzu_ban" | "yuke_ban" | "gao_shui_yundong" | "high_art"
): SchoolAdapter[] {
  const file = loadSchoolsAdapters();
  return file.schools.filter((s) => {
    const v = s.programs[program];
    if (typeof v === "boolean") return v === true;
    if (v && typeof v === "object" && "offers" in v) return v.offers === true;
    return false;
  });
}

export function findProvinceSpecialty(provinceKey: string): ProvinceSpecialty | null {
  const file = loadProvincesSpecialty();
  return file.provinces.find((p) => p.province === provinceKey) ?? null;
}

export function listProvinceKeys(): string[] {
  return loadProvincesSpecialty().provinces.map((p) => p.province);
}

export function getCrossProvincePrograms(): CrossProvincePrograms {
  return loadProvincesSpecialty().cross_province_special_programs;
}

// ---- 高水平运动队 loaders ----

// Loads the 2024 (flat sports list) snapshot.
export function loadGaoshuiYundongdui2024(): GaoshuiYundongduiFile2024 {
  if (gaoshui2024Cache) return gaoshui2024Cache;
  const data = load<GaoshuiYundongduiFile2024>("gaoshui-yundongdui-2024.json");
  if (!data) throw missingDataset("gaoshui-yundongdui-2024.json");
  if (!Array.isArray(data.schools)) {
    throw new Error("gaoshui-yundongdui-2024.json is missing its `schools` array — file is malformed.");
  }
  gaoshui2024Cache = data;
  return data;
}

// Loads the 2025 per-sport detail snapshot (post-reform, single-exam path metadata).
export function loadGaoshuiYundongdui2025(): GaoshuiYundongduiFile2025 {
  if (gaoshui2025Cache) return gaoshui2025Cache;
  const data = load<GaoshuiYundongduiFile2025>("gaoshui-yundongdui-2025.json");
  if (!data) throw missingDataset("gaoshui-yundongdui-2025.json");
  if (!Array.isArray(data.schools)) {
    throw new Error("gaoshui-yundongdui-2025.json is missing its `schools` array — file is malformed.");
  }
  gaoshui2025Cache = data;
  return data;
}

// Year-aware accessor — defaults to latest (2025).
export function loadGaoshuiYundongdui(year?: 2024 | 2025): GaoshuiYundongduiFile2024 | GaoshuiYundongduiFile2025 {
  return year === 2024 ? loadGaoshuiYundongdui2024() : loadGaoshuiYundongdui2025();
}

// Lists 2025 schools that recruit a given sport (substring match against sport name).
export function listGaoshuiSchoolsBySport(sport: string): GaoshuiSchool2025[] {
  const file = loadGaoshuiYundongdui2025();
  return file.schools.filter((s) => s.sports.some((sp) => sp.name.includes(sport)));
}

// ---- 综合评价 loaders ----

// Loads the original 5-region snapshot (kept for back-compat).
export function loadZonghepingjia2024(): ZongheRegionsFile2024 {
  if (zonghe2024Cache) return zonghe2024Cache;
  const data = load<ZongheRegionsFile2024>("zonghepingjia-2024.json");
  if (!data) throw missingDataset("zonghepingjia-2024.json");
  if (!data.regions || typeof data.regions !== "object") {
    throw new Error("zonghepingjia-2024.json is missing its `regions` map — file is malformed.");
  }
  zonghe2024Cache = data;
  return data;
}

// Loads the 2026 by-school snapshot (cross-province schools like UCAS/SUSTech/ShanghaiTech).
export function loadZonghepingjia2026(): ZongheBySchoolFile2026 {
  if (zonghe2026Cache) return zonghe2026Cache;
  const data = load<ZongheBySchoolFile2026>("zonghepingjia-2026.json");
  if (!data) throw missingDataset("zonghepingjia-2026.json");
  if (!Array.isArray(data.schools)) {
    throw new Error("zonghepingjia-2026.json is missing its `schools` array — file is malformed.");
  }
  zonghe2026Cache = data;
  return data;
}

// Year-aware accessor — defaults to latest (2026).
export function loadZonghepingjia(year?: 2024 | 2026): ZongheRegionsFile2024 | ZongheBySchoolFile2026 {
  return year === 2024 ? loadZonghepingjia2024() : loadZonghepingjia2026();
}

// Lists 2026 综评 schools open to a given province.
export function listZongheSchoolsByProvince(province: string): ZongheSchool2026[] {
  const file = loadZonghepingjia2026();
  return file.schools.filter((s) => s.provinces.includes(province));
}

// ---- 提前批 special-program catalog ----
// Combines 公费师范生 / 优师 / 综评 / 三位一体 / 中外合作综评 / 国家专项 / 高校专项 /
// 公安院校 / 军校 / 农村订单医学 / 航海类 / 小语种 / 民族班 / 预科班 into one cross-axis
// catalog. The verbs/recommend code can ask "for province X, what 提前批 programs apply?"
// without scanning multiple files.
export type TiqianProgramType =
  | "公费师范生" | "优师计划" | "国家专项" | "高校专项" | "地方专项"
  | "公安院校" | "军校" | "农村订单医学" | "航海类" | "小语种提前批"
  | "民族班" | "预科班" | "综评提前批" | "三位一体" | "中外合作综评" | "其他";
export type TiqianProgram = {
  program_type: TiqianProgramType | string;
  school: string;
  zs_code: string | null;
  eligible_provinces: string[];
  scope_note: string | null;
  majors: string[];
  plan_count_2025: number | null;
  eligibility: string | null;
  commitment: string | null;
  exam_window: string | null;
  ratio: string | null;
  url: string | null;
};
export type TiqianProgramsFile = {
  _kind: string;
  _year: number;
  _compiled: string;
  _source: string[];
  _notes?: string[];
  programs: TiqianProgram[];
  province_index?: Record<string, number[]>;
};

let tiqianCache: TiqianProgramsFile | null = null;

export function loadTiqianPrograms(): TiqianProgramsFile {
  if (tiqianCache) return tiqianCache;
  const data = load<TiqianProgramsFile>("tiqian-pi-programs-2025.json");
  if (!data) throw missingDataset("tiqian-pi-programs-2025.json");
  if (!Array.isArray(data.programs)) {
    throw new Error("tiqian-pi-programs-2025.json is missing its `programs` array — file is malformed.");
  }
  tiqianCache = data;
  return data;
}

// Lists 提前批 programs eligible for a given province. Matches both exact
// "全国 31 省"/"全国"/"全国 30+ 省" sentinels AND specific province names.
export function listTiqianProgramsByProvince(province: string): TiqianProgram[] {
  const file = loadTiqianPrograms();
  const NATIONAL_SENTINELS = new Set([
    "全国", "全国 31 省", "全国 30+ 省", "全国 832 县",
    "全国 832 县 (国家级脱贫县名单)", "全国少数民族集中省"
  ]);
  return file.programs.filter((p) => {
    const ep = p.eligible_provinces || [];
    if (ep.includes(province)) return true;
    return ep.some((e) => NATIONAL_SENTINELS.has(e));
  });
}

// ---- Year-status (2025 baseline vs 2026 pending) ----
export type DataYearStatus = {
  current_filing_year: number;
  baseline_year: number;
  datasets: Record<string, { active_year?: number; expected_2026_window?: string; fallback_message?: string; status?: string; note?: string }>;
  verb_warnings: Record<string, string>;
};
let yearStatusCache: DataYearStatus | null = null;
export function loadDataYearStatus(): DataYearStatus | null {
  if (yearStatusCache) return yearStatusCache;
  const data = load<DataYearStatus>("data-year-status.json");
  if (!data) return null;
  yearStatusCache = data;
  return data;
}
// ---- 2030 专业前景 outlook ----
export type ZhuanyeOutlookMajor = {
  name: string;
  spcode_examples?: string[];
  category?: string;
  data_facts: string[];
  policy_basis: string[];
  my_judgment: {
    outlook_2030: string;
    confidence: "高" | "中" | "低";
    why: string;
    wrong_scenario: string;
    verdict: string;
  };
};
export type ZhuanyeOutlookFile = {
  _kind: string;
  _year_target: number;
  _compiled: string;
  _source: string[];
  _notes?: string[];
  majors: ZhuanyeOutlookMajor[];
};
let outlookCache: ZhuanyeOutlookFile | null = null;
export function loadZhuanyeOutlook(): ZhuanyeOutlookFile {
  if (outlookCache) return outlookCache;
  const data = load<ZhuanyeOutlookFile>("zhuanye-outlook-2030.json");
  if (!data) throw missingDataset("zhuanye-outlook-2030.json");
  if (!Array.isArray(data.majors)) {
    throw new Error("zhuanye-outlook-2030.json is missing its `majors` array — file is malformed.");
  }
  outlookCache = data;
  return data;
}
// Lookup by major name (substring) or spcode prefix.
export function findOutlookByMajor(query: string): ZhuanyeOutlookMajor[] {
  const file = loadZhuanyeOutlook();
  const q = query.trim();
  if (!q) return [];
  // Match by name substring OR spcode prefix
  return file.majors.filter((m) => {
    if (m.name.includes(q) || q.includes(m.name)) return true;
    if (m.spcode_examples?.some((c) => c.startsWith(q) || q.startsWith(c.slice(0, 4)))) return true;
    return false;
  });
}

// Returns the human-readable warning for a given verb (recommend / top /
// slip-risk / roadmap / rank), or null if the status file is missing or
// has no entry for that verb. Verbs append this to their output footer
// so parents see clearly when data is baseline-only.
export function verbWarning(verbName: string): string | null {
  const s = loadDataYearStatus();
  if (!s || !s.verb_warnings) return null;
  const w = s.verb_warnings[verbName];
  return typeof w === "string" && w.length > 0 ? w : null;
}

// Lists 提前批 programs of a given type (e.g. "公费师范生", "综评提前批").
// Fuzzy match: "公费师范" → "公费师范生", "国家专项计划" → "国家专项", etc.
export function listTiqianProgramsByType(programType: string): TiqianProgram[] {
  const file = loadTiqianPrograms();
  const q = String(programType).trim();
  // 1) exact
  let hits = file.programs.filter((p) => p.program_type === q);
  if (hits.length > 0) return hits;
  // 2) fuzzy: q is a substring of program_type, or program_type is substring of q
  hits = file.programs.filter((p) => p.program_type.includes(q) || q.includes(p.program_type));
  return hits;
}

// Lists distinct program_type values present in the dataset.
export function listTiqianProgramTypes(): string[] {
  const file = loadTiqianPrograms();
  const set = new Set<string>();
  for (const p of file.programs) set.add(p.program_type);
  return Array.from(set);
}

// Lists 提前批 programs run by a specific school (substring match against school name).
// Useful for parent queries like "清华跑哪些提前批/综评/专项?".
export function listTiqianProgramsBySchool(schoolName: string): TiqianProgram[] {
  const file = loadTiqianPrograms();
  return file.programs.filter((p) => typeof p.school === "string" && p.school.includes(schoolName));
}

// ---- 强基/综评 校测 detail (2025) ----
// Per-school detail of college-administered exams (笔试/面试/体测) for both
// 强基计划 and 综合评价. The zonghepingjia-2026 file lists which schools
// run综评 + a one-line 校测含 string; this file goes deeper for parents
// deciding "is the 校测 prep load worth it".
export type XiaoceQiangjiDetail = {
  subjects_offered: string[];
  校测_笔试: string | null;
  校测_面试: string | null;
  校测_体测: string | null;
  校测_pass_rate: string | null;
  录取分配: string | null;
  报名窗口: string | null;
  校测时间: string | null;
  可填学校: string | null;
  签约条款: string | null;
  url: string | null;
};
export type XiaoceZongpingDetail = {
  省份: string[];
  校测_笔试: string | null;
  校测_面试: string | null;
  校测_体测: string | null;
  录取分配: string | null;
  报名窗口: string | null;
  校测时间: string | null;
  可填学校: string | null;
  签约条款: string | null;
  url: string | null;
};
export type XiaoceSchoolDetail = {
  school: string;
  zs_code: string | null;
  qiangji: XiaoceQiangjiDetail | null;
  zongping: XiaoceZongpingDetail | null;
};
export type XiaoceDetailFile = {
  _kind: string;
  _year: number;
  _compiled: string;
  _source: string[];
  _notes?: string[];
  schools: XiaoceSchoolDetail[];
};

let xiaoceDetailCache: XiaoceDetailFile | null = null;

export function loadXiaoceDetail2025(): XiaoceDetailFile {
  if (xiaoceDetailCache) return xiaoceDetailCache;
  const data = load<XiaoceDetailFile>("xiaoce-detail-2025.json");
  if (!data) throw missingDataset("xiaoce-detail-2025.json");
  if (!Array.isArray(data.schools)) {
    throw new Error("xiaoce-detail-2025.json is missing its `schools` array — file is malformed.");
  }
  xiaoceDetailCache = data;
  return data;
}

// Substring-match against school name (zs_code exact match preferred).
export function findXiaoceDetailBySchool(name: string): XiaoceSchoolDetail | null {
  const file = loadXiaoceDetail2025();
  const q = name.trim();
  const byCode = file.schools.find((s) => s.zs_code === q);
  if (byCode) return byCode;
  return file.schools.find((s) => s.school.includes(q)) ?? null;
}

// ---- 滑档/退档 历史案例 (2022-2025) ----
// Concrete past cases for the 滑档/退档 risk scenarios surfaced by slipRisk
// (and by zhiyuan-rules-2026 abstract 滑档风险/策略 fields). Parents respond to
// past stories far better than abstract warnings — this dataset is the
// case-law layer for the "why prefs.must_have / 服从调剂 / 选科核验 / etc.
// actually matter" conversation.
export type HuadangCaseType = "滑档" | "退档";
export type HuadangCase = {
  case_id: string;
  year: number;
  province: string;
  type: HuadangCaseType;
  school: string | null;
  category: string;
  candidate_profile_summary: string;
  what_happened: string;
  lesson: string;
  tags: string[];
  source_hint: string;
  is_composite: boolean;
};
export type HuadangCasesFile = {
  _kind: string;
  _year: number;
  _compiled: string;
  _source: string[];
  _notes?: string[];
  categories: string[];
  cases: HuadangCase[];
};

let huadangCache: HuadangCasesFile | null = null;

export function loadHuadangCases(): HuadangCasesFile {
  if (huadangCache) return huadangCache;
  const data = load<HuadangCasesFile>("huadang-cases-2022-2025.json");
  if (!data) throw missingDataset("huadang-cases-2022-2025.json");
  if (!Array.isArray(data.cases)) {
    throw new Error("huadang-cases-2022-2025.json is missing its `cases` array — file is malformed.");
  }
  huadangCache = data;
  return data;
}

// Lists cases for a given province (exact match against `province` field).
export function findCasesByProvince(name: string): HuadangCase[] {
  const file = loadHuadangCases();
  const q = name.trim();
  return file.cases.filter((c) => c.province === q);
}

// Lists cases for a given category (exact match against `category` field).
// Categories are enumerated in the file's `categories` array — see
// huadang-cases-2022-2025.json for the canonical list.
export function findCasesByCategory(cat: string): HuadangCase[] {
  const file = loadHuadangCases();
  const q = cat.trim();
  return file.cases.filter((c) => c.category === q);
}

// ---- 投档/录取/征集 时间日历 (2026) ----
// Per-province batch-timing calendar. The zhiyuan-rules-2026 dataset answers
// WHAT each batch is (院校专业组 vs 专业平行, 调剂 on/off, 志愿数, etc.);
// this one answers WHEN — fill window open/close, dispatch (投档) date,
// release (录取) date, and 征集志愿 supplementary windows. Missing a 提前批
// 投档 date is a lost-batch event for the candidate, so this calendar is
// parent-critical for the Aug/Sep timing chats.
export type Milestone = {
  date: string;
  event: string;
};
export type BatchTiming = {
  name: string;
  fill_start: string | null;
  fill_end: string | null;
  dispatch_date: string | null;
  release_date: string | null;
  supplementary_fill?: string | null;
  supplementary_release?: string | null;
  notes?: string | null;
};
export type ProvinceCalendar = {
  province: string;
  exam_dates: string;
  score_release: string;
  based_on_year?: number;
  tentative?: boolean;
  batches: BatchTiming[];
  key_milestones: Milestone[];
};
export type ZhiyuanCalendarFile = {
  _kind: string;
  _year: number;
  _compiled: string;
  _source: string[];
  _notes?: string[];
  provinces: ProvinceCalendar[];
};

let zhiyuanCalendarCache: ZhiyuanCalendarFile | null = null;

export function loadZhiyuanCalendar2026(): ZhiyuanCalendarFile {
  if (zhiyuanCalendarCache) return zhiyuanCalendarCache;
  const data = load<ZhiyuanCalendarFile>("zhiyuan-calendar-2026.json");
  if (!data) throw missingDataset("zhiyuan-calendar-2026.json");
  if (!Array.isArray(data.provinces)) {
    throw new Error("zhiyuan-calendar-2026.json is missing its `provinces` array — file is malformed.");
  }
  zhiyuanCalendarCache = data;
  return data;
}

// Substring-match against province name (e.g. "河南", "北京"). Returns the
// per-province calendar entry or null if the province isn't in the dataset.
export function findCalendarByProvince(name: string): ProvinceCalendar | null {
  const file = loadZhiyuanCalendar2026();
  const q = name.trim();
  const exact = file.provinces.find((p) => p.province === q);
  if (exact) return exact;
  return file.provinces.find((p) => p.province.includes(q) || q.includes(p.province)) ?? null;
}

// ---- 0.3.6 parent-mindset datasets ----

let cityTierCache: any = null;
let mistakeZoneCache: any = null;
let familyBudgetCache: any = null;
let kaogongMajorsCache: any = null;

export function loadCityTier(): any {
  if (cityTierCache) return cityTierCache;
  const data = load<any>("city-tier-2025.json");
  if (!data) throw missingDataset("city-tier-2025.json");
  cityTierCache = data;
  return data;
}

export function loadMistakeZone(): any {
  if (mistakeZoneCache) return mistakeZoneCache;
  const data = load<any>("mistake-zone-2025.json");
  if (!data) throw missingDataset("mistake-zone-2025.json");
  mistakeZoneCache = data;
  return data;
}

export function loadFamilyBudget(): any {
  if (familyBudgetCache) return familyBudgetCache;
  const data = load<any>("family-budget-2025.json");
  if (!data) throw missingDataset("family-budget-2025.json");
  familyBudgetCache = data;
  return data;
}

export function loadKaogongMajors(): any {
  if (kaogongMajorsCache) return kaogongMajorsCache;
  const data = load<any>("kaogong-majors-2025.json");
  if (!data) throw missingDataset("kaogong-majors-2025.json");
  kaogongMajorsCache = data;
  return data;
}

export function findCityByName(name: string): any {
  const f = loadCityTier();
  const q = name.trim();
  const cities = f.cities || [];
  return cities.find((c: any) => c.city === q)
    ?? cities.find((c: any) => c.city.includes(q) || q.includes(c.city))
    ?? null;
}

export function findCitiesByProvince(province: string): any[] {
  const f = loadCityTier();
  const q = province.trim();
  return (f.cities || []).filter((c: any) => c.province === q || c.province.includes(q));
}

export function findCitiesByTier(tier: string): any[] {
  const f = loadCityTier();
  return (f.cities || []).filter((c: any) => c.tier === tier);
}

export function findPitsForSchool(schoolName: string): any[] {
  const f = loadMistakeZone();
  const q = schoolName.trim();
  return (f.per_school_pits || []).filter((p: any) =>
    Array.isArray(p.applies_to) && p.applies_to.some((s: string) => s === q || s.includes(q) || q.includes(s))
  );
}

export function findBudgetTier(tierName: string): any {
  const f = loadFamilyBudget();
  const q = tierName.trim();
  return (f.tiers || []).find((t: any) => t.tier === q || q.includes(t.tier)) ?? null;
}

// ---- 0.3.7 employment-outcomes (5 维就业出口) ----

let employmentOutcomesCache: any = null;

export function loadEmploymentOutcomes(): any {
  if (employmentOutcomesCache) return employmentOutcomesCache;
  const data = load<any>("employment-outcomes-2024.json");
  if (!data) throw missingDataset("employment-outcomes-2024.json");
  employmentOutcomesCache = data;
  return data;
}

export function findEmploymentOutcomeBySchool(schoolName: string): any {
  const f = loadEmploymentOutcomes();
  const q = schoolName.trim();
  const schools = f.schools || [];
  return schools.find((s: any) => s.school === q)
    ?? schools.find((s: any) => s.school.includes(q) || q.includes(s.school))
    ?? null;
}

// Province coverage tracker — used by the web UI to render a ✓ badge per
// province when its 一本 schools have been ingested into employment-outcomes.
// Cities outside the city-tier dataset get a hardcoded fallback so we don't
// emit "秦皇岛"/"延吉" as province names.
const CITY_TO_PROVINCE_FALLBACK: Record<string, string> = {
  "秦皇岛": "河北", "保定": "河北", "唐山": "河北",
  "宁波": "浙江", "温州": "浙江", "金华": "浙江",
  "开封": "河南", "洛阳": "河南", "新乡": "河南",
  "湘潭": "湖南", "衡阳": "湖南",
  "雅安": "四川", "绵阳": "四川",
  "延吉": "吉林",
  "石河子": "新疆", "克拉玛依": "新疆",
  "无锡": "江苏", "徐州": "江苏", "扬州": "江苏",
  "佛山": "广东", "东莞": "广东", "珠海": "广东",
  "烟台": "山东", "威海": "山东",
  "西安": "陕西",
  "桂林": "广西", "柳州": "广西",
  "三亚": "海南",
  "遵义": "贵州",
  "大理": "云南",
  "芜湖": "安徽",
  "泰安": "山东",
  "临汾": "山西",
  "咸阳": "陕西"
};

// School-name overrides for schools whose physical city ≠ administrative province
// (e.g. 河北工业大学 in 天津, 西藏民族大学 in 咸阳, 华北电力(保定) etc).
const SCHOOL_PROVINCE_OVERRIDE: Record<string, string> = {
  "河北工业大学": "河北",
  "西藏民族大学": "西藏",
  "华北电力大学(保定)": "河北",
  "中国海洋大学": "山东",
  "山东大学(威海)": "山东",
  "哈尔滨工业大学(威海)": "山东",
  "哈尔滨工业大学(深圳)": "广东",
  "北京师范大学(珠海校区)": "广东",
  "中山大学珠海校区": "广东"
};

export function employmentCoverageByProvince(): Record<string, { covered: number; schools: string[] }> {
  const f = loadEmploymentOutcomes();
  const out: Record<string, { covered: number; schools: string[] }> = {};
  for (const s of (f.schools || [])) {
    const override = SCHOOL_PROVINCE_OVERRIDE[s.school];
    const city = s.city;
    const cityRec = (loadCityTier().cities || []).find((c: any) => c.city === city);
    const prov = override ?? cityRec?.province ?? CITY_TO_PROVINCE_FALLBACK[city] ?? city ?? "未知";
    if (!out[prov]) out[prov] = { covered: 0, schools: [] };
    out[prov].covered++;
    out[prov].schools.push(s.school);
  }
  return out;
}
