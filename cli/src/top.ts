// top — "the best schools this score can reach in this province".
// Same data pipeline as recommend; different presentation: top-N within
// reach (delta >= some floor), sorted by baselineMinScore desc.
import { loadIndex, filterIndex, type IndexFilter, type SchoolRow } from "./index-loader.js";
import { PROVINCES, TRACK_NAMES, validateScore, type ProvinceId, type Subject } from "./codes.js";
import { inferTrack, REACH_DELTA } from "./recommend.js";

export type TopInput = {
  score: number;
  provinceId: ProvinceId;
  subjects: Subject[];
  limit?: number;
  filter?: IndexFilter;
  minDelta?: number;   // floor on delta (default REACH_DELTA, i.e. require within reach)
};

export type TopRow = {
  schoolId: number;
  zsCode: string;
  name: string;
  province: string;
  city: string;
  belong: string;
  is985: boolean;
  is211: boolean;
  dualClass: string;
  baselineYear: number;
  baselineMinScore: number;
  baselineTrackName: string;
  delta: number;
};

export function top(input: TopInput): { query: object; rows: TopRow[] } {
  validateScore(input.score, input.provinceId); // finding #12
  const index = loadIndex();
  let rows: SchoolRow[] = index.rows;
  if (input.filter) rows = filterIndex({ generated_at: index.generated_at, rows }, input.filter);
  const track = inferTrack(input.provinceId, input.subjects);
  const minDelta = input.minDelta ?? REACH_DELTA;

  const out: TopRow[] = [];
  for (const r of rows) {
    const entries = r.pro_type_min?.[String(input.provinceId)] ?? [];
    if (entries.length === 0) continue;
    const sorted = [...entries].sort((a, b) => b.year - a.year);
    let pick: { year: number; min: number } | null = null;
    for (const e of sorted) {
      const v = e.type?.[track];
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          pick = { year: e.year, min: n };
          break;
        }
      }
    }
    if (!pick) continue;
    const delta = input.score - pick.min;
    if (delta < minDelta) continue;
    out.push({
      schoolId: r.gaokao_cn_id,
      zsCode: r.zs_code,
      name: r.name,
      province: r.province,
      city: r.city,
      belong: r.belong,
      is985: r.f985,
      is211: r.f211,
      dualClass: r.dual_class,
      baselineYear: pick.year,
      baselineMinScore: pick.min,
      baselineTrackName: TRACK_NAMES[track] ?? track,
      delta
    });
  }

  // Sort by baseline min score desc — "best schools you can reach"
  out.sort((a, b) => b.baselineMinScore - a.baselineMinScore || a.delta - b.delta);
  const limited = input.limit && input.limit > 0 ? out.slice(0, input.limit) : out;
  return {
    query: {
      score: input.score,
      province: PROVINCES[input.provinceId].name,
      subjects: input.subjects,
      track: TRACK_NAMES[track] ?? track,
      filter: input.filter,
      minDelta
    },
    rows: limited
  };
}
