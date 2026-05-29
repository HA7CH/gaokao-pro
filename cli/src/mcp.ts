// stdio MCP server — `gaokao-pro mcp` exposes the CLI verbs as Model Context
// Protocol tools so Claude Code (or any MCP client) can call them directly.
//
// Wire up:
//   claude mcp add gaokao-pro -- npx -y gaokao-pro mcp
//
// Protocol: JSON-RPC 2.0 over stdio, MCP v2025-06-18 surface.
// Zero external deps — handle the minimal RPC surface ourselves.
import { createInterface } from "node:readline";
import { recommend } from "./recommend.js";
import { top } from "./top.js";
import { find } from "./find.js";
import {
  getSchoolInfo,
  getAdmissionPlan,
  getAdmissionScores,
  extractHistoricalScores
} from "./gaokao-cn.js";
import {
  PROVINCES,
  TRACK_NAMES,
  resolveProvince,
  ALL_SUBJECTS,
  type Subject,
  type ProvinceId
} from "./codes.js";
import {
  loadRankTable,
  listRankTables,
  scoreToRank,
  rankToScore,
  inferDefaultTrack
} from "./rank-table.js";
import { decodeXuanke } from "./xuanke.js";
import { match } from "./match.js";
import { recommendMajor } from "./recommend-major.js";
import { chartCheck } from "./chart-check.js";
import { compare } from "./compare.js";
import { paiming } from "./paiming.js";
import { findEmployment, listEmploymentCoverage } from "./employment.js";
import { findManifest, listManifestProvinces, manifestStats } from "./manifest.js";
import {
  findSchoolAdapter,
  listSchoolsOfferingProgram,
  findProvinceSpecialty,
  listProvinceKeys,
  getCrossProvincePrograms,
  listGaoshuiSchoolsBySport,
  listZongheSchoolsByProvince,
  listTiqianProgramsByProvince,
  listTiqianProgramsByType,
  listTiqianProgramTypes,
  listTiqianProgramsBySchool,
  findXiaoceDetailBySchool,
  findCasesByProvince,
  findCasesByCategory,
  loadHuadangCases,
  findCalendarByProvince,
  loadZhiyuanCalendar2026
} from "./datasets.js";
import { findUniversity, listGroups, safetyScore, datasetStats, slipRisk } from "./groups.js";
import { paths as pathsFn } from "./paths.js";
import { dossier as dossierFn } from "./dossier.js";
import { roadmap as roadmapFn } from "./roadmap.js";
import { VERSION } from "./version.js";

