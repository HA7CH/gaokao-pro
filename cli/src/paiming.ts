// paiming — aggregate ranking presentation for one school across 5 sources:
//   软科 (Shanghai Ranking), QS World, US News, 校友会 (Cuaa), 第四轮学科评估.
// 22 of the 100 candidate-validator agents asked "this school's overall rank" —
// this verb gives Claude a single call that pulls all five into one view.
import { getSchoolInfo } from "./gaokao-cn.js";
import { loadIndex } from "./index-loader.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = dirname(__filename);

function loadXuekePinggu(): Record<string, { a_plus_count: number; a_plus_subjects: string[] }> {
  const candidates = [
    resolve(SRC_DIR, "..", "data", "datasets", "xueke-pinggu-disculun.json"),
    resolve(SRC_DIR, "..", "..", "data", "datasets", "xueke-pinggu-disculun.json")
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      disclosed_schools: Array<{ school: string; a_plus_count: number; a_plus_subjects: string[] }>;
    };
    const out: Record<string, { a_plus_count: number; a_plus_subjects: string[] }> = {};
    for (const s of raw.disclosed_schools ?? []) {
      out[s.school] = { a_plus_count: s.a_plus_count, a_plus_subjects: s.a_plus_subjects };
    }
    return out;
  }
  return {};
}

let xuekeCache: Record<string, { a_plus_count: number; a_plus_subjects: string[] }> | null = null;

export type PaimingOutput = {
  schoolId: number | string;
  name: string;
  zsCode: string;
  rankings: {
    ruanke: string | null;          // 软科中国大学排名
    xyh: string | null;             // 校友会
    qsWorld: string | null;
    usNews: string | null;
    tws_china: string | null;       // 泰晤士中国
  };
  xueke_pinggu_round4: {
    a_plus: string | null;
    a: string | null;
    a_minus: string | null;
    b_plus: string | null;
    b: string | null;
    b_minus: string | null;
    c_plus: string | null;
    c: string | null;
    c_minus: string | null;
  };
  xueke_pinggu_round5_disclosed: {
    a_plus_count: number;
    a_plus_subjects: string[];
  } | null;
  national_first_class_count?: number;
};

export async function paiming(schoolQuery: string): Promise<PaimingOutput> {
  if (!xuekeCache) xuekeCache = loadXuekePinggu();
  const index = loadIndex();
  const row = index.rows.find((r) => r.zs_code === schoolQuery)
    ?? index.rows.find((r) => r.gaokao_cn_id === Number(schoolQuery))
    ?? index.rows.find((r) => r.name.includes(schoolQuery));
  if (!row) throw new Error(`no school matched "${schoolQuery}"`);

  const info = await getSchoolInfo(row.gaokao_cn_id);
  const rank = (info.rank ?? {}) as Record<string, string | undefined>;
  const xueke = (info.xueke_pinggu ?? info.xueke_rank ?? {}) as Record<string, string>;

  return {
    schoolId: row.gaokao_cn_id,
    name: row.name,
    zsCode: row.zs_code,
    rankings: {
      ruanke: rank.ruanke_rank && rank.ruanke_rank !== "0" ? String(rank.ruanke_rank) : null,
      xyh: rank.xyh_rank && rank.xyh_rank !== "0" ? String(rank.xyh_rank) : null,
      qsWorld: rank.qs_world && rank.qs_world !== "0" ? String(rank.qs_world) : null,
      usNews: rank.us_rank && rank.us_rank !== "0" ? String(rank.us_rank) : null,
      tws_china: rank.tws_china && rank.tws_china !== "0" ? String(rank.tws_china) : null
    },
    xueke_pinggu_round4: {
      a_plus: xueke["A+"] ?? null,
      a: xueke["A"] ?? null,
      a_minus: xueke["A-"] ?? null,
      b_plus: xueke["B+"] ?? null,
      b: xueke["B"] ?? null,
      b_minus: xueke["B-"] ?? null,
      c_plus: xueke["C+"] ?? null,
      c: xueke["C"] ?? null,
      c_minus: xueke["C-"] ?? null
    },
    xueke_pinggu_round5_disclosed: xuekeCache?.[row.name] ?? null
  };
}
