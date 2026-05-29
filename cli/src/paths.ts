// paths — "what programs can my kid actually apply for?" composite query.
//
// Takes a ProfileLite (score, rank, province, optional minority/rural/sport
// flags) and aggregates ALL pathways across the project's curated datasets:
//
//   1) 提前批 catalog (tiqian-pi-programs-2025): 公费师范 / 优师 / 综评 /
//      三位一体 / 中外合作综评 / 国家专项 / 高校专项 / 公安 / 军校 /
//      农村订单医学 / 航海 / 小语种 / 民族班 / 预科
//   2) 综评 by-school (zonghepingjia-2026): per-school 综评 in candidate's province
//   3) 高水平运动队 (gaoshui-yundongdui-2025): if sport_tier provided
//   4) 强基/综评 校测 (xiaoce-detail-2025): 校测 detail for matched schools
//   5) Per-province 滑档 rules (zhiyuan-rules-2026): 调剂 / 单位 / 策略
//
// This is the parent-facing "all-paths" summary. It does NOT score or rank;
// it lists everything the kid is potentially eligible for, with `eligible`
// + `caveat` annotations so the parent can decide.
import {
  listTiqianProgramsByProvince,
  listZongheSchoolsByProvince,
  loadGaoshuiYundongdui2025,
  findXiaoceDetailBySchool,
  type TiqianProgram,
  type ZongheSchool2026,
  type GaoshuiSchool2025
} from "./datasets.js";
import { provinceTiaojiInfo, type ProvinceTiaojiInfo } from "./groups.js";

export type ProfileLite = {
  province: string;          // 中文省名, e.g. "广东"
  score: number | null;      // 高考总分 (optional but recommended)
  rank: number | null;       // 全省位次 (optional)
  is_minority: boolean;      // 少数民族 → 民族班/预科班 eligibility
  is_rural_county: boolean;  // 户籍/学籍在 832 县 → 国家/高校专项 eligibility
  agree_to_serve: boolean;   // 愿意签 6 年服务期 → 公费师范/优师/农村医学
  sport_tier: string | null; // 体育等级: 一级运动员/运动健将/null
  sport_name: string | null; // 项目名, e.g. "游泳"
  small_language: string | null; // 第一外语非英语 → 小语种提前批
};

export type PathwayCategory =
  | "提前批" | "综评" | "强基" | "高水平运动队" | "本科批";

export type Pathway = {
  category: PathwayCategory;
  program_type: string | null;
  school: string;
  zs_code: string | null;
  eligible: boolean;
  caveat: string | null;
  details: Record<string, unknown>;
};

export type PathsResult = {
  province: string;
  province_rules: ProvinceTiaojiInfo;
  profile: ProfileLite;
  total_eligible: number;
  total_caveat: number;
  pathways: Pathway[];
  summary_by_category: Record<string, { eligible: number; caveat: number }>;
};

// ---- Eligibility helpers ----

function tiqianEligible(p: TiqianProgram, profile: ProfileLite): { eligible: boolean; caveat: string | null } {
  const t = p.program_type;
  if (t === "公费师范生" || t === "优师计划") {
    if (!profile.agree_to_serve) return { eligible: false, caveat: "需签 ≥6 年服务期 (本档关闭)" };
    return { eligible: true, caveat: "服务期 ≥6 年；违约金=学费+生活费+50%" };
  }
  if (t === "国家专项" || t === "高校专项" || t === "地方专项") {
    if (!profile.is_rural_county) return { eligible: false, caveat: "需 户籍+学籍 3+3 年在 832 县" };
    return { eligible: true, caveat: "户籍/学籍核验严格" };
  }
  if (t === "民族班" || t === "预科班") {
    if (!profile.is_minority) return { eligible: false, caveat: "限少数民族身份" };
    return { eligible: true, caveat: t === "预科班" ? "1 年预科后分流" : "毕业证与普通班一致" };
  }
  if (t === "小语种提前批") {
    if (!profile.small_language) return { eligible: false, caveat: "限非英语第一外语考生" };
    return { eligible: true, caveat: "部分校口试；优先级在普通批前" };
  }
  if (t === "公安院校" || t === "军校") {
    return { eligible: true, caveat: "政审 + 体检 + 体测 + 面试" };
  }
  if (t === "农村订单医学") {
    if (!profile.is_rural_county || !profile.agree_to_serve) return { eligible: false, caveat: "需 农村户籍 + 6 年定向服务" };
    return { eligible: true, caveat: "定向县级及以下医院 6 年" };
  }
  if (t === "航海类") {
    return { eligible: true, caveat: "视力航海≥4.8 / 轮机≥4.6；色觉正常" };
  }
  if (t === "综评提前批" || t === "三位一体" || t === "中外合作综评") {
    return { eligible: true, caveat: "需初审 + 校测；分数门槛 ≥ 一本/特控" };
  }
  return { eligible: true, caveat: null };
}

