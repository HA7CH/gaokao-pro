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
  findArtFormula,
  listArtFormulasForRegion,
  findSportsFormula,
  listQiangjiForRegion,
  findQiangjiQuota,
  listQiangjiForSchool,
  listZongPingForRegion,
  findZongPing,
  findMinzuPolicy,
  listQATWForRegion,
  findQATWChannel,
  coverageReport
} from "./special-admissions.js";
import type { ArtCategory, Year as SAYear, QATWChannelType } from "./types/special-admissions.js";

const SERVER_INFO = { name: "gaokao-pro", version: "0.0.2" };
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
        track: { type: "string", description: "'combined' for 3+3 provinces (北京/上海/天津/山东/海南/浙江); 'physics' or 'history' for 3+1+2; 'science'/'liberal' for 老高考. Omit to use the province default." },
        score: { type: "number", description: "If set, return the rank for this score." },
        rank: { type: "number", description: "If set, return the score that hits this rank." }
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
    name: "art_tongkao",
    description: "Art unified exam (艺术统考) formula + 合格线 for a province × category × year. Covers 6 大类(美术与设计/音乐/舞蹈/表(导)演/播音/书法). Without category, returns all categories for that province/year. Province-specific quirks (河南 5 选 1、云南 2025 取消省线、湖北 ×2 还原、辽宁百分制再加权) captured in formula.extras.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "Name/pinyin/id (11..65). 港澳台 not applicable." },
        category: { type: "string", description: "Optional. One of: 美术与设计/音乐表演-声乐/音乐表演-器乐/音乐教育-声乐/音乐教育-器乐/舞蹈/戏剧影视表演/戏剧影视导演/服装表演/播音与主持/书法/戏曲" },
        year: { type: "number", description: "2023/2024/2025/2026. Default 2025." }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "sports_tongzhao",
    description: "Sports unified admission (体育统招) formula + 合格线 for a province × year. Returns SportsFormulaKind: weighted (most provinces), additive (湖南/青海 直接相加), professional_first (陕西/甘肃 按专业课投档), gaokao_only (海南 按高考总分), merged_specline (重庆 2025 本/专合一 73). Use this to explain a family how 体育生 投档分 is calculated.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string" },
        year: { type: "number", description: "Default 2025." }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "qiangji_line",
    description: "Qiangji (强基计划) quota + 入围线 for a school × province × year. Provide --school (e.g. '清华大学' or zs_code) and/or --province. ruwei_ratio='all' means '报名即入围'(校测前置,复交南模式 + 厦大/北航/兰大/人大/东大 等 12 校). west_75pct_threshold=true 仅 甘肃/青海/宁夏/新疆.",
    inputSchema: {
      type: "object",
      properties: {
        school: { type: "string", description: "School name 或 zs_code. Optional if province set." },
        province: { type: "string", description: "Optional if school set." },
        year: { type: "number", description: "Default 2025." }
      },
      additionalProperties: false
    }
  },
  {
    name: "zonghe",
    description: "Comprehensive evaluation (综合评价) for a province × year. 浙江三位一体 (is_sanweiyiti=true,含学考维度) / 江苏 23 校 A/B 类 / 上海/山东 11 校 85+15 / 广东 11 校 / 北京 7 校外省 / 福建 7 校外省. With --school: single校record. Without: all综评校 for that province/year.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string" },
        school: { type: "string", description: "Optional. Restrict to one校." },
        year: { type: "number", description: "Default 2025." }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "minzu",
    description: "Minority bonus tiers + 民族班/民族预科 policy for a province × year. Captures 加分梯度 (e.g. 甘肃两州五县 +20、广西三统一 +15/+7/+5/+3、新疆单列类 +15、西藏双联户 +10 + 进藏干部 +1/年) and 退坡 schedule (e.g. 江西 2025 取消、福建 2026 取消). Also 民族班降 40 / 预科降 80 等通用门槛.",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string" },
        year: { type: "number", description: "Default 2025." }
      },
      required: ["province"],
      additionalProperties: false
    }
  },
  {
    name: "qatw",
    description: "Port-Macau-Taiwan dual-direction channels. Pass region (71 台湾/81 香港/82 澳门) and optional channel. Channels: 全国联招 / 居住证高考 / 保送生(澳门特有) / DSE互认(香港特有) / 港校招内地生 / 澳校招内地生 / 学测申请陆校(台湾特有) / 陆生申请台校(2020/04/09 起暂停,suspended_since_2020). 联招 2025 暴涨: 本科普通文 430/理 460 (+65/+70 vs 2024).",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "71 / 81 / 82 / 台湾 / 香港 / 澳门" },
        channel: { type: "string", description: "Optional. 8 通道之一" },
        year: { type: "number", description: "Default 2025." }
      },
      required: ["region"],
      additionalProperties: false
    }
  },
  {
    name: "special_coverage",
    description: "Coverage stats for special-admissions datasets — record count + region count per (category × year). Use this to know what data is loaded before deep queries. 6 categories × 3 years = 18 rows.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
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
      const table = loadRankTable(provinceId, year, track);
      if (!table) {
        throw new Error(`No 一分一段 table for ${PROVINCES[provinceId].name} ${year} ${track}. Call \`rank_tables\` to see what's ingested.`);
      }
      const hasScore = args.score !== undefined;
      const hasRank = args.rank !== undefined;
      if (!hasScore && !hasRank) throw new Error("Pass either `score` or `rank`.");
      if (hasScore) {
        const score = Number(args.score);
        return {
          province: PROVINCES[provinceId].name,
          year,
          track,
          source: table.source,
          score,
          rank: scoreToRank(table, score)
        };
      }
      const rank = Number(args.rank);
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
      const year = Number((args as Record<string, unknown>).year);
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
    case "art_tongkao": {
      const province = getStr(args, "province");
      const id = resolveProvince(province);
      if (!id) throw new Error(`unknown province: ${province}`);
      const year = saYearFrom(args);
      const category = typeof args.category === "string" ? (args.category as ArtCategory) : undefined;
      if (category) {
        const rec = findArtFormula(id, category, year);
        return { ok: true, query: { region: id, name: PROVINCES[id].name, category, year }, record: rec };
      }
      const list = listArtFormulasForRegion(id, year);
      return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list };
    }
    case "sports_tongzhao": {
      const province = getStr(args, "province");
      const id = resolveProvince(province);
      if (!id) throw new Error(`unknown province: ${province}`);
      const year = saYearFrom(args);
      const rec = findSportsFormula(id, year);
      return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, record: rec };
    }
    case "qiangji_line": {
      const year = saYearFrom(args);
      const school = typeof args.school === "string" ? args.school : undefined;
      const province = typeof args.province === "string" ? args.province : undefined;
      if (school && province) {
        const id = resolveProvince(province);
        if (!id) throw new Error(`unknown province: ${province}`);
        const rec = findQiangjiQuota(school, id, year);
        return { ok: true, query: { school, region: id, name: PROVINCES[id].name, year }, record: rec };
      }
      if (province) {
        const id = resolveProvince(province);
        if (!id) throw new Error(`unknown province: ${province}`);
        const list = listQiangjiForRegion(id, year);
        return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list };
      }
      if (school) {
        const list = listQiangjiForSchool(school, year);
        return { ok: true, query: { school, year }, count: list.length, records: list };
      }
      throw new Error("qiangji_line requires school and/or province");
    }
    case "zonghe": {
      const province = getStr(args, "province");
      const id = resolveProvince(province);
      if (!id) throw new Error(`unknown province: ${province}`);
      const year = saYearFrom(args);
      const school = typeof args.school === "string" ? args.school : undefined;
      if (school) {
        const rec = findZongPing(school, id, year);
        return { ok: true, query: { region: id, name: PROVINCES[id].name, school, year }, record: rec };
      }
      const list = listZongPingForRegion(id, year);
      return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list };
    }
    case "minzu": {
      const province = getStr(args, "province");
      const id = resolveProvince(province);
      if (!id) throw new Error(`unknown province: ${province}`);
      const year = saYearFrom(args);
      const rec = findMinzuPolicy(id, year);
      return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, record: rec };
    }
    case "qatw": {
      const region = getStr(args, "region");
      const id = resolveProvince(region);
      if (!id || (id !== 71 && id !== 81 && id !== 82)) {
        throw new Error(`qatw requires 71 台湾 / 81 香港 / 82 澳门, got: ${region}`);
      }
      const year = saYearFrom(args);
      const channel = typeof args.channel === "string" ? (args.channel as QATWChannelType) : undefined;
      if (channel) {
        const rec = findQATWChannel(id, channel, year);
        return { ok: true, query: { region: id, name: PROVINCES[id].name, channel, year }, record: rec };
      }
      const list = listQATWForRegion(id, year);
      return { ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list };
    }
    case "special_coverage": {
      return { ok: true, coverage: coverageReport() };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function saYearFrom(args: Record<string, unknown>): SAYear {
  const v = args.year;
  if (v === undefined || v === null) return 2025;
  const n = Number(v);
  if (n === 2023 || n === 2024 || n === 2025 || n === 2026) return n as SAYear;
  throw new Error(`year must be 2023/2024/2025/2026, got: ${v}`);
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
