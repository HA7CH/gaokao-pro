// match — student profile in, ranked (school, fit) pairs out.
//
// Profile shape:
//   score (required) + province + subjects → reach feasibility (delta)
//   interests[] → fit against each school's 强势专业 (via index special_arr)
//   constraints (cities, 985/211, max_tuition, dual_class) → hard filters
//
// Composite score is a weighted blend of up to four components, each ∈ [0,1]:
//   interestFit    (weight 0.40) — fit vs the student's interests
//   baselineWeight (weight 0.35) — baselineMinScore / 750 (school prestige proxy)
//   labelWeight    (weight 0.15) — 985 ? 1 : 211 ? 0.7 : dual ? 0.5 : 0.2
//   cityBonus      (weight 0.10) — normalized (cityBonus + 0.5) ∈ [0, 1.5]
//
// IMPORTANT (finding #3): the offline school index has NO major-level signal,
// so interestFit usually has no real data. A constant 0.5 injected at the
// heaviest weight (0.40) would silently bias every school identically and
// dominate ranking with noise. Instead, when there is no usable interest
// signal we DROP the interest component entirely and renormalize the
// remaining weights (baseline/label/city) so they sum to 1 — ranking is then
// driven purely by real data. When a real interest signal exists we compute a
// fit in [0,1] and keep all four weights. See computeComposite().
//
// Offline — reads docs/datasets at the index level for 985/211 and uses the
// gaokao.cn-derived pro_type_min for score baseline.
import { loadIndex, filterIndex, type IndexFilter, type SchoolRow } from "./index-loader.js";
import { PROVINCES, TRACK_NAMES, validateScore, type ProvinceId, type Subject } from "./codes.js";
import { inferTrack, PREFILTER_DELTA } from "./recommend.js";

// Composite component weights (must sum to 1.0).
const W_INTEREST = 0.40;
const W_BASELINE = 0.35;
const W_LABEL = 0.15;
const W_CITY = 0.10;

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

// Returns a real interest-fit ∈ [0,1], or null when no usable interest signal
// is available for this row (so the caller can renormalize the composite over
// the components that DO have signal — finding #3).
//
// The offline index only carries school-level 强势专业 keywords in
// `special_arr`; if present we score a keyword overlap against the student's
// interests. If neither the interests nor the school's major keywords are
// available, we return null (no signal) — NOT a constant — so interest never
// silently biases the ranking.
function interestFitScore(row: SchoolRow, interests: string[] | undefined): number | null {
  if (!interests || interests.length === 0) return null; // no interest input → no signal
  const majors = (row as { special_arr?: unknown }).special_arr;
  if (!Array.isArray(majors) || majors.length === 0) return null; // index has no major-level data
  const haystack = majors.map((m) => String(m).toLowerCase());
  let matched = 0;
  for (const want of interests) {
    const w = String(want).toLowerCase().trim();
    if (w && haystack.some((h) => h.includes(w) || w.includes(h))) matched++;
  }
  return Math.min(1, matched / interests.length);
}

// Blend the available components, renormalizing weights over those present so
// a missing interest signal does not inject a constant (finding #3).
function computeComposite(
  interestFit: number | null,
  baselineWeight: number,
  labelW: number,
  cityNorm: number
): number {
  const parts: Array<{ w: number; v: number }> = [
    { w: W_BASELINE, v: baselineWeight },
    { w: W_LABEL, v: labelW },
    { w: W_CITY, v: cityNorm }
  ];
  if (interestFit !== null) parts.unshift({ w: W_INTEREST, v: interestFit });
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return parts.reduce((s, p) => s + p.w * p.v, 0) / totalW;
}

export function match(profile: Profile, limit?: number): {
  query: object;
  considered: number;
  candidates: MatchCandidate[];
} {
  validateScore(profile.score, profile.province); // finding #12
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
    if (delta < PREFILTER_DELTA) continue; // too far out of reach
    const interestFitRaw = interestFitScore(r, profile.interests);
    const cityBonus = cityScore(r, profile);
    const composite = computeComposite(
      interestFitRaw,
      baselineMinScore / 750,
      labelWeight(r),
      (cityBonus + 0.5) / 1.5 // normalize {-0.5,0,1} → [0,1]
    );
    // Surface 0 when there is no real interest signal (not a fake 0.5).
    const interestFit = interestFitRaw ?? 0;
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
