// roadmap — full 志愿 plan generator combining recommend + paths + slip-risk.
//
// Takes a candidate profile (score, province, subjects, optional rank +
// minority/rural/serve/sport flags) and returns:
//   1) 冲/稳/保 picks from `recommend` (top-N schools per bucket)
//   2) For each recommend pick that's in college-groups, attach groups + slip-risk
//   3) All 提前批/综评 paths from `paths` (alternatives outside the普通批)
//   4) Province 滑档 rules summary up front
//
// One call → "here's the picture" — replaces juggling recommend / slip-risk /
// paths / huadang manually. Parents see picks + their risk + alternative
// routes all in one place.
import { recommend, type RecommendCandidate } from "./recommend.js";
import { findUniversity, slipRisk, provinceTiaojiInfo, type SlipRiskResult, type ProvinceTiaojiInfo } from "./groups.js";
import { paths as pathsFn, type ProfileLite, type PathsResult } from "./paths.js";
import { resolveProvince, type ProvinceId, type Subject } from "./codes.js";

export type RoadmapInput = {
  province: string;
  score: number;
  rank?: number | null;
  subjects: Subject[];
  per_bucket?: number;            // how many picks per 冲/稳/保 bucket (default 5)
  minority?: boolean;
  rural?: boolean;
  serve?: boolean;
  sport_tier?: string | null;
  sport_name?: string | null;
  language?: string | null;
};

export type SchoolPickWithRisk = {
  name: string;
  delta: number;
  baselineMinScore: number;
  baselineYear: number;
  city: string;
  is985: boolean;
  is211: boolean;
  dualClass: string;
  in_groups_dataset: boolean;
  // If in groups dataset, surface per-province group count + first-group slip-risk.
  groups_in_province: number | null;
  representative_slip_risk: {
    group_code: string;
    verdict: SlipRiskResult["verdict"];
    score_gap: number | null;
    reasons_count: number;
    precedent_count: number;
  } | null;
};

export type RoadmapResult = {
  query: {
    province: string;
    score: number;
    rank: number | null;
    subjects: Subject[];
  };
  province_rules: ProvinceTiaojiInfo;
  buckets: {
    "冲": SchoolPickWithRisk[];
    "稳": SchoolPickWithRisk[];
    "保": SchoolPickWithRisk[];
  };
  paths_summary: {
    total_eligible: number;
    by_category: Record<string, number>;
    top_eligible: PathsResult["pathways"];   // up to 10 eligible items
  };
  caveats: string[];
};

function pickRepresentativeRisk(
  uniName: string,
  provinceName: string,
  candidateScore: number,
  candidateRank: number | null
): SchoolPickWithRisk["representative_slip_risk"] {
  const u = findUniversity(uniName);
  if (!u) return null;
  const province = u.provinces.find((p) => p.province === provinceName);
  if (!province) return null;
  // Pick the group with the lowest min_score the candidate is closest to.
  // Falls back to the first group if no min_scores.
  const groupsWithScore = province.groups.filter((g) => typeof g.group_min_score === "number");
  const target = groupsWithScore.length > 0
    ? groupsWithScore.reduce<typeof groupsWithScore[number]>((acc, g) => {
        const gap = candidateScore - (g.group_min_score as number);
        const accGap = candidateScore - (acc.group_min_score as number);
        // prefer smallest non-negative gap (closest to fence); else use largest
        if (gap >= 0 && (accGap < 0 || gap < accGap)) return g;
        return acc;
      }, groupsWithScore[0])
    : province.groups[0];
  if (!target || !target.group_code) return null;
  try {
    const risk = slipRisk({
      uniName,
      provinceName,
      groupCode: target.group_code,
      candidateScore,
      candidateRank,
    });
    return {
      group_code: target.group_code,
      verdict: risk.verdict,
      score_gap: risk.score_gap,
      reasons_count: risk.reasons.length,
      precedent_count: risk.precedents.length,
    };
  } catch {
    return null;
  }
}

function enrich(c: RecommendCandidate, provinceName: string, candidateScore: number, candidateRank: number | null): SchoolPickWithRisk {
  const u = findUniversity(c.name);
  const inDataset = !!u;
  const provinceObj = u?.provinces.find((p) => p.province === provinceName);
  return {
    name: c.name,
    delta: c.delta,
    baselineMinScore: c.baselineMinScore,
    baselineYear: c.baselineYear,
    city: c.city,
    is985: c.is985,
    is211: c.is211,
    dualClass: c.dualClass,
    in_groups_dataset: inDataset,
    groups_in_province: provinceObj?.groups_count ?? null,
    representative_slip_risk: pickRepresentativeRisk(c.name, provinceName, candidateScore, candidateRank),
  };
}

export function roadmap(input: RoadmapInput): RoadmapResult {
  const provinceId = resolveProvince(input.province);
  if (!provinceId) throw new Error(`unknown province: ${input.province}`);
  // The `recommend` verb expects ProvinceId. Resolve and re-stringify the canonical name for downstream.
  const rules = provinceTiaojiInfo(input.province);
  const perBucket = input.per_bucket ?? 5;

  // 1) Recommend (offline; uses school-index dataset)
  const rec = recommend({
    score: input.score,
    provinceId: provinceId as ProvinceId,
    subjects: input.subjects,
    rank: input.rank ?? undefined,
    limit: perBucket * 4,
  });

  // Pick top-N per bucket and enrich with groups + slip-risk.
  const enrichedChong = rec.buckets["冲"].slice(0, perBucket).map((c) => enrich(c, input.province, input.score, input.rank ?? null));
  const enrichedWen  = rec.buckets["稳"].slice(0, perBucket).map((c) => enrich(c, input.province, input.score, input.rank ?? null));
  const enrichedBao  = rec.buckets["保"].slice(0, perBucket).map((c) => enrich(c, input.province, input.score, input.rank ?? null));

  // 2) paths summary (提前批/综评/运动队 alternatives)
  const profile: ProfileLite = {
    province: input.province,
    score: input.score,
    rank: input.rank ?? null,
    is_minority: input.minority === true,
    is_rural_county: input.rural === true,
    agree_to_serve: input.serve === true,
    sport_tier: input.sport_tier ?? null,
    sport_name: input.sport_name ?? null,
    small_language: input.language ?? null,
    school_filter: null,
  };
  const pathsResult = pathsFn(profile);
  const by_category: Record<string, number> = {};
  for (const [cat, s] of Object.entries(pathsResult.summary_by_category)) {
    by_category[cat] = s.eligible;
  }
  const top_eligible = pathsResult.pathways.filter((p) => p.eligible).slice(0, 10);

  // 3) Caveats summary line
  const caveats: string[] = [];
  if (rules.has_tiaoji === false) {
    caveats.push(`${input.province} 本科批 无服从调剂兜底 — 冲档 miss = 直接滑档，务必梯度精准 + 用足志愿位数`);
  }
  if (input.rank == null) {
    caveats.push("未提供 rank — 新高考省份强烈建议补齐 (gaokao-pro rank --province ... --score 可查)");
  }
  if (input.score && rules.reform?.includes("首届")) {
    caveats.push(`${input.province} 是新高考首届，历史数据参考价值低 — 建议放宽稳保比例`);
  }

  return {
    query: {
      province: input.province,
      score: input.score,
      rank: input.rank ?? null,
      subjects: input.subjects,
    },
    province_rules: rules,
    buckets: {
      "冲": enrichedChong,
      "稳": enrichedWen,
      "保": enrichedBao,
    },
    paths_summary: {
      total_eligible: pathsResult.total_eligible,
      by_category,
      top_eligible,
    },
    caveats,
  };
}