const SERVER_INFO = { name: "gaokao-pro", version: VERSION };
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpc = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function rpcOk(id: number | string | null | undefined, result: unknown): JsonRpc {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcErr(id: number | string | null | undefined, code: number, message: string): JsonRpc {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// ---- Tool definitions ----

const TOOLS = [
  {
    name: "recommend",
    description:
      "Bucket Chinese universities into 冲(reach) / 稳(match) / 保(safety) based on a student's gaokao score, province, and subject combination. Offline (no network). Filters: 985 / 211 / 双一流 / 隶属. Returns up to `limit` schools per bucket.",
    inputSchema: {
      type: "object",
      properties: {
        score: { type: "number", description: "Student's total gaokao score." },
        province: { type: "string", description: "Province name (e.g. '河南', 'henan', or numeric id like 41)." },
        subjects: {
          type: "array",
          items: { type: "string", enum: ALL_SUBJECTS },
          description: "Selected subjects (3+3 provinces: 3 subjects; 3+1+2: must include 物理 OR 历史 + 2 others). Drives track inference."
        },
        rank: { type: "number", description: "Optional: student's 全省排名 (位次). Not used yet for filtering; reserved for future rank-based mode." },
        f985: { type: "boolean", description: "Filter to 985 universities only." },
        f211: { type: "boolean", description: "Filter to 211 universities only." },
        dualClass: { type: "boolean", description: "Filter to 双一流 universities only." },
        belong: { type: "string", description: "Filter by 隶属 (e.g. '教育部', '工信部')." },
        limit: { type: "number", description: "Cap results per bucket (冲/稳/保/out). Default unlimited." }
      },
      required: ["score", "province", "subjects"],
      additionalProperties: false
    }
  },
  {
    name: "top",
    description:
      "Top-N best universities a student's score can reach in a province. Like `recommend` but flat list sorted by historical baseline descending. Use when the user wants 'what are the strongest schools I can realistically get into?'",
    inputSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        province: { type: "string" },
        subjects: { type: "array", items: { type: "string", enum: ALL_SUBJECTS } },
        limit: { type: "number", description: "Default 20." },
        f985: { type: "boolean" },
        f211: { type: "boolean" },
        dualClass: { type: "boolean" }
      },
      required: ["score", "province", "subjects"],
      additionalProperties: false
    }
  },
  {
    name: "find",
    description:
      "Search for a major keyword (e.g. '计算机', '临床医学') across universities recruiting in a specific province for a specific year. Returns schools, plan numbers, 选科 requirements, 学费, batch. Hits gaokao.cn API per candidate school (concurrent).",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Major name fragment." },
        province: { type: "string" },
        year: { type: "number", description: "Recruitment year. 2024 is the latest fully-published year." },
        f985: { type: "boolean" },
        f211: { type: "boolean" },
        dualClass: { type: "boolean" },
        belong: { type: "string" },
        limit: { type: "number" }
      },
      required: ["keyword", "province", "year"],
      additionalProperties: false
    }
  },
  {
    name: "school",
    description:
      "Look up one university's metadata: name, 教育部 code (zs_code), 985/211/双一流 labels, 学科评估 (第四轮) counts, rankings (软科/QS/US News), historical min scores per province per year.",
    inputSchema: {
      type: "object",
      properties: {
        schoolId: { type: "string", description: "gaokao.cn internal school id (e.g. 31 = 北大, 30 = 北工大). NOT the 5-digit 教育部 code." }
      },
      required: ["schoolId"],
      additionalProperties: false
    }
  },
  {
    name: "plan",
    description:
      "Forward-looking admission plan for one (school × year × province): list of majors, 计划人数, 学制, 学费, 批次, 选科要求 (新高考). Use when the user asks 'what does Tsinghua recruit in Henan this year?'",
    inputSchema: {
      type: "object",
      properties: {
        schoolId: { type: "string" },
        year: { type: "number" },
        province: { type: "string" }
      },
      required: ["schoolId", "year", "province"],
      additionalProperties: false
    }
  },
  {
    name: "actual",
    description:
      "Backward-looking ACTUAL admissions per major: 实际最高/最低/平均分, 录取人数, 最低位次 (min_section — only populated for 新高考 provinces). Use this to compare 'what got in last year' vs the user's score/rank.",
    inputSchema: {
      type: "object",
      properties: {
        schoolId: { type: "string" },
        year: { type: "number" },
        province: { type: "string" }
      },
      required: ["schoolId", "year", "province"],
      additionalProperties: false
    }
  },
  {
    name: "scores",
    description:
      "Historical minimum-score time series for a (school × province) pair across all years/tracks gaokao.cn has. Quick way to see the trend without per-major detail.",
    inputSchema: {
      type: "object",
      properties: {
        schoolId: { type: "string" },
        province: { type: "string" }
      },
      required: ["schoolId", "province"],
      additionalProperties: false
    }
  },
  {
    name: "provinces",
    description: "List all 31 supported provinces with their numeric ids, pinyin, and 新高考 reform mode (old / 3+3 / 3+1+2). Useful before calling tools that need a province parameter.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "rank",
    description:
      "Translate between gaokao score and provincial rank (位次) using the official 一分一段表. Pass `score` to get the rank; pass `rank` to get the score that hits that rank. Provinces with ingested data: see `rank_tables` tool first. Use this whenever the user mentions their 位次 — rank-based comparison is much more accurate than raw score across years (since exam difficulty varies).",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string" },
        year: { type: "number" },
        track: { type: "string", enum: ["combined", "physics", "history", "science", "liberal"], description: "'combined' for 3+3 provinces (北京/上海/天津/山东/海南/浙江); 'physics' or 'history' for 3+1+2; 'science'/'liberal' for 老高考. Omit to use the province default." },
        score: { type: "number", description: "If set, return the rank for this score. Pass exactly one of score/rank." },
        rank: { type: "number", description: "If set, return the score that hits this rank. Pass exactly one of score/rank." }
      },
      required: ["province", "year"],
      additionalProperties: false
    }
  },
  {
    name: "rank_tables",
    description: "List the (province, year, track) tuples for which we have ingested 一分一段 data. Call this before `rank` to confirm coverage. Beijing is the proof-of-concept; other provinces are being added incrementally.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "match",
    description: "Take a complete student profile (score + province + subjects + interests + constraints) and return ranked schools with composite fit scores (interest 0.4 + baseline 0.35 + label 0.15 + city 0.10). Use this when the user has given you enough preferences for a holistic plan; for pure score-based reach/match/safety lists use `recommend` instead.",
    inputSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        province: { type: "string" },
        subjects: { type: "array", items: { type: "string", enum: ALL_SUBJECTS } },
        rank: { type: "number" },
        interests: { type: "array", items: { type: "string" } },
        constraints: {
          type: "object",
          properties: {
            cities_preferred: { type: "array", items: { type: "string" } },
            cities_avoid: { type: "array", items: { type: "string" } },
            require_985: { type: "boolean" },
            require_211: { type: "boolean" },
            require_dual_class: { type: "boolean" },
            belong: { type: "string" },
            max_tuition_yuan: { type: "number" }
          },
          additionalProperties: false
        },
        limit: { type: "number" }
      },
      required: ["score", "province", "subjects"],
      additionalProperties: false
    }
  },
  {
    name: "recommend_major",
    description: "Interest-driven inverse of `recommend`: given a major keyword (e.g. '计算机', 'AI', '临床医学'), find which schools in the user's province recruit that major, ranked by how many of them the student's score can reach. Use this when the user starts from a major interest instead of a school.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        score: { type: "number" },
        province: { type: "string" },
        subjects: { type: "array", items: { type: "string", enum: ALL_SUBJECTS } },
        year: { type: "number" },
        f985: { type: "boolean" },
        f211: { type: "boolean" },
        dualClass: { type: "boolean" },
        belong: { type: "string" },
        limit: { type: "number" }
      },
      required: ["keyword", "score", "province", "subjects", "year"],
      additionalProperties: false
    }
  },
  {
    name: "chart_check",
    description: "Sanity-check a student profile before sending it into `match` or `recommend`. Validates score range, 选科 vs 新高考 reform, rank↔score consistency (when 一分一段 data exists). Returns ok/health (0-100) + errors + warnings. ALWAYS call this once after collecting the user's profile.",
    inputSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        rank: { type: "number" },
        province: { type: "string" },
        subjects: { type: "array", items: { type: "string" } },
        year: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "compare",
    description: "Side-by-side comparison of two schools: labels (985/211/双一流), 隶属, recent 5-province minimum scores, 招生网 URL, special-program flags, contact. Aliases accepted: 清华/北大/复旦/上交/浙大/南大/中科大/哈工大/西交/北航/北理/南开/天大/同济/东南/厦大/山大/海大/武大/华科/中南/中山/华工/川大/重大/电子科大/西工大/西农/兰大/湖大/北邮/央财/贸大/上财/上外/华理/上大/西电/南理工/南航/苏大 etc.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "School A: name, alias (e.g. 清华), or zs_code (e.g. 10003)" },
        b: { type: "string", description: "School B (same forms)" },
        province: { type: "string", description: "Optional focus province (only this province's score series in output)." }
      },
      required: ["a", "b"],
      additionalProperties: false
    }
  },
  {
    name: "paiming",
    description: "Aggregate rankings for one school: 软科 (Shanghai), 校友会, QS World, US News, 泰晤士中国 + 第四轮学科评估 (A+/A/A-/B+/B/B-/C+/C/C- counts) + 第五轮 disclosed A+ subjects if available. Use this whenever the user asks about a school's 'rank' / '排名' / '学科评估'.",
    inputSchema: {
      type: "object",
      properties: {
        school: { type: "string", description: "School name, alias, or zs_code" }
      },
      required: ["school"],
      additionalProperties: false
    }
  },
  {
    name: "employment",
    description: "2024届毕业生就业质量报告 关键统计 (本科): 总数, 就业率, 升学率, 国内读研/出国比例, 直接就业率, 平均月薪, top 行业/地域/雇主, 加官方报告 URL. null = 该校未公开. 首批 15 所 985 已入库 (清华/北大/复旦/上交/浙大/南大/中科大/哈工/西交/人大/武大/华科/中山/同济/北航). Use this when the user asks 就业 / 出路 / 升学率 / 薪资 / 去哪了.",
    inputSchema: {
      type: "object",
      properties: {
        school: { type: "string", description: "School name, alias, or zs_code" }
      },
      required: ["school"],
      additionalProperties: false
    }
  },
  {
    name: "employment_list",
    description: "List schools with 就业报告 data in this build (returns name + zs_code + year). Use this if employment(school) returns 'no data' — pick from the available list.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "manifest",
    description: "Look up the authoritative 一分一段表 source URL for a (province, year). 62 records ingested covering 31 省 × {2024, 2025}, with year_verified_from flag showing how the year was checked from the source document. Returns regime (3+3 / 3+1+2 / old), tracks, source_url, source_org, format (html_table | pdf | image | not_published etc.), and notes. Use this when you need the official table URL to verify rank-from-score or grab a PDF.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "Province name (中文 河南), pinyin (henan), or GB code (41)" },
        year: { type: "number", description: "Year, e.g. 2024 or 2025" }
      },
      required: ["province", "year"],
      additionalProperties: false
    }
  },
  {
    name: "manifest_list",
    description: "List all (province, year) 一分一段 manifest records. Optionally filter by year. Returns coverage stats + the records.",
    inputSchema: {
      type: "object",
      properties: { year: { type: "number", description: "Optional year filter" } },
      additionalProperties: false
    }
  },
  {
    name: "xuanke",
    description: "Decode a gaokao.cn selected-subject requirement string (e.g. '70001_70002^70001_70003') into Chinese subject names. Use this whenever you encounter `sp_xuanke` / `sg_xuanke` fields in plan / actual responses.",
    inputSchema: {
      type: "object",
      properties: {
        raw: { type: "string", description: "Raw xuanke string from gaokao.cn payload, e.g. '70001_70002' (physics AND chemistry) or '70008' (no requirement)." }
      },
      required: ["raw"],
      additionalProperties: false
    }
  },
  {
    name: "adapter",
    description: "Look up one school's 招生网 (zsw) URL + special-program offer flags + contact, from the curated schools-adapters dataset (80+ schools). Use this to get a school's official 招生网 link and which special programs (强基/综评/中外合作/专项 etc.) it offers.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "School name, alias, or zs_code (e.g. '清华' or '10003')." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "program",
    description: "List schools offering a specific special-program type. Use this to answer 'which schools offer 强基计划 / 综合评价 / 中外合作 / 专项计划 …?'",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["qiangji", "zonghepingjia", "zhongwai_hezuo", "guojia_zhuanxiang", "gaoxiao_zhuanxiang", "minzu_ban", "yuke_ban", "gao_shui_yundong", "high_art"],
          description: "Program type."
        }
      },
      required: ["type"],
      additionalProperties: false
    }
  },
  {
    name: "tiqian",
    description: "Per-province 提前批 + 强基/综评 in-province implementing schools. Verified provinces: tianjin · zhejiang · hunan · shandong · guangdong. Pass province 'all' to list cross-province programs (国家/高校/地方专项 + 港澳台联招).",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "Province key (tianjin/zhejiang/hunan/shandong/guangdong) or 'all' for cross-province programs." }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "groups",
    description: "专业组 (major-group) lookup for a university. Without a province, returns the per-province coverage summary (groups_count / majors_total). With a province, returns each 专业组 in that province; optionally score each group's safety against must/ok/reject subject-preference lists.",
    inputSchema: {
      type: "object",
      properties: {
        university: { type: "string", description: "University name as it appears in the dataset (e.g. '清华大学')." },
        province: { type: "string", description: "Optional province name. Omit for the per-province coverage summary." },
        must: { type: "array", items: { type: "string" }, description: "Optional: subjects/majors that MUST be present (drives safety scoring; only used when province is set)." },
        ok: { type: "array", items: { type: "string" }, description: "Optional: acceptable subjects/majors (safety scoring)." },
        reject: { type: "array", items: { type: "string" }, description: "Optional: subjects/majors to reject (safety scoring)." }
      },
      required: ["university"],
      additionalProperties: false
    }
  },
  {
    name: "groups_stats",
    description: "Dataset-wide statistics for the 专业组 dataset (coverage counts). Call this to see what the `groups` tool covers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "slip_risk",
    description: "滑档风险评估 — given (university, province, group_code, candidate_score, candidate_rank), combines historical 投档线 with province 调剂 rules (zhiyuan-rules-2026), group major-spread, and optional must/ok/reject preferences. Returns verdict (high_risk / moderate_risk / low_risk / comfortable) + Chinese reasons array. Critical for surfacing 浙江/山东/河北/重庆/辽宁/贵州/青海 (无调剂兜底) cases where 冲档 miss = full slip.",
    inputSchema: {
      type: "object",
      properties: {
        university: { type: "string", description: "中文校名, e.g. '清华大学'" },
        province: { type: "string", description: "中文省名, e.g. '河南'" },
        group_code: { type: "string", description: "专业组代码 (string, since some are alphanumeric)" },
        score: { type: "number", description: "考生高考总分" },
        rank: { type: "number", description: "可选：考生全省位次 (gaokao-pro rank 可查)" },
        year: { type: "number", description: "可选：参考年度 (默认 2025)" },
        must: { type: "array", items: { type: "string" }, description: "可选：必须录到的专业关键词" },
        ok: { type: "array", items: { type: "string" }, description: "可选：可接受的专业关键词" },
        reject: { type: "array", items: { type: "string" }, description: "可选：拒绝的专业关键词 (与 调剂 联动)" }
      },
      required: ["university", "province", "group_code", "score"],
      additionalProperties: false
    }
  },
  {
    name: "tiqian_pi",
    description: "提前批 special-program catalog: 公费师范 / 优师 / 综评 / 三位一体 / 中外合作综评 / 国家专项 / 高校专项 / 公安 / 军校 / 农村订单医学 / 航海 / 小语种 / 民族班 / 预科 — 42 programs across 16+ provinces. Different from `tiqian` (which is province-keyed 提前批 batch rules); this is per-program detail (eligibility / commitment / ratio / url). Filter by province (\"广东\"), type (\"综评提前批\"), or school (\"清华\"). Pass `list_types=true` to enumerate program_type values.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名 (e.g. '广东')." },
        type: { type: "string", description: "可选 program_type 过滤 (e.g. '综评提前批', '公费师范生')" },
        school: { type: "string", description: "可选 学校名 substring (e.g. '清华', '中山大学')." },
        list_types: { type: "boolean", description: "若为 true，返回所有 program_type 值列表 (无视 province/type/school)" }
      },
      additionalProperties: false
    }
  },
  {
    name: "zongping",
    description: "综合评价 2026 by-school — schools open to a given province. Covers UCAS (12省), SUSTech (23省), ShanghaiTech (18省), CUHKSZ, 北外, XJTLU, NYU Shanghai, DKU, plus 沪/苏/浙/鲁/粤 综评校. Returns ratio / 校测 / seats / notes per school.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名, e.g. '广东'" }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "gaoshui_sport",
    description: "高水平运动队 by-sport — schools recruiting a given sport with tier_required / exam_window / score_path / plan_count / notes. Post-2024 reform encoded: 一级运动员 + 文化课本科线 (or 健将+ 单考路径). Useful for 游泳/田径/篮球 etc. specialty applicants.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "运动名称 (e.g. '游泳', '田径', '篮球'). Substring match against sport names." }
      },
      required: ["sport"],
      additionalProperties: false
    }
  },
  {
    name: "xiaoce",
    description: "强基/综评 校测 detail per school (59 schools curated): subjects_offered, 笔试/面试/体测 内容, 录取分配比 (e.g. 85:15), 报名/校测时间窗, 可填学校上限, 签约条款 (转专业/保研路径). Critical for parents weighing the prep-cost vs reward of 强基/综评 校测.",
    inputSchema: {
      type: "object",
      properties: {
        school: { type: "string", description: "中文校名 substring (e.g. '清华', '浙江大学')." }
      },
      required: ["school"],
      additionalProperties: false
    }
  },
  {
    name: "calendar",
    description: "2026 投档时间日历 by-province — exam dates, score release, batch fill/dispatch/release/supplementary windows, key milestones (e.g. 强基报名/综评校测). 31 provinces; 4 confirmed for 2026 (上海/贵州/广西/青海), 27 tentative-based-on-2025 (clearly flagged). Pass list=true to enumerate covered provinces.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名 (required unless list=true)" },
        list: { type: "boolean", description: "若 true 返回所有已覆盖省份列表" }
      },
      additionalProperties: false
    }
  },
  {
    name: "roadmap",
    description: "完整志愿规划 — one-call composite that combines recommend (冲/稳/保 picks) + per-pick slip-risk verdict (with historical precedents) + paths summary (提前批/综评/运动队 alternatives) + province 滑档 rules. Each recommend pick is enriched with whether it's in the college-groups dataset, its representative group's slip-risk verdict + score_gap, and the count of historical 滑档 precedents that match the pattern. Replaces juggling recommend / slip-risk / paths manually. Parents see picks + risk + alternatives in one place.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名 (required)" },
        score: { type: "number", description: "高考总分 (required)" },
        rank: { type: "number", description: "可选: 全省位次" },
        subjects: { type: "array", items: { type: "string" }, description: "选科 list (required), e.g. ['物理', '化学', '生物']" },
        per_bucket: { type: "number", description: "每个 bucket (冲/稳/保) 返回多少校 (默认 5)" },
        minority: { type: "boolean" },
        rural: { type: "boolean" },
        serve: { type: "boolean" },
        sport_tier: { type: "string" },
        sport_name: { type: "string" },
        language: { type: "string" }
      },
      required: ["province", "score", "subjects"],
      additionalProperties: false
    }
  },
  {
    name: "dossier",
    description: "院校 dossier — one-call aggregation across 7 datasets for a single school: 招生网 adapter (URL+contact+program flags) + 院校专业组 summary + 强基/综评 校测 detail (xiaoce) + 综评 by-school (zongping) + 高水平运动队 (gaoshui) + 提前批 programs catalog hits + 涉及该校的滑档历史 (huadang). Each section is independently nullable with a `_status: \"not_in_dataset\"` marker so parents can see 'we tried, no data' instead of guessing. Replaces 6-7 separate verb calls.",
    inputSchema: {
      type: "object",
      properties: {
        school: { type: "string", description: "中文校名 substring (e.g. '清华', '浙江大学'). Substring match across all datasets." }
      },
      required: ["school"],
      additionalProperties: false
    }
  },
  {
    name: "huadang",
    description: "滑档/退档 历史案例 (2022-2025, 45 cases) — by-province or by-category. Concrete past stories (real or composite-flagged) that teach parents *why* the abstract rules in slip-risk matter. Categories include 不勾服从, 选科不符, 单科分数, 体检不符, 身高体能, 外语语种, 国家专项资格, 政审不过, 无调剂兜底, 梯度过密, 小年大年误判, 组内冷热门差大, 新高考首届, 内蒙古旧动态投档. Use list_categories=true to enumerate.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名 (e.g. '河南')." },
        category: { type: "string", description: "可选分类过滤 (e.g. '不勾服从')." },
        list_categories: { type: "boolean", description: "若 true 返回所有 category 值列表." }
      },
      additionalProperties: false
    }
  },
  {
    name: "paths",
    description: "志愿路径全景 — given a province + profile flags (少数民族 / 农村专项 / 服务期同意 / 体育等级 / 第一外语), aggregate ALL pathways in one call: 提前批 catalog (42 programs) + 综评 by-school + 高水平运动队 + 省级 滑档 rules. Each pathway tagged as eligible/ineligible with the precise caveat (服务期 / 户籍/学籍 / 等级证书). Single-shot parent-facing 'what can my kid apply for' summary.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "中文省名 (required), e.g. '广东'." },
        score: { type: "number", description: "可选：高考总分" },
        rank: { type: "number", description: "可选：全省位次" },
        minority: { type: "boolean", description: "是否少数民族 (开启民族班/预科班)" },
        rural: { type: "boolean", description: "户籍/学籍是否在 832 县 (开启国家/高校专项+农村医学)" },
        serve: { type: "boolean", description: "是否同意签 ≥6 年服务期 (开启公费师范+优师+农村医学)" },
        sport_tier: { type: "string", description: "可选：体育等级 ('一级运动员' 或 '运动健将'). 与 sport_name 一起使用启用 高水平运动队 推荐" },
        sport_name: { type: "string", description: "可选：项目名 (e.g. '游泳'). 不传则匹配所有项目" },
        language: { type: "string", description: "可选：第一外语 (非英语) — 开启 小语种提前批" },
        school: { type: "string", description: "可选：学校名 substring (e.g. '清华')，只返回 该学校 的所有路径" }
      },
      required: ["province"],
      additionalProperties: false
    }
  }
];

