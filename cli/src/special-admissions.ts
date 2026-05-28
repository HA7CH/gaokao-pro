// Loader + query helpers for the special-admissions datasets.
//
// Files live at cli/data/datasets/special-admissions/{category}-{year}.json
// Each file is shaped as `SpecialAdmissionsDataset` from ./types/special-admissions.ts
//
// Scribe agents in Ralph Loop iter 3 populate the JSON files from the
// docs/special-admissions-3year/*.md sources. If a file is missing or empty,
// loaders return [] (not null) so CLI commands can still respond with
// "no data available — see docs/special-admissions-3year/<region>.md".

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ArtFormulaRecord,
  SportsFormulaRecord,
  QiangjiQuotaRecord,
  ZongPingRecord,
  MinzuPolicyRecord,
  QATWChannelRecord,
  RegionId,
  Year,
  ArtCategory,
  QATWChannelType,
  SpecialAdmissionsDataset
} from "./types/special-admissions.js";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = dirname(__filename);

const CANDIDATE_DIRS = [
  resolve(SRC_DIR, "..", "data", "datasets", "special-admissions"),
  resolve(SRC_DIR, "..", "..", "data", "datasets", "special-admissions")
];

function findDir(): string | null {
  for (const d of CANDIDATE_DIRS) {
    if (existsSync(d)) return d;
  }
  return null;
}

function loadDataset<T>(category: string, year: Year): T[] {
  const dir = findDir();
  if (!dir) return [];
  const path = resolve(dir, `${category}-${year}.json`);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SpecialAdmissionsDataset;
    return (parsed.records as T[]) ?? [];
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Art unified exam
// ───────────────────────────────────────────────────────────────────────────

export function getArtFormulas(year: Year): ArtFormulaRecord[] {
  return loadDataset<ArtFormulaRecord>("art-formula", year);
}

export function findArtFormula(
  region: RegionId,
  category: ArtCategory,
  year: Year
): ArtFormulaRecord | null {
  const all = getArtFormulas(year);
  return (
    all.find((r) => r.region_id === region && r.category === category) ?? null
  );
}

export function listArtFormulasForRegion(
  region: RegionId,
  year: Year
): ArtFormulaRecord[] {
  return getArtFormulas(year).filter((r) => r.region_id === region);
}

// ───────────────────────────────────────────────────────────────────────────
// Sports unified admission
// ───────────────────────────────────────────────────────────────────────────

export function getSportsFormulas(year: Year): SportsFormulaRecord[] {
  return loadDataset<SportsFormulaRecord>("sports-formula", year);
}

export function findSportsFormula(
  region: RegionId,
  year: Year
): SportsFormulaRecord | null {
  return getSportsFormulas(year).find((r) => r.region_id === region) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Qiangji quota
// ───────────────────────────────────────────────────────────────────────────

export function getQiangjiQuotas(year: Year): QiangjiQuotaRecord[] {
  return loadDataset<QiangjiQuotaRecord>("qiangji-quota", year);
}

export function findQiangjiQuota(
  schoolName: string,
  region: RegionId,
  year: Year
): QiangjiQuotaRecord | null {
  return (
    getQiangjiQuotas(year).find(
      (r) =>
        r.region_id === region &&
        (r.school.name_zh === schoolName ||
          r.school.zs_code === schoolName)
    ) ?? null
  );
}

export function listQiangjiForRegion(
  region: RegionId,
  year: Year
): QiangjiQuotaRecord[] {
  return getQiangjiQuotas(year).filter((r) => r.region_id === region);
}

export function listQiangjiForSchool(
  schoolName: string,
  year: Year
): QiangjiQuotaRecord[] {
  return getQiangjiQuotas(year).filter(
    (r) => r.school.name_zh === schoolName || r.school.zs_code === schoolName
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Zongping (综合评价)
// ───────────────────────────────────────────────────────────────────────────

export function getZongPings(year: Year): ZongPingRecord[] {
  return loadDataset<ZongPingRecord>("zongping", year);
}

export function listZongPingForRegion(
  region: RegionId,
  year: Year
): ZongPingRecord[] {
  return getZongPings(year).filter((r) => r.region_id === region);
}

export function findZongPing(
  schoolName: string,
  region: RegionId,
  year: Year
): ZongPingRecord | null {
  return (
    getZongPings(year).find(
      (r) =>
        r.region_id === region &&
        (r.school.name_zh === schoolName || r.school.zs_code === schoolName)
    ) ?? null
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Minzu policy
// ───────────────────────────────────────────────────────────────────────────

export function getMinzuPolicies(year: Year): MinzuPolicyRecord[] {
  return loadDataset<MinzuPolicyRecord>("minzu-policy", year);
}

export function findMinzuPolicy(
  region: RegionId,
  year: Year
): MinzuPolicyRecord | null {
  return getMinzuPolicies(year).find((r) => r.region_id === region) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Port-Macau-Taiwan channels
// ───────────────────────────────────────────────────────────────────────────

export function getQATWChannels(year: Year): QATWChannelRecord[] {
  return loadDataset<QATWChannelRecord>("qatw-channel", year);
}

export function listQATWForRegion(
  region: 71 | 81 | 82,
  year: Year
): QATWChannelRecord[] {
  return getQATWChannels(year).filter((r) => r.region_id === region);
}

export function findQATWChannel(
  region: 71 | 81 | 82,
  channel: QATWChannelType,
  year: Year
): QATWChannelRecord | null {
  return (
    getQATWChannels(year).find(
      (r) => r.region_id === region && r.channel === channel
    ) ?? null
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Coverage report — used by selftest / health check
// ───────────────────────────────────────────────────────────────────────────

export interface CoverageStats {
  category: string;
  year: Year;
  record_count: number;
  region_coverage: number; // distinct regions present
}

export function coverageReport(): CoverageStats[] {
  const years: Year[] = [2023, 2024, 2025];
  const categories = [
    "art-formula",
    "sports-formula",
    "qiangji-quota",
    "zongping",
    "minzu-policy",
    "qatw-channel"
  ];
  const out: CoverageStats[] = [];
  for (const c of categories) {
    for (const y of years) {
      const records = loadDataset<{ region_id: number }>(c, y);
      const regions = new Set(records.map((r) => r.region_id));
      out.push({
        category: c,
        year: y,
        record_count: records.length,
        region_coverage: regions.size
      });
    }
  }
  return out;
}