function zongpingEligible(_s: ZongheSchool2026, _profile: ProfileLite): { eligible: boolean; caveat: string | null } {
  return { eligible: true, caveat: "需初审 + 校测；分数门槛通常 ≥ 一本/特控" };
}

function gaoshuiEligible(s: GaoshuiSchool2025, profile: ProfileLite): { eligible: boolean; caveat: string | null } {
  if (!profile.sport_tier) return { eligible: false, caveat: "需体育等级证书 (一级/健将)" };
  const need = (s.sports || []).filter((sp) => !profile.sport_name || sp.name.includes(profile.sport_name));
  if (need.length === 0) return { eligible: false, caveat: `该校未招收 ${profile.sport_name ?? "此项目"}` };
  const tierOk = need.some((sp) => {
    if (!sp.tier_required) return true;
    const t = profile.sport_tier!;
    return sp.tier_required.includes(t) || (t === "运动健将" || t === "健将");
  });
  if (!tierOk) return { eligible: false, caveat: "需 一级运动员 (或健将走单考)" };
  return { eligible: true, caveat: "post-2024 reform: 文化课 + 校测/单考" };
}

// ---- Main composer ----

export function paths(profile: ProfileLite): PathsResult {
  const rules = provinceTiaojiInfo(profile.province);
  const pathways: Pathway[] = [];

  // 1) 提前批 catalog
  for (const p of listTiqianProgramsByProvince(profile.province)) {
    const { eligible, caveat } = tiqianEligible(p, profile);
    pathways.push({
      category: "提前批",
      program_type: p.program_type,
      school: p.school,
      zs_code: p.zs_code,
      eligible,
      caveat,
      details: {
        scope_note: p.scope_note,
        majors: p.majors?.slice(0, 6) ?? [],
        plan_count: p.plan_count_2025,
        commitment: p.commitment,
        url: p.url
      }
    });
  }

  // 2) 综评 by-school for the province
  for (const s of listZongheSchoolsByProvince(profile.province)) {
    const { eligible, caveat } = zongpingEligible(s, profile);
    const xiaoce = findXiaoceDetailBySchool(s.school);
    pathways.push({
      category: "综评",
      program_type: "综合评价",
      school: s.school,
      zs_code: s.zs_code,
      eligible,
      caveat,
      details: {
        ratio: s.ratio,
        seats: s.seats,
        校测含: s["校测含"],
        notes: s.notes,
        校测_笔试: xiaoce?.zongping?.校测_笔试 ?? null,
        校测_面试: xiaoce?.zongping?.校测_面试 ?? null,
        报名窗口: xiaoce?.zongping?.报名窗口 ?? null
      }
    });
  }

  // 3) 强基 校测 detail (province-agnostic — 强基 limit-report 1 school)
  // List schools where the user has xiaoce 强基 detail.
  // We don't loop the whole 强基 list here; instead let the user query xiaoce
  // by-school per-school. Surface top-tier in summary only.
  // (Intentional: paths is a province-filtered view; 强基 is national.)

  // 4) 高水平运动队 if sport tier provided
  if (profile.sport_tier) {
    const gaoshui = loadGaoshuiYundongdui2025();
    for (const s of gaoshui.schools) {
      const { eligible, caveat } = gaoshuiEligible(s, profile);
      if (!eligible && !profile.sport_name) continue;  // skip schools with no relevant sport when no filter
      const matchedSports = (s.sports || []).filter((sp) => !profile.sport_name || sp.name.includes(profile.sport_name));
      if (matchedSports.length === 0) continue;
      pathways.push({
        category: "高水平运动队",
        program_type: matchedSports.map((sp) => sp.name).join("、"),
        school: s.school,
        zs_code: s.zs_code,
        eligible,
        caveat,
        details: {
          sports: matchedSports.map((sp) => ({
            name: sp.name,
            tier_required: sp.tier_required,
            exam_window: sp.exam_window,
            score_path: sp.score_path
          }))
        }
      });
    }
  }

  // ---- Summary ----
  const summary_by_category: Record<string, { eligible: number; caveat: number }> = {};
  let total_eligible = 0;
  let total_caveat = 0;
  for (const p of pathways) {
    const cat = p.category;
    if (!summary_by_category[cat]) summary_by_category[cat] = { eligible: 0, caveat: 0 };
    if (p.eligible) {
      summary_by_category[cat].eligible++;
      total_eligible++;
    }
    if (p.caveat) {
      summary_by_category[cat].caveat++;
      total_caveat++;
    }
  }

  return {
    province: profile.province,
    province_rules: rules,
    profile,
    total_eligible,
    total_caveat,
    pathways,
    summary_by_category
  };
}
