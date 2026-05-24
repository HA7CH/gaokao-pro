// match — student profile in, ranked (school, fit) pairs out.
//
// Profile shape:
//   score (required) + province + subjects → reach feasibility (delta)
//   interests[] → fit against each school's 强势专业 (via index special_arr)
//   constraints (cities, 985/211, max_tuition, dual_class) → hard filters
//
// Composite score = 0.4 × interestFit + 0.35 × baselineWeight + 0.15 × labelWeight + 0.10 × cityBonus
// where interestFit ∈ [0,1], baselineWeight = baselineMinScore / 750 (normalized),
// labelWeight = 985 ? 1 : 211 ? 0.7 : dual ? 0.5 : 0.2, cityBonus ∈ {-0.5, 0, +1}.
//
// Offline — reads docs/datasets at the index level for 985/211 and uses the
// gaokao.cn-derived pro_type_min for score baseline.
import { loadIndex, filterIndex, type IndexFilter, type SchoolRow } from "./index-loader.js";
import { PROVINCES, TRACK_NAMES, type ProvinceId, type Subject } from "./codes.js";
import { inferTrack } from "./recommend.js";

export type Profile = {
  score: number;
  province: ProvinceId;
  subjects: Subject[];
  rank?: number;
  interests?: string[];
  constraints?: {
    cities_preferred?: string[];
    cities_avoid?: string[];
    require_985?: boolean;
    require_211?: boolean;
    require_dual_class?: boolean;
    belong?: string;
    max_tuition_yuan?: number;
  };
};

export type MatchCandidate = {
  schoolId: number;
  zsCode: string;
  name: string;
  city: string;
  province: string;
  belong: string;
  is985: boolean;
  is211: boolean;
  dualClass: string;
  baselineYear: number;
  baselineMinScore: number;
  delta: number;
  interestFit: number;
  cityBonus: number;
  composite: number;
  rationale: string;
};

function labelWeight(r: SchoolRow): number {
  if (r.f985) return 1.0;
  if (r.f211) return 0.7;
  if (r.dual_class === "双一流") return 0.5;
  return 0.2;
}

function cityScore(r: SchoolRow, profile: Profile): number {
  const c = profile.constraints;
  if (!c) return 0;
  const city = r.city;
  if (c.cities_preferred?.some((p) => city.includes(p) || r.province.includes(p))) return 1;
  if (c.cities_avoid?.some((p) => city.includes(p) || r.province.includes(p))) return -0.5;
  return 0;
}

function interestFitScore(_row: SchoolRow, interests: string[] | undefined): number {
  if (!interests || interests.length === 0) return 0.5; // neutral if no signal
  // School index doesn't currently embed major-level signal; we'd need to fetch
  // the plan endpoint per school for high-fidelity matching. For the offline
  // fast path, return a neutral 0.5; future enrichment can wire in
  // schoolspecialscore data.
  return 0.5;
}

export function match(profile: Profile, limit?: number): {
  query: object;
  considered: number;
  candidates: MatchCandidate[];
} {
  const index = loadIndex();
  const c = profile.constraints ?? {};
  const filter: IndexFilter = {
    f985: c.require_985 ? true : undefined,
    f211: c.require_211 ? true : undefined,
    dualClass: c.require_dual_class ? true : undefined,
    belong: c.belong
  };
  let rows = filterIndex(index, filter);
  const track = inferTrack(profile.province, profile.subjects);

  const candidates: MatchCandidate[] = [];
  for (const r of rows) {
    const entries = r.pro_type_min?.[String(profile.province)] ?? [];
    if (!entries.length) continue;
    const sorted = [...entries].sort((a, b) => b.year - a.year);
    let baselineYear = 0;
    let baselineMinScore = 0;
    for (const e of sorted) {
      const v = e.type?.[track];
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n) && n > 0) {
        baselineYear = e.year;
        baselineMinScore = n;
        break;
      }
    }
    if (!baselineMinScore) continue;
    const delta = profile.score - baselineMinScore;
    if (delta < -40) continue; // too far out of reach
    const interestFit = interestFitScore(r, profile.interests);
    const cityBonus = cityScore(r, profile);
    const composite =
      0.4 * interestFit +
      0.35 * (baselineMinScore / 750) +
      0.15 * labelWeight(r) +
      0.10 * (cityBonus + 0.5); // shift to [0, 1.5]
    const tags = [r.f985 ? "985" : r.f211 ? "211" : r.dual_class === "双一流" ? "双一流" : ""].filter(Boolean).join(" ");
    candidates.push({
      schoolId: r.gaokao_cn_id,
      zsCode: r.zs_code,
      name: r.name,
      city: r.city,
      province: r.province,
      belong: r.belong,
      is985: r.f985,
      is211: r.f211,
      dualClass: r.dual_class,
      baselineYear,
      baselineMinScore,
      delta,
      interestFit,
      cityBonus,
      composite,
      rationale: `${tags} · ${r.belong} · ${baselineYear}基线${baselineMinScore} (${delta >= 0 ? "+" : ""}${delta}) · 综合${composite.toFixed(2)}`
    });
  }

  candidates.sort((a, b) => b.composite - a.composite);

  return {
    query: {
      score: profile.score,
      province: PROVINCES[profile.province].name,
      subjects: profile.subjects,
      track: TRACK_NAMES[track] ?? track,
      interests: profile.interests,
      constraints: profile.constraints
    },
    considered: rows.length,
    candidates: limit && limit > 0 ? candidates.slice(0, limit) : candidates
  };
}
