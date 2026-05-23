#!/usr/bin/env node
import { getSchoolInfo, getAdmissionPlan, getAdmissionScores, extractHistoricalScores } from "./gaokao-cn.js";
import { PROVINCES, TRACK_NAMES, resolveProvince, ALL_SUBJECTS, type Subject } from "./codes.js";
import { recommend } from "./recommend.js";
import { find } from "./find.js";
import { top } from "./top.js";
import { isTty, formatRecommend, formatTop } from "./format.js";
import { runMcpServer } from "./mcp.js";

type Verb = (args: string[]) => Promise<void>;

const VERSION = "0.0.1";

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function shouldTable(flags: Record<string, string | boolean>): boolean {
  if (flags.format === "table") return true;
  if (flags.format === "json") return false;
  return isTty();
}

const HELP = `gaokao-pro v${VERSION}

Usage:
  gaokao-pro school <schoolId>
      Show metadata for a school (gaokao.cn internal id, e.g. 31 = 北大).
      Includes 985/211 flags, 学科评估, historical min scores per province.

  gaokao-pro plan <schoolId> --year <year> --province <name|id>
      List admission plan items: 专业代码 / 计划人数 / 学制 / 学费 / 选科要求.
      e.g. gaokao-pro plan 31 --year 2024 --province henan

  gaokao-pro scores <schoolId> --province <name|id>
      Historical min scores for a (school, province) pair across all years/tracks.

  gaokao-pro recommend --score <n> --province <name|id> --subjects <list>
                       [--schools <id1,id2,...>] [--985] [--211] [--dual-class]
                       [--level <本科|专科>] [--type <综合类|理工类|...>]
                       [--belong <教育部|工信部|...>] [--limit <n>] [--rank <n>]
                       [--explain] [--format table|json]
      Bucket schools into 冲 / 稳 / 保 based on the user's score vs each
      school's most-recent matching-track minimum. Without --schools, scans
      the full index (~2400 schools). All evaluation is local — no network.
      e.g. gaokao-pro recommend --score 660 --province henan \\
                                --subjects 物理,化学,生物 --985 --limit 10 --explain

  gaokao-pro top --score <n> --province <name|id> --subjects <list>
                 [--985] [--211] [--dual-class] [--limit <n>]
                 [--format table|json]
      Best schools within reach of this score in this province, ranked by
      historical baseline desc. Like recommend, but flat top-N list.
      e.g. gaokao-pro top --score 650 --province henan --subjects 物理 --limit 15

  gaokao-pro actual <schoolId> --year <year> --province <name|id>
      Per-major actual admission outcomes (vs forward-looking 'plan'):
      max/min/avg score, 录取人数, 最低位次. Use this for rank-based reasoning.

  gaokao-pro find <keyword> --province <name|id> --year <year>
                  [--985] [--211] [--dual-class] [--belong <name>] [--limit <n>]
      Search for a major keyword across schools recruiting in a province.
      e.g. gaokao-pro find "计算机" --province henan --year 2024 --985 --limit 20

  gaokao-pro provinces
      List supported provinces with their ids and 新高考 reform mode.

  gaokao-pro mcp
      Start an MCP server over stdio. Plug into Claude Code with:
        claude mcp add gaokao-pro -- npx -y gaokao-pro mcp
      All verbs above become MCP tools callable by Claude.

  gaokao-pro help | --help
      Show this help.

Notes:
  schoolId is gaokao.cn's internal id (NOT 教育部 5-digit zs_code).
  Run \`gaokao-pro school 31\` once to see the mapping in the 'zs_code' field.
`;

