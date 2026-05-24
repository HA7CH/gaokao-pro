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
