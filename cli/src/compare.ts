// compare — side-by-side comparison of two schools across all surface dimensions.
//
// Pulls from the local school-index (for rank/labels/historical scores) and the
// schools-adapters dataset (for 招生网/special programs). No network.
//
// 22 of the 100 candidate-validator agents drafted "A vs B" questions; this
// verb gives Claude a single call that returns everything those questions need.
import { loadIndex, type SchoolRow } from "./index-loader.js";
import { findSchoolAdapter, type SchoolAdapter } from "./datasets.js";
import { PROVINCES, TRACK_NAMES, type ProvinceId } from "./codes.js";
import { resolveAlias } from "./aliases.js";

export type CompareSide = {
  name: string;
  zsCode: string;
  province: string;
  city: string;
  belong: string;
  labels: string[];                  // ["985", "211", "双一流"]
  rank: {
    ruanke: string | null;           // 软科中国大学排名
    qsWorld: string | null;
    usNews: string | null;
    xyh: string | null;              // 校友会
  };
  xuekePinggu: Record<string, string>; // 第四轮学科评估 counts {"A+":"21",...}
  recentMinScores: Record<string, Array<{ year: number; track: string; min: number }>>;
  zswUrl: string | null;
  programs: SchoolAdapter["programs"] | null;
  contact: SchoolAdapter["contact"] | null;
};

export type CompareOutput = {
  a: CompareSide;
  b: CompareSide;
  diff: {
    labels: { only_a: string[]; only_b: string[]; both: string[] };
    ruanke_rank_delta: number | null;
    province_score_delta?: Record<string, number>;
  };
};

function findSchool(rows: SchoolRow[], query: string): SchoolRow | undefined {
  const canonical = resolveAlias(query);
  // exact alias → exact name match
  if (canonical !== query) {
    const exact = rows.find((r) => r.name === canonical);
    if (exact) return exact;
  }
  // exact zs_code
  const byCode = rows.find((r) => r.zs_code === query);
  if (byCode) return byCode;
  // exact name
  const byExact = rows.find((r) => r.name === query);
  if (byExact) return byExact;
  // substring, prefer shortest name
  const substr = rows.filter((r) => r.name.includes(query)).sort((a, b) => a.name.length - b.name.length);
  return substr[0];
}

function buildSide(query: string, focusProvince?: ProvinceId): CompareSide {
  const index = loadIndex();
  const row = findSchool(index.rows, query);
  if (!row) throw new Error(`no school matched "${query}". Try the full Chinese name or zs_code; supported aliases: 清华/北大/复旦/上交/浙大/南大/中科大/哈工大/西交/人大/北航/北理/...`);
  const adapter = findSchoolAdapter(row.zs_code) ?? findSchoolAdapter(row.name);

  const labels: string[] = [];
  if (row.f985) labels.push("985");
  if (row.f211) labels.push("211");
  if (row.dual_class === "双一流") labels.push("双一流");

  const rank = {
    ruanke: null as string | null,
    qsWorld: null as string | null,
    usNews: null as string | null,
    xyh: null as string | null
  };

  // recent min scores: if focusProvince supplied, only that province; else top 5 provinces.
  const recentMinScores: Record<string, Array<{ year: number; track: string; min: number }>> = {};
  const provincesToShow = focusProvince ? [String(focusProvince)] : ["11", "31", "44", "41", "37"];
  for (const provId of provincesToShow) {
    const entries = row.pro_type_min?.[provId] ?? [];
    const flat: Array<{ year: number; track: string; min: number }> = [];
    for (const e of entries) {
      for (const [t, v] of Object.entries(e.type ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          flat.push({ year: e.year, track: TRACK_NAMES[t] ?? t, min: n });
        }
      }
    }
    if (flat.length > 0) {
      flat.sort((x, y) => y.year - x.year);
      const provName = PROVINCES[Number(provId) as ProvinceId]?.name ?? provId;
      recentMinScores[provName] = flat.slice(0, 6);
    }
  }

  return {
    name: row.name,
    zsCode: row.zs_code,
    province: row.province,
    city: row.city,
    belong: row.belong,
    labels,
    rank,
    xuekePinggu: {},
    recentMinScores,
    zswUrl: adapter?.zsw_url ?? null,
    programs: adapter?.programs ?? null,
    contact: adapter?.contact ?? null
  };
}

export function compare(
  queryA: string,
  queryB: string,
  focusProvince?: ProvinceId
): CompareOutput {
  const a = buildSide(queryA, focusProvince);
  const b = buildSide(queryB, focusProvince);
  const labelsA = new Set(a.labels);
  const labelsB = new Set(b.labels);
  const both = a.labels.filter((l) => labelsB.has(l));
  const onlyA = a.labels.filter((l) => !labelsB.has(l));
  const onlyB = b.labels.filter((l) => !labelsA.has(l));

  // Province-score delta (latest matching year per shown province)
  const provinceScoreDelta: Record<string, number> = {};
  for (const prov of Object.keys(a.recentMinScores)) {
    const aLatest = a.recentMinScores[prov]?.[0];
    const bLatest = b.recentMinScores[prov]?.[0];
    if (aLatest && bLatest && aLatest.track === bLatest.track && aLatest.year === bLatest.year) {
      provinceScoreDelta[prov] = aLatest.min - bLatest.min;
    }
  }

  return {
    a,
    b,
    diff: {
      labels: { only_a: onlyA, only_b: onlyB, both },
      ruanke_rank_delta: null,
      province_score_delta: provinceScoreDelta
    }
  };
}
