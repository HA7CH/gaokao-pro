// recommend-major — interest keyword in, ranked majors out, each with the
// schools that recruit it in the user's province. Inverse of `recommend`
// (which is school-centric).
//
// Pipeline:
//   1. Filter index to schools the user can plausibly reach (delta ≥
//      PREFILTER_DELTA — a deliberately permissive net before the expensive
//      per-school fetch).
//   2. For each, fetch plan/{schoolId}/{year}/{province}.json (concurrent).
//   3. Match the keyword against sp_name / spname / level3_name.
//   4. Group hits by spcode, sort by (schools count desc, top school baseline desc).
//
// "reachable" uses the shared REACH_DELTA so it means the same thing as a 冲
// bucket in recommend.ts (finding #14).
import { loadIndex, type IndexFilter, filterIndex } from "./index-loader.js";
import { getAdmissionPlan, type AdmissionPlanItem } from "./gaokao-cn.js";
import { PROVINCES, TRACK_NAMES, validateScore, type ProvinceId, type Subject } from "./codes.js";
import { inferTrack, REACH_DELTA, PREFILTER_DELTA } from "./recommend.js";
import { xuankeMatch } from "./xuanke.js";

export type RecommendMajorInput = {
  keyword: string;
  score: number;
  provinceId: ProvinceId;
  subjects: Subject[];
  year: number;
  filter?: IndexFilter;
  limit?: number;
  concurrency?: number;
};

export type MajorMatch = {
  spcode: string;
  sp_name: string;
  level3_name: string;
  schools_count: number;
  reachable_count: number;
  schools: Array<{
    schoolId: number;
    name: string;
    city: string;
    is985: boolean;
    is211: boolean;
    baselineMinScore: number;
    delta: number;
    reachable: boolean;
    track: string;
    // 选科 selectability for this (school, major) given the student's subjects
    // (finding #2). Defaults true when the major has no requirement data.
    xuankeOk: boolean;
    xuankeReason: string;
  }>;
};

export async function recommendMajor(input: RecommendMajorInput): Promise<{
  query: object;
  schools_skipped_errors: number;
  majors_matched: MajorMatch[];
}> {
  validateScore(input.score, input.provinceId); // finding #12
  const index = loadIndex();
  const track = inferTrack(input.provinceId, input.subjects);
  let rows = input.filter ? filterIndex(index, input.filter) : index.rows;

  // Only keep schools with a feasible-ish historical baseline in this province + track.
  const reachableRows = rows.filter((r) => {
    const entries = r.pro_type_min?.[String(input.provinceId)] ?? [];
    if (!entries.length) return false;
    const sorted = [...entries].sort((a, b) => b.year - a.year);
    for (const e of sorted) {
      const v = e.type?.[track];
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n) && n > 0 && input.score - n >= PREFILTER_DELTA) return true;
    }
    return false;
  });

  const keyword = input.keyword.toLowerCase();
  const matchHit = (item: AdmissionPlanItem) =>
    item.sp_name?.toLowerCase().includes(keyword) ||
    item.spname?.toLowerCase().includes(keyword) ||
    item.level3_name?.toLowerCase().includes(keyword) ||
    item.spcode?.toLowerCase().includes(keyword);

  type Hit = {
    spcode: string;
    sp_name: string;
    level3_name: string;
    school: MajorMatch["schools"][number];
  };
  const hits: Hit[] = [];
  const concurrency = input.concurrency ?? 12;
  let cursor = 0;
  let fetchErrors = 0; // finding #10: count failed fetches instead of dropping silently
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < reachableRows.length) {
        const r = reachableRows[cursor++];
        if (!r) break;
        try {
          const plan = await getAdmissionPlan(r.gaokao_cn_id, input.year, input.provinceId);
          // Most-recent baseline for this row + track
          const entries = r.pro_type_min[String(input.provinceId)];
          const sorted = [...entries].sort((a, b) => b.year - a.year);
          let baseline = 0;
          for (const e of sorted) {
            const v = e.type?.[track];
            const n = v ? Number(v) : NaN;
            if (Number.isFinite(n) && n > 0) { baseline = n; break; }
          }
          const delta = input.score - baseline;
          for (const item of plan) {
            if (!matchHit(item)) continue;
            const spcode = item.spcode || `${item.level3_name}-${item.sp_name}`;
            // 选科 check (finding #2): prefer raw code, else fxk/sxk fields.
            const raw = item.sp_xuanke || item.sg_xuanke || "";
            const fields = [item.sp_fxk || item.sg_fxk, item.sp_sxk || item.sg_sxk]
              .filter((s): s is string => !!s);
            const requirement = raw ? raw : fields;
            const hasReq = !!raw || fields.length > 0;
            const xk = hasReq
              ? xuankeMatch(input.subjects, requirement)
              : { ok: true, reason: "不限 (无选科要求)" };
            hits.push({
              spcode,
              sp_name: item.sp_name,
              level3_name: item.level3_name,
              school: {
                schoolId: r.gaokao_cn_id,
                name: r.name,
                city: r.city,
                is985: r.f985,
                is211: r.f211,
                baselineMinScore: baseline,
                delta,
                reachable: delta >= REACH_DELTA, // shared threshold (finding #14)
                track: TRACK_NAMES[track] ?? track,
                xuankeOk: xk.ok,
                xuankeReason: xk.reason
              }
            });
          }
        } catch {
          fetchErrors++; // aggregate, no per-error spam
        }
      }
    })
  );

  // Group by spcode
  const byMajor = new Map<string, MajorMatch>();
  for (const h of hits) {
    const m = byMajor.get(h.spcode) ?? {
      spcode: h.spcode,
      sp_name: h.sp_name,
      level3_name: h.level3_name,
      schools_count: 0,
      reachable_count: 0,
      schools: []
    };
    m.schools.push(h.school);
    m.schools_count++;
    if (h.school.reachable) m.reachable_count++;
    byMajor.set(h.spcode, m);
  }
  const majors = Array.from(byMajor.values());
  for (const m of majors) {
    m.schools.sort((a, b) => b.baselineMinScore - a.baselineMinScore);
  }
  majors.sort((a, b) => b.reachable_count - a.reachable_count || b.schools_count - a.schools_count);

  return {
    query: {
      keyword: input.keyword,
      score: input.score,
      province: PROVINCES[input.provinceId].name,
      year: input.year,
      subjects: input.subjects,
      track: TRACK_NAMES[track] ?? track,
      filter: input.filter
    },
    schools_skipped_errors: fetchErrors,
    majors_matched: input.limit && input.limit > 0 ? majors.slice(0, input.limit) : majors
  };
}
