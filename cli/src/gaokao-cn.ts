// Client for static-data.gaokao.cn — the 中国教育在线 "掌上高考" static JSON tier.
// No auth, no sign, no rate limit observed. Treat it like a public CDN.

const BASE = "https://static-data.gaokao.cn/www/2.0";
const UA = "gaokao-pro/0.0.1 (+https://github.com/HA7CH/gaokao-pro)";

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`gaokao.cn ${res.status} ${res.statusText} for ${url}`);
  }
  const body = (await res.json()) as { code: string; message: string; data: T };
  if (body.code !== "0000") {
    throw new Error(`gaokao.cn returned code=${body.code} message=${body.message} for ${url}`);
  }
  return body.data;
}

// ---- Schema (a representative subset — many fields omitted for clarity) ----

export type SchoolInfo = {
  school_id: string;
  name: string;
  zs_code: string;             // 教育部 5-digit standard code (e.g. "10001")
  belong: string;              // 隶属 e.g. "教育部"
  province_name: string;
  city_name: string;
  town_name: string;
  level_name: string;          // 本科 / 专科
  type_name: string;           // 综合类 / 理工类 / ...
  nature_name: string;         // 公办 / 民办 / 中外合作办学
  dual_class_name: string;     // 双一流 / -
  f985: string; f211: string;  // "1" if yes, "2" if no
  rank: Record<string, string>;
  xueke_rank: Record<string, string>; // 第四轮学科评估 e.g. {"A+":"21","A":"11",...}
  xueke_pinggu?: Record<string, string>;
  pro_type_min: Record<string, Array<{ year: number; type: Record<string, string> }>>;
  // ^^ This is the gold field. Keyed by province_id; each entry has historical min scores per track.
  province_score_year: string;
  content: string;             // school intro snippet
  site: string;
  phone: string;
  address: string;
};

export type AdmissionPlanItem = {
  school_id: string;
  special_id: string;
  province: string;            // province id as string
  year?: string;
  type: string;                // track code (see TRACK_NAMES)
  zslx: string;                // 招生类型 (普通类/中外合作办学/...)
  zslx_name: string;
  batch: string;
  local_batch_name: string;    // 本科一批 / 本科批 / 提前批 / ...
  num: number;                 // 计划人数
  length: string;              // 学制 (四年/五年/...)
  tuition: string;             // 学费 (元/年)
  spcode: string;              // 6-digit 专业代码 (e.g. "080901")
  spname: string;              // full 专业名 (may include 备注 like "(智能信息处理方向)")
  sp_name: string;             // short 专业名
  info: string;                // 备注 e.g. "(国政、外交学、国际政经)"
  remark: string;
  level1_name: string;         // 本科(普通)
  level2_name: string;         // 学科门类 e.g. "工学"
  level3_name: string;         // 专业类 e.g. "计算机类"
  special_group: string;       // "0" if no group; otherwise group id (新高考 院校专业组)
  // Selected-subject requirement fields. Old-gaokao provinces leave these blank.
  sp_xuanke: string;           // single-major selected-subject requirement (raw)
  sp_fxk: string;              // 首选科目 (物理/历史 in 3+1+2)
  sp_sxk: string;              // 再选科目要求 (e.g. 化学;生物 任选1)
  sp_info: string;
  sg_xuanke: string;           // group-level variants of the same fields
  sg_fxk: string;
  sg_sxk: string;
  sg_info: string;
  sg_name: string;
  first_km: string;
};

export type AdmissionPlanResponse = {
  // The top-level keys look like "<level1>_<batch>_<other>" e.g. "2_7_0".
  // Each bucket has { numFound, item: AdmissionPlanItem[] }.
  [bucket: string]: {
    numFound: number;
    item: AdmissionPlanItem[];
  };
};

// Backward-looking actual admission outcomes (per-major).
// Distinct from AdmissionPlanItem (forward-looking — what's being offered).
export type AdmissionScoreItem = {
  school_id: string;
  special_id: string;
  province: string;
  type: string;                // track code
  zslx: string;
  zslx_name: string;
  batch: string;
  local_batch_name: string;
  spcode?: string;             // 6-digit 专业代码 (may be omitted/blank for 大类招生)
  spname: string;
  sp_name: string;
  info: string;
  remark: string;
  level1_name: string;
  level2_name: string;
  level3_name: string;
  special_group: string;
  // Outcome fields:
  max: number;                 // 最高分
  min: number;                 // 最低分
  average: number;             // 平均分
  lq_num: string;              // 实际录取人数
  min_section: string;         // 最低位次 (sometimes "-" for old-gaokao years)
  min_range: string;           // 分数段范围
  min_rank_range: string;      // 位次段范围
  range_max_rank: string;
  is_score_range: string;
  diff: number;                // 分差 (vs batch line)
  // Same xuanke / sg_* fields as plan items
  first_km: string;
  sp_type: string;
  sp_fxk: string;
  sp_sxk: string;
  sp_info: string;
  sp_xuanke: string;
  sg_fxk: string;
  sg_sxk: string;
  sg_type: string;
  sg_name: string;
  sg_info: string;
  sg_xuanke: string;
};

export type AdmissionScoreResponse = {
  // Bucket keys here look like "<type>_<batch>_<groupId>" e.g. "2074_14_156551".
  [bucket: string]: {
    numFound: number;
    item: AdmissionScoreItem[];
  };
};

// ---- Client ----

export async function getSchoolInfo(schoolId: number | string): Promise<SchoolInfo> {
  return fetchJson<SchoolInfo>(`/school/${schoolId}/info.json`);
}

export async function getAdmissionPlan(
  schoolId: number | string,
  year: number,
  provinceId: number | string
): Promise<AdmissionPlanItem[]> {
  const raw = await fetchJson<AdmissionPlanResponse>(
    `/schoolspecialplan/${schoolId}/${year}/${provinceId}.json`
  );
  // Flatten all buckets into a single array.
  return Object.values(raw).flatMap((bucket) => bucket?.item ?? []);
}

export async function getAdmissionScores(
  schoolId: number | string,
  year: number,
  provinceId: number | string
): Promise<AdmissionScoreItem[]> {
  const raw = await fetchJson<AdmissionScoreResponse>(
    `/schoolspecialscore/${schoolId}/${year}/${provinceId}.json`
  );
  return Object.values(raw).flatMap((bucket) => bucket?.item ?? []);
}

// Convenience: historical min-score series for a given (school, province).
// Returns [{ year, track, minScore }] sorted by year descending.
export function extractHistoricalScores(
  info: SchoolInfo,
  provinceId: number | string
): Array<{ year: number; track: string; trackName: string; minScore: number }> {
  const entries = info.pro_type_min?.[String(provinceId)] ?? [];
  const out: Array<{ year: number; track: string; trackName: string; minScore: number }> = [];
  for (const e of entries) {
    for (const [track, score] of Object.entries(e.type ?? {})) {
      const min = Number(score);
      if (Number.isFinite(min) && min > 0) {
        out.push({
          year: e.year,
          track,
          trackName: track,
          minScore: min
        });
      }
    }
  }
  return out.sort((a, b) => b.year - a.year || a.track.localeCompare(b.track));
}
