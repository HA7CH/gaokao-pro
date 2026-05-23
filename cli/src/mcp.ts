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
