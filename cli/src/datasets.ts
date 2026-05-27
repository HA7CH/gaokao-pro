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

// ---- Caches ----

let schoolsCache: SchoolsAdaptersFile | null = null;
let provincesCache: ProvincesSpecialtyFile | null = null;

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