const VERBS: Record<string, Verb> = {
  async help() {
    process.stdout.write(HELP);
  },
  async "--help"() {
    process.stdout.write(HELP);
  },
  async "-h"() {
    process.stdout.write(HELP);
  },
  async "--version"() {
    process.stdout.write(VERSION + "\n");
  },

  async mcp() {
    await runMcpServer();
  },

  async provinces() {
    const rows = Object.entries(PROVINCES).map(([id, p]) => ({
      id: Number(id),
      name: p.name,
      pinyin: p.pinyin,
      reform: p.reform
    }));
    printJson({ ok: true, count: rows.length, provinces: rows });
  },

  async school(args) {
    const { positional } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId. e.g. `gaokao-pro school 31`");
    const info = await getSchoolInfo(id);
    printJson({
      ok: true,
      school: {
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
      }
    });
  },

  async plan(args) {
    const { positional, flags } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId");
    const year = Number(flags.year ?? new Date().getFullYear() - 1);
    if (!Number.isFinite(year)) throw new Error("--year must be a number");
    const provinceArg = flags.province;
    if (typeof provinceArg !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(provinceArg);
    if (!provinceId) throw new Error(`unknown province: ${provinceArg}`);
    const items = await getAdmissionPlan(id, year, provinceId);
    printJson({
      ok: true,
      query: { schoolId: id, year, province: { id: provinceId, name: PROVINCES[provinceId].name } },
      count: items.length,
      items: items.map((p) => ({
        spcode: p.spcode,
        sp_name: p.sp_name,
        spname: p.spname,
        num: p.num,
        length: p.length,
        tuition: p.tuition,
        batch: p.local_batch_name,
        zslx: p.zslx_name,
        track: TRACK_NAMES[p.type] ?? p.type,
        major_group: p.special_group !== "0" ? p.special_group : null,
        xuanke: {
          first: p.sp_fxk || p.sg_fxk || null,
          reselect: p.sp_sxk || p.sg_sxk || null,
          raw: p.sp_xuanke || p.sg_xuanke || null
        },
        category: `${p.level2_name} · ${p.level3_name}`,
        info: p.info || p.remark || null
      }))
    });
  },

  async recommend(args) {
    const { flags } = parseFlags(args);
    const score = Number(flags.score);
    if (!Number.isFinite(score)) throw new Error("--score <n> is required");
    if (typeof flags.province !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    if (typeof flags.subjects !== "string") throw new Error("--subjects <list> is required (comma-separated, e.g. 物理,化学,生物)");
    const subjects = flags.subjects.split(",").map((s) => s.trim()) as Subject[];
    for (const s of subjects) {
      if (!ALL_SUBJECTS.includes(s)) throw new Error(`unknown subject: ${s} (valid: ${ALL_SUBJECTS.join(", ")})`);
    }
    const schoolIds = typeof flags.schools === "string"
      ? flags.schools.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const rank = flags.rank !== undefined ? Number(flags.rank) : undefined;
    const limit = flags.limit !== undefined ? Number(flags.limit) : undefined;
    const filter = {
      f985: flags["985"] === true ? true : undefined,
      f211: flags["211"] === true ? true : undefined,
      dualClass: flags["dual-class"] === true ? true : undefined,
      level: typeof flags.level === "string" ? flags.level : undefined,
      type: typeof flags.type === "string" ? flags.type : undefined,
      belong: typeof flags.belong === "string" ? flags.belong : undefined
    };
    const out = recommend({ score, provinceId, subjects, rank, schoolIds, filter, limit });
    if (shouldTable(flags)) {
      process.stdout.write(formatRecommend(out, { explain: flags.explain === true }) + "\n");
    } else {
      printJson({ ok: true, ...out });
    }
  },

  async top(args) {
    const { flags } = parseFlags(args);
    const score = Number(flags.score);
    if (!Number.isFinite(score)) throw new Error("--score <n> is required");
    if (typeof flags.province !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    if (typeof flags.subjects !== "string") throw new Error("--subjects <list> is required");
    const subjects = flags.subjects.split(",").map((s) => s.trim()) as Subject[];
    for (const s of subjects) {
      if (!ALL_SUBJECTS.includes(s)) throw new Error(`unknown subject: ${s} (valid: ${ALL_SUBJECTS.join(", ")})`);
    }
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const filter = {
      f985: flags["985"] === true ? true : undefined,
      f211: flags["211"] === true ? true : undefined,
      dualClass: flags["dual-class"] === true ? true : undefined
    };
    const out = top({ score, provinceId, subjects, limit, filter });
    if (shouldTable(flags)) {
      const rows = out.rows.map((r) => ({
        schoolName: r.name,
        baselineMinScore: r.baselineMinScore,
        delta: r.delta,
        baselineYear: r.baselineYear,
        city: r.city,
        tags: [r.is985 ? "985" : "", r.is211 && !r.is985 ? "211" : "", r.dualClass === "双一流" && !r.is985 && !r.is211 ? "双一流" : ""].filter(Boolean).join(" "),
        belong: r.belong
      }));
      const header = `gaokao-pro top  score=${score}  province=${PROVINCES[provinceId].name}  subjects=${subjects.join("/")}  limit=${limit}\n`;
      process.stdout.write(header + formatTop(rows) + "\n");
    } else {
      printJson({ ok: true, ...out });
    }
  },

  async actual(args) {
    const { positional, flags } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId");
    const year = Number(flags.year);
    if (!Number.isFinite(year)) throw new Error("--year <year> is required");
    if (typeof flags.province !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    const items = await getAdmissionScores(id, year, provinceId);
    printJson({
      ok: true,
      query: { schoolId: id, year, province: { id: provinceId, name: PROVINCES[provinceId].name } },
      count: items.length,
      items: items.map((it) => ({
        spcode: it.spcode || null,
        sp_name: it.sp_name,
        spname: it.spname,
        max: it.max || null,
        min: it.min || null,
        average: it.average || null,
        min_section: it.min_section && it.min_section !== "-" ? Number(it.min_section) : null,
        lq_num: Number(it.lq_num) || 0,
        diff: it.diff || null,
        batch: it.local_batch_name,
        zslx: it.zslx_name,
        track: TRACK_NAMES[it.type] ?? it.type,
        major_group: it.special_group !== "0" ? it.special_group : null,
        xuanke: {
          first: it.sp_fxk || it.sg_fxk || null,
          reselect: it.sp_sxk || it.sg_sxk || null,
          raw: it.sp_xuanke || it.sg_xuanke || null
        },
        info: it.info || it.remark || null
      }))
    });
  },

  async find(args) {
    const { positional, flags } = parseFlags(args);
    const keyword = positional[0];
    if (!keyword) throw new Error("missing keyword. e.g. `gaokao-pro find \"计算机\" --province henan --year 2024`");
    if (typeof flags.province !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    const year = Number(flags.year);
    if (!Number.isFinite(year)) throw new Error("--year <year> is required");
    const limit = flags.limit !== undefined ? Number(flags.limit) : undefined;
    const filter = {
      f985: flags["985"] === true ? true : undefined,
      f211: flags["211"] === true ? true : undefined,
      dualClass: flags["dual-class"] === true ? true : undefined,
      belong: typeof flags.belong === "string" ? flags.belong : undefined
    };
    const out = await find({ keyword, provinceId, year, filter, limit });
    printJson({ ok: true, ...out });
  },

  async scores(args) {
    const { positional, flags } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId");
    const provinceArg = flags.province;
    if (typeof provinceArg !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(provinceArg);
    if (!provinceId) throw new Error(`unknown province: ${provinceArg}`);
    const info = await getSchoolInfo(id);
    const series = extractHistoricalScores(info, provinceId).map((row) => ({
      ...row,
      trackName: TRACK_NAMES[row.track] ?? row.track
    }));
    printJson({
      ok: true,
      query: { schoolId: id, school: info.name, province: PROVINCES[provinceId].name },
      count: series.length,
      series
    });
  }
};

async function main(): Promise<void> {
  const [verb, ...rest] = process.argv.slice(2);
  const handler = verb ? VERBS[verb] : VERBS.help;
  if (!handler) {
    process.stderr.write(`unknown verb: ${verb}\n\n`);
    process.stdout.write(HELP);
    process.exit(2);
  }
  try {
    await handler(rest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    process.exit(1);
  }
}

main();
