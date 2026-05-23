// recommend — given (score, province, subjects, candidate schools),
// bucket each candidate into 冲 / 稳 / 保 based on historical minimum-score deltas.
//
// Algorithm is intentionally transparent (no opaque model):
//   delta = userScore - schoolMinScore(latest matching year)
//   bucket =
//     delta >= +15 → '保'  (safety — well above last year's cutoff)
//     -5 <= delta < +15 → '稳'  (stable match)
//     -25 <= delta < -5 → '冲'  (reach)
//     delta < -25 → out of range
//
// The reach/match/safety thresholds are heuristics — adjust later from
// real outcome data. For now we surface the raw delta so the caller can
// override.
import { getSchoolInfo, extractHistoricalScores, type SchoolInfo } from "./gaokao-cn.js";
import { PROVINCES, TRACK_NAMES, type ProvinceId, type Subject } from "./codes.js";

export type Bucket = "保" | "稳" | "冲" | "out";

export type RecommendInput = {
  score: number;
  provinceId: ProvinceId;
  subjects: Subject[];
  rank?: number;
  schoolIds: Array<number | string>;
};

export type RecommendCandidate = {
  schoolId: string;
  zsCode: string;
  name: string;
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
  series: Array<{ year: number; track: string; trackName: string; minScore: number }>;
};

export type RecommendOutput = {
  query: {
    score: number;
    province: { id: ProvinceId; name: string; reform: string };
    subjects: Subject[];
    track: string;
    trackName: string;
    rank?: number;
  };
  buckets: {
    "保": RecommendCandidate[];
    "稳": RecommendCandidate[];
    "冲": RecommendCandidate[];
    out: RecommendCandidate[];
    skipped: Array<{ schoolId: string; reason: string }>;
  };
};

// Map a (province reform, subjects) combo to the gaokao.cn `type` track code.
export function inferTrack(provinceId: ProvinceId, subjects: Subject[]): string {
  const reform = PROVINCES[provinceId].reform;
  if (reform === "3+3") return "3";
  if (reform === "3+1+2") {
    if (subjects.includes("物理")) return "2073";
    if (subjects.includes("历史")) return "2074";
    throw new Error("3+1+2 provinces require either 物理 or 历史 in --subjects");
  }
  // Old gaokao: subjects 物理/化学/生物 → 理 (1); 历史/政治/地理 → 文 (2).
  const sciCount = subjects.filter((s) => ["物理", "化学", "生物"].includes(s)).length;
  const libCount = subjects.filter((s) => ["历史", "政治", "地理"].includes(s)).length;
  return sciCount >= libCount ? "1" : "2";
}

function bucketOf(delta: number): Bucket {
  if (delta >= 15) return "保";
  if (delta >= -5) return "稳";
  if (delta >= -25) return "冲";
  return "out";
}

function evaluate(
  info: SchoolInfo,
  provinceId: ProvinceId,
  track: string,
  userScore: number
): { candidate?: RecommendCandidate; skipped?: { schoolId: string; reason: string } } {
  const series = extractHistoricalScores(info, provinceId);
  const matching = series.filter((s) => s.track === track);
  if (matching.length === 0) {
    return {
      skipped: {
        schoolId: info.school_id,
        reason: `no historical data for track ${track} (${TRACK_NAMES[track] ?? track}) in province ${provinceId}`
      }
    };
  }
  const baseline = matching[0]; // most recent year (series is sorted desc)
  const delta = userScore - baseline.minScore;
  return {
    candidate: {
      schoolId: info.school_id,
      zsCode: info.zs_code,
      name: info.name,
      belong: info.belong,
      is985: info.f985 === "1",
      is211: info.f211 === "1",
      dualClass: info.dual_class_name,
      baselineYear: baseline.year,
      baselineMinScore: baseline.minScore,
      baselineTrack: baseline.track,
      baselineTrackName: TRACK_NAMES[baseline.track] ?? baseline.track,
      delta,
      bucket: bucketOf(delta),
      series: series.map((s) => ({ ...s, trackName: TRACK_NAMES[s.track] ?? s.track }))
    }
  };
}

export async function recommend(input: RecommendInput): Promise<RecommendOutput> {
  const track = inferTrack(input.provinceId, input.subjects);
  const province = PROVINCES[input.provinceId];

  const results = await Promise.all(
    input.schoolIds.map(async (id) => {
      try {
        const info = await getSchoolInfo(id);
        return evaluate(info, input.provinceId, track, input.score);
      } catch (err) {
        return {
          skipped: {
            schoolId: String(id),
            reason: err instanceof Error ? err.message : String(err)
          }
        };
      }
    })
  );

  const buckets = { "保": [], "稳": [], "冲": [], out: [] } as Record<Bucket, RecommendCandidate[]>;
  const skipped: Array<{ schoolId: string; reason: string }> = [];
  for (const r of results) {
    if (r.candidate) buckets[r.candidate.bucket].push(r.candidate);
    if (r.skipped) skipped.push(r.skipped);
  }
  // Sort each bucket by delta — for 冲 ascending (closest first), others descending.
  buckets["冲"].sort((a, b) => b.delta - a.delta);
  buckets["稳"].sort((a, b) => b.delta - a.delta);
  buckets["保"].sort((a, b) => b.delta - a.delta);
  buckets.out.sort((a, b) => b.delta - a.delta);

  return {
    query: {
      score: input.score,
      province: { id: input.provinceId, name: province.name, reform: province.reform },
      subjects: input.subjects,
      track,
      trackName: TRACK_NAMES[track] ?? track,
      rank: input.rank
    },
    buckets: { ...buckets, skipped }
  };
}