// ---- Tool dispatchers ----

function getStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`missing or non-string arg: ${key}`);
  return v;
}
function getNum(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v === "number") return v;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`missing or invalid number arg: ${key}`);
  return n;
}
function getProvinceId(args: Record<string, unknown>, key = "province"): ProvinceId {
  const raw = args[key];
  if (raw === undefined || raw === null) throw new Error("province is required");
  const id = resolveProvince(String(raw));
  if (!id) throw new Error(`unknown province: ${raw}`);
  return id;
}
function getSubjects(args: Record<string, unknown>): Subject[] {
  const v = args.subjects;
  if (!Array.isArray(v)) throw new Error("subjects must be an array");
  for (const s of v) {
    if (typeof s !== "string" || !ALL_SUBJECTS.includes(s as Subject)) {
      throw new Error(`invalid subject: ${s}`);
    }
  }
  return v as Subject[];
}
function getFilter(args: Record<string, unknown>) {
  return {
    f985: args.f985 === true ? true : undefined,
    f211: args.f211 === true ? true : undefined,
    dualClass: args.dualClass === true ? true : undefined,
    belong: typeof args.belong === "string" ? (args.belong as string) : undefined
  };
}

async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "recommend": {
      return recommend({
        score: getNum(args, "score"),
        provinceId: getProvinceId(args),
        subjects: getSubjects(args),
        rank: args.rank !== undefined ? Number(args.rank) : undefined,
        filter: getFilter(args),
        limit: args.limit !== undefined ? Number(args.limit) : undefined
      });
    }
    case "top": {
      return top({
        score: getNum(args, "score"),
        provinceId: getProvinceId(args),
        subjects: getSubjects(args),
        limit: args.limit !== undefined ? Number(args.limit) : 20,
        filter: getFilter(args)
      });
    }
    case "find": {
      return find({
        keyword: getStr(args, "keyword"),
        provinceId: getProvinceId(args),
        year: getNum(args, "year"),
        filter: getFilter(args),
        limit: args.limit !== undefined ? Number(args.limit) : undefined
      });
    }
    case "school": {
      const info = await getSchoolInfo(getStr(args, "schoolId"));
      return {
        gaokao_cn_id: info.school_id,
        zs_code: info.zs_code,
        name: info.name,
        belong: info.belong,
        location: `${info.province_name} · ${info.city_name} · ${info.town_name}`,
        level: info.level_name,
        type: info.type_name,
        nature: info.nature_name,
        dual_class: info.dual_class_name,
        f985: info.f985 === "1",
        f211: info.f211 === "1",
        rank: info.rank,
        xueke_rank: info.xueke_rank,
        site: info.site,
        phone: info.phone,
        address: info.address,
        intro: info.content?.slice(0, 280)
      };
    }
    case "plan": {
      const items = await getAdmissionPlan(
        getStr(args, "schoolId"),
        getNum(args, "year"),
        getProvinceId(args)
      );
      return { count: items.length, items };
    }
    case "actual": {
      const items = await getAdmissionScores(
        getStr(args, "schoolId"),
        getNum(args, "year"),
        getProvinceId(args)
      );
      return { count: items.length, items };
    }
    case "scores": {
      const info = await getSchoolInfo(getStr(args, "schoolId"));
      const provinceId = getProvinceId(args);
      const series = extractHistoricalScores(info, provinceId).map((row) => ({
        ...row,
        trackName: TRACK_NAMES[row.track] ?? row.track
      }));
      return { school: info.name, province: PROVINCES[provinceId].name, series };
    }
    case "provinces": {
      return Object.entries(PROVINCES).map(([id, p]) => ({
        id: Number(id),
        name: p.name,
        pinyin: p.pinyin,
        reform: p.reform
      }));
    }
    case "rank": {
      const provinceId = getProvinceId(args);
      const year = getNum(args, "year");
      const track = typeof args.track === "string" ? args.track : inferDefaultTrack(provinceId);
      const hasScore = args.score !== undefined && args.score !== null;
      const hasRank = args.rank !== undefined && args.rank !== null;
      if (hasScore === hasRank) {
        throw new Error("Pass exactly one of `score` or `rank` (not neither, not both).");
      }
      const table = loadRankTable(provinceId, year, track);
      if (!table) {
        throw new Error(`No 一分一段 table for ${PROVINCES[provinceId].name} ${year} ${track}. Call \`rank_tables\` to see what's ingested.`);
      }
      if (hasScore) {
        const score = getNum(args, "score");
        return {
          province: PROVINCES[provinceId].name,
          year,
          track,
          source: table.source,
          score,
          rank: scoreToRank(table, score)
        };
      }
      const rank = getNum(args, "rank");
      return {
        province: PROVINCES[provinceId].name,
        year,
        track,
        source: table.source,
        rank,
        score: rankToScore(table, rank)
      };
    }
    case "rank_tables": {
      return listRankTables();
    }
    case "xuanke": {
      return decodeXuanke(getStr(args, "raw"));
    }
    case "compare": {
      const focusProv = typeof args.province === "string" ? resolveProvince(args.province) ?? undefined : undefined;
      return compare(getStr(args, "a"), getStr(args, "b"), focusProv);
    }
    case "paiming": {
      return await paiming(getStr(args, "school"));
    }
    case "employment": {
      const rec = findEmployment(getStr(args, "school"));
      if (!rec) {
        const hint = listEmploymentCoverage().map((c) => c.school).join(", ");
        return { ok: false, error: `no employment data for "${getStr(args, "school")}". Available: ${hint}` };
      }
      return { ok: true, ...rec };
    }
    case "employment_list": {
      const list = listEmploymentCoverage();
      return { ok: true, count: list.length, schools: list };
    }
    case "manifest": {
      const province = getStr(args, "province");
      const year = getNum(args, "year");
      const rec = findManifest(province, year);
      if (!rec) return { ok: false, error: `no manifest record for province="${province}" year=${year}` };
      return { ok: true, ...rec };
    }
    case "manifest_list": {
      const year = typeof (args as Record<string, unknown>).year !== "undefined" ? Number((args as Record<string, unknown>).year) : undefined;
      const records = listManifestProvinces(year);
      const stats = manifestStats();
      return { ok: true, stats, count: records.length, records };
    }
    case "match": {
      return match({
        score: getNum(args, "score"),
        province: getProvinceId(args),
        subjects: getSubjects(args),
        rank: args.rank !== undefined ? Number(args.rank) : undefined,
        interests: Array.isArray(args.interests) ? (args.interests as string[]) : undefined,
        constraints: (args.constraints ?? undefined) as never
      }, args.limit !== undefined ? Number(args.limit) : 20);
    }
    case "recommend_major": {
      return recommendMajor({
        keyword: getStr(args, "keyword"),
        score: getNum(args, "score"),
        provinceId: getProvinceId(args),
        subjects: getSubjects(args),
        year: getNum(args, "year"),
        filter: getFilter(args),
        limit: args.limit !== undefined ? Number(args.limit) : 20
      });
    }
    case "chart_check": {
      const provinceArg = typeof args.province === "string" ? args.province : undefined;
      const province_id = provinceArg ? resolveProvince(provinceArg) ?? undefined : undefined;
      return chartCheck({
        score: args.score !== undefined ? Number(args.score) : undefined,
        rank: args.rank !== undefined ? Number(args.rank) : undefined,
        province: provinceArg,
        province_id,
        subjects: Array.isArray(args.subjects) ? (args.subjects as string[]) : undefined,
        year: args.year !== undefined ? Number(args.year) : undefined
      });
    }
    case "adapter": {
      const query = getStr(args, "query");
      const adapter = findSchoolAdapter(query);
      if (!adapter) return { ok: false, error: `no adapter for "${query}". Try a different name or zs_code.` };
      return { ok: true, adapter };
    }
    case "program": {
      const type = getStr(args, "type");
      const valid = ["qiangji", "zonghepingjia", "zhongwai_hezuo", "guojia_zhuanxiang", "gaoxiao_zhuanxiang", "minzu_ban", "yuke_ban", "gao_shui_yundong", "high_art"];
      if (!valid.includes(type)) {
        return { ok: false, error: `type must be one of: ${valid.join(", ")}` };
      }
      const schools = listSchoolsOfferingProgram(type as Parameters<typeof listSchoolsOfferingProgram>[0]);
      return {
        ok: true,
        program: type,
        count: schools.length,
        schools: schools.map((s) => ({
          name: s.name,
          zs_code: s.zs_code,
          zsw_url: s.zsw_url,
          detail: type === "gaoxiao_zhuanxiang" ? s.programs.gaoxiao_zhuanxiang : (s.programs[type as keyof typeof s.programs] as unknown)
        }))
      };
    }
    case "tiqian": {
      const province = getStr(args, "province");
      if (province === "all") {
        return { ok: true, cross_province_programs: getCrossProvincePrograms() };
      }
      const data = findProvinceSpecialty(province);
      if (!data) return { ok: false, error: `no specialty plan ingested for ${province}. Available: ${listProvinceKeys().join(", ")}` };
      return { ok: true, ...data };
    }
    case "groups": {
      const uni = getStr(args, "university");
      const province = typeof args.province === "string" ? args.province : null;
      const u = findUniversity(uni);
      if (!u) return { ok: false, error: `university not found in dataset: ${uni}` };
      if (province) {
        const groups = listGroups(uni, province);
        const must = Array.isArray(args.must) ? (args.must as string[]) : [];
        const ok = Array.isArray(args.ok) ? (args.ok as string[]) : [];
        const reject = Array.isArray(args.reject) ? (args.reject as string[]) : [];
        const enrichedGroups = groups.map((g) => {
          const safety = (must.length || ok.length || reject.length) ? safetyScore(g, { must_have: must, acceptable: ok, reject }) : null;
          return { ...g, safety };
        });
        return { ok: true, university: u.university, code: u.code, province, groups: enrichedGroups };
      }
      return {
        ok: true,
        university: u.university,
        code: u.code,
        year: u.year,
        provinces_count: u.provinces.length,
        provinces: u.provinces.map((p) => ({ province: p.province, groups_count: p.groups_count, majors_total: p.majors_total }))
      };
    }
    case "groups_stats": {
      return { ok: true, stats: datasetStats() };
    }
    case "slip_risk": {
      const must = Array.isArray(args.must) ? (args.must as string[]) : [];
      const ok = Array.isArray(args.ok) ? (args.ok as string[]) : [];
      const reject = Array.isArray(args.reject) ? (args.reject as string[]) : [];
      const prefs = (must.length || ok.length || reject.length)
        ? { must_have: must, acceptable: ok, reject } : undefined;
      const result = slipRisk({
        uniName: getStr(args, "university"),
        provinceName: getStr(args, "province"),
        groupCode: getStr(args, "group_code"),
        candidateScore: getNum(args, "score"),
        candidateRank: args.rank !== undefined ? Number(args.rank) : null,
        year: args.year !== undefined ? Number(args.year) : undefined,
        prefs,
      });
      return { ok: true, result };
    }
    case "tiqian_pi": {
      if (args.list_types === true) {
        return { ok: true, types: listTiqianProgramTypes() };
      }
      const province = typeof args.province === "string" ? args.province : null;
      const type = typeof args.type === "string" ? args.type : null;
      const school = typeof args.school === "string" ? args.school : null;
      if (!province && !type && !school) {
        return { ok: false, error: "either province, type, or school (or list_types=true) required" };
      }
      let programs;
      if (school) {
        programs = listTiqianProgramsBySchool(school);
        if (province) programs = programs.filter((p) => (p.eligible_provinces || []).some((e) => e === province || e.startsWith("全国")));
        if (type) programs = programs.filter((p) => p.program_type === type);
      } else if (province) {
        programs = listTiqianProgramsByProvince(province);
        if (type) programs = programs.filter((p) => p.program_type === type);
      } else {
        programs = listTiqianProgramsByType(type as string);
      }
      return { ok: true, query: { province, type, school }, count: programs.length, programs };
    }
    case "zongping": {
      const province = getStr(args, "province");
      const schools = listZongheSchoolsByProvince(province);
      return { ok: true, query: { province }, count: schools.length, schools };
    }
    case "gaoshui_sport": {
      const sport = getStr(args, "sport");
      const schools = listGaoshuiSchoolsBySport(sport);
      return { ok: true, query: { sport }, count: schools.length, schools };
    }
    case "xiaoce": {
      const school = getStr(args, "school");
      const detail = findXiaoceDetailBySchool(school);
      if (!detail) return { ok: false, error: `no xiaoce detail for "${school}". Try '清华' or '浙江大学'.` };
      return { ok: true, ...detail };
    }
    case "calendar": {
      if (args.list === true) {
        const file = loadZhiyuanCalendar2026();
        return { ok: true, count: file.provinces.length, provinces: file.provinces.map((p) => p.province) };
      }
      const province = getStr(args, "province");
      const cal = findCalendarByProvince(province);
      if (!cal) return { ok: false, error: `no 2026 calendar found for ${province}` };
      return { ok: true, ...cal };
    }
    case "roadmap": {
      const province = getStr(args, "province");
      const score = getNum(args, "score");
      const subjects = getSubjects(args);
      const result = roadmapFn({
        province,
        score,
        rank: args.rank !== undefined ? Number(args.rank) : null,
        subjects,
        per_bucket: args.per_bucket !== undefined ? Number(args.per_bucket) : 5,
        minority: args.minority === true,
        rural: args.rural === true,
        serve: args.serve === true,
        sport_tier: typeof args.sport_tier === "string" ? args.sport_tier : null,
        sport_name: typeof args.sport_name === "string" ? args.sport_name : null,
        language: typeof args.language === "string" ? args.language : null,
      });
      return { ok: true, ...result };
    }
    case "dossier": {
      const school = getStr(args, "school");
      return { ok: true, ...dossierFn(school) };
    }
    case "huadang": {
      if (args.list_categories === true) {
        return { ok: true, categories: loadHuadangCases().categories };
      }
      const province = typeof args.province === "string" ? args.province : null;
      const category = typeof args.category === "string" ? args.category : null;
      let cases = province ? findCasesByProvince(province) : loadHuadangCases().cases;
      if (category) cases = cases.filter((c) => c.category === category);
      return { ok: true, query: { province, category }, count: cases.length, cases };
    }
    case "paths": {
      const province = getStr(args, "province");
      const result = pathsFn({
        province,
        score: args.score !== undefined ? Number(args.score) : null,
        rank: args.rank !== undefined ? Number(args.rank) : null,
        is_minority: args.minority === true,
        is_rural_county: args.rural === true,
        agree_to_serve: args.serve === true,
        sport_tier: typeof args.sport_tier === "string" ? args.sport_tier : null,
        sport_name: typeof args.sport_name === "string" ? args.sport_name : null,
        small_language: typeof args.language === "string" ? args.language : null,
        school_filter: typeof args.school === "string" ? args.school : null,
      });
      return { ok: true, ...result };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- Server loop ----

async function handle(req: JsonRpc): Promise<JsonRpc | null> {
  const { id, method, params = {} } = req;
  try {
    switch (method) {
      case "initialize":
        return rpcOk(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        });
      case "initialized":
      case "notifications/initialized":
        return null;
      case "tools/list":
        return rpcOk(id, { tools: TOOLS });
      case "tools/call": {
        const name = params.name as string;
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const result = await dispatch(name, args);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        });
      }
      case "ping":
        return rpcOk(id, {});
      default:
        return rpcErr(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rpcErr(id, -32000, msg);
  }
}

export async function runMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpc;
    try {
      req = JSON.parse(trimmed) as JsonRpc;
    } catch {
      process.stdout.write(JSON.stringify(rpcErr(null, -32700, "Parse error")) + "\n");
      continue;
    }
    const res = await handle(req);
    if (res !== null) {
      process.stdout.write(JSON.stringify(res) + "\n");
    }
  }
}
