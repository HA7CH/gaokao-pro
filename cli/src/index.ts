#!/usr/bin/env node
import { getSchoolInfo, getAdmissionPlan, getAdmissionScores, extractHistoricalScores } from "./gaokao-cn.js";
import { PROVINCES, TRACK_NAMES, resolveProvince, ALL_SUBJECTS, type Subject } from "./codes.js";
import { recommend } from "./recommend.js";
import { find } from "./find.js";
import { top } from "./top.js";
import { isTty, formatRecommend, formatTop } from "./format.js";
import { runMcpServer } from "./mcp.js";
import { loadRankTable, listRankTables, scoreToRank, rankToScore, inferDefaultTrack } from "./rank-table.js";
import { decodeXuanke } from "./xuanke.js";
import {
  loadMemory,
  setPrefs,
  addWatched,
  logEvent,
  clearMemory,
  memoryPath
} from "./memory.js";
import { runSelftest } from "./selftest.js";
import { match, type Profile } from "./match.js";
import { recommendMajor } from "./recommend-major.js";
import { chartCheck } from "./chart-check.js";
import { readFileSync, existsSync } from "node:fs";
import type { ProvinceId } from "./codes.js";
import {
  findSchoolAdapter,
  listSchoolsOfferingProgram,
  findProvinceSpecialty,
  listProvinceKeys,
  getCrossProvincePrograms
} from "./datasets.js";
import { compare } from "./compare.js";
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
  coverageReport,
  validateArtCategory,
  validateQATWChannel
} from "./special-admissions.js";
import type { Year as SAYear } from "./types/special-admissions.js";
import { paiming } from "./paiming.js";
import { findEmployment, listEmploymentCoverage } from "./employment.js";
import { findManifest, listManifestProvinces, manifestStats } from "./manifest.js";

type Verb = (args: string[]) => Promise<void>;

const VERSION = "0.2.0";

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

function parseSAYear(flag: unknown, fallback: SAYear = 2025): SAYear {
  if (typeof flag === "string") {
    const n = Number(flag);
    if (n === 2023 || n === 2024 || n === 2025 || n === 2026) return n as SAYear;
    throw new Error(`--year must be 2023/2024/2025/2026, got: ${flag}`);
  }
  return fallback;
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

  gaokao-pro rank --province <name|id> --year <year>
                  (--score <n> | --rank <n>)  [--track <combined|physics|history|...>]
      Look up a (score, rank) pair against the province's official 一分一段表.
      Pass --score to get your 全省位次. Pass --rank to get the score that
      hits that rank. Provinces ingested: see 'gaokao-pro rank-tables'.
      e.g. gaokao-pro rank --province beijing --year 2024 --score 650

  gaokao-pro rank-tables
      List all (province, year, track) tuples with ingested 一分一段 data.

  gaokao-pro match --profile profile.json [--limit <n>] [--format table|json]
      Read a student profile (JSON file or stdin) and return ranked schools
      with composite fit scores (interest + baseline + label + city).
      e.g. cat profile.json | gaokao-pro match - --limit 20

  gaokao-pro recommend-major <interest> --score <n> --province <name|id>
                              --subjects <list> --year <year>
                              [--985] [--211] [--limit <n>]
      Interest-driven: find majors matching <interest> across schools that
      recruit in your province for the year. Returns schools grouped by 专业.
      e.g. gaokao-pro recommend-major 计算机 --score 660 --province henan \\
                                        --subjects 物理,化学,生物 --year 2024 --985

  gaokao-pro chart-check --profile profile.json
      Sanity-check a profile: score range, subject combo for the province's
      新高考 reform, rank↔score consistency (if 一分一段 exists). 0-100 score.

  gaokao-pro compare <A> <B> [--province <name|id>]
      Side-by-side: labels (985/211/双一流), 隶属, recent province min scores,
      招生网 URL, special-program flags, contact. Offline.
      e.g. gaokao-pro compare 复旦 上交 --province henan

  gaokao-pro paiming <school>
      Aggregate rankings: 软科 / 校友会 / QS / US News / 泰晤士中国 +
      第四轮学科评估 (A+/A/A- counts) + 第五轮已披露 A+ 学科 (if any).
      e.g. gaokao-pro paiming 清华大学

  gaokao-pro employment <school>
      2024届毕业生就业质量报告 关键统计：本科就业率 / 升学率 / 出国率 /
      平均月薪 / top 行业 / top 地域 / top 雇主 + 官方报告 URL。
      首批 15 所 985 已入库；缺值表示该校未公开。
      e.g. gaokao-pro employment 清华

  gaokao-pro employment-list
      List schools with 就业报告 data in this build.

  gaokao-pro manifest <province> <year>
      Look up the authoritative 一分一段表 source URL for a given
      (province, year). 62 records ingested (31 省 × 2024/2025), with
      year_verified_from flag (url|title|body|pdf_filename|unverified).
      Useful when you want to verify rank-from-score against the official
      table, or grab a PDF to OCR.
      e.g. gaokao-pro manifest 河南 2025
           gaokao-pro manifest henan 2024
           gaokao-pro manifest 41 2025

  gaokao-pro manifest-list [--year <year>]
      List all (province, year) records, optionally filtered by year.
      Returns coverage stats (total / year_verified / unverified).

  gaokao-pro adapter <name|zs_code>
      Look up one school's 招生网 URL + special-program offer flags + contact.
      Reads cli/data/datasets/schools-adapters-2024.json (80+ schools curated).
      e.g. gaokao-pro adapter 清华 · gaokao-pro adapter 10003

  gaokao-pro program <type>
      List schools offering a specific program type. Type one of:
        qiangji · zonghepingjia · zhongwai_hezuo · guojia_zhuanxiang ·
        gaoxiao_zhuanxiang · minzu_ban · yuke_ban · gao_shui_yundong · high_art

  gaokao-pro tiqian <province>
      Per-province 提前批 + 强基/综评 in-province implementing schools.
      Available: tianjin · zhejiang · hunan · shandong · guangdong (verified).
      Pass 'all' to list cross-province programs (国家/高校/地方专项 + 港澳台联招).

  gaokao-pro xuanke <raw>
      Decode a gaokao.cn selected-subject string (e.g. "70001_70002^70001_70003").
      Returns the human-readable combinations: 物理+化学 或 物理+生物.

  gaokao-pro memory list
  gaokao-pro memory set <k=v> [<k=v>...]
  gaokao-pro memory watch <schoolId> [--name <name>] [--note <text>]
  gaokao-pro memory event <type> <detail>
  gaokao-pro memory clear
      Local persistent state at ~/.gaokaopro/memory.json — prefs / watched
      schools / event log so Claude can resume across sessions.

  gaokao-pro art-tongkao --province <p> [--category <c>] [--year 2023|2024|2025|2026]
      Art unified exam (艺术统考) formula + 合格线 for a province × year.
      With --category 美术与设计|音乐表演-声乐|...|戏曲: single record.
      Without --category: all categories for that province × year.

  gaokao-pro sports-tongzhao --province <p> [--year 2023|2024|2025|2026]
      Sports unified admission (体育统招) formula + 合格线 for a province × year.

  gaokao-pro qiangji-line [--school <s>] [--province <p>] [--year 2023|2024|2025|2026]
      Qiangji (强基计划) quota + 入围线. Filter by school, province, or both.

  gaokao-pro zonghe --province <p> [--school <s>] [--year 2023|2024|2025|2026]
      Comprehensive evaluation (综合评价 / 三位一体) for a province × year.

  gaokao-pro minzu --province <p> [--year 2023|2024|2025|2026]
      Minority bonus + 民族班/预科 policy for a province × year.

  gaokao-pro qatw <71|81|82|台湾|香港|澳门> [--channel <c>] [--year ...]
      Port-Macau-Taiwan dual-direction channels. channels include:
        全国联招 居住证高考 保送生 DSE互认 港校招内地生 澳校招内地生
        学测申请陆校 陆生申请台校

  gaokao-pro special-coverage
      Coverage stats for special-admissions datasets (record count + region count per category × year).

  gaokao-pro selftest
      3-stage end-to-end smoke: upstream API, local index, 一分一段.

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

  async rank(args) {
    const { flags } = parseFlags(args);
    if (typeof flags.province !== "string") throw new Error("--province <name|id> is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    const year = Number(flags.year);
    if (!Number.isFinite(year)) throw new Error("--year <year> is required");
    const track = typeof flags.track === "string" ? flags.track : inferDefaultTrack(provinceId);
    const table = loadRankTable(provinceId, year, track);
    if (!table) {
      throw new Error(
        `no 一分一段 table for ${PROVINCES[provinceId].name} ${year} ${track}. ` +
          `Run \`gaokao-pro rank-tables\` to see what we have. ` +
          `To add this province, drop a JSON file at cli/data/yifenyiduan/${PROVINCES[provinceId].pinyin}-${year}-${track}.json — see cli/src/rank-table.ts for the schema.`
      );
    }
    const hasScore = flags.score !== undefined;
    const hasRank = flags.rank !== undefined;
    if (!hasScore && !hasRank) throw new Error("provide either --score <n> or --rank <n>");
    if (hasScore && hasRank) throw new Error("--score and --rank are mutually exclusive");
    const result: Record<string, unknown> = {
      province: PROVINCES[provinceId].name,
      year,
      track,
      source: table.source
    };
    if (hasScore) {
      const score = Number(flags.score);
      const rank = scoreToRank(table, score);
      result.score = score;
      result.rank = rank;
      result.summary = rank !== null
        ? `${PROVINCES[provinceId].name} ${year} ${track}: 分数 ${score} → 全省位次 ${rank} 名以内`
        : `分数 ${score} 低于该表覆盖范围`;
    } else {
      const rank = Number(flags.rank);
      const score = rankToScore(table, rank);
      result.rank = rank;
      result.score = score;
      result.summary = score !== null
        ? `${PROVINCES[provinceId].name} ${year} ${track}: 位次 ${rank} → 至少需要 ${score} 分`
        : `位次 ${rank} 超出该表覆盖范围`;
    }
    printJson({ ok: true, ...result });
  },

  async "rank-tables"() {
    const items = listRankTables();
    printJson({ ok: true, count: items.length, tables: items });
  },

  async match(args) {
    const { positional, flags } = parseFlags(args);
    let profileJson: unknown;
    const src = typeof flags.profile === "string" ? flags.profile : positional[0];
    if (!src || src === "-") {
      const stdin = readFileSync(0, "utf8");
      profileJson = JSON.parse(stdin);
    } else {
      if (!existsSync(src)) throw new Error(`profile not found: ${src}`);
      profileJson = JSON.parse(readFileSync(src, "utf8"));
    }
    const p = profileJson as { score: number; province: string; subjects: string[]; rank?: number; interests?: string[]; constraints?: unknown };
    if (typeof p.score !== "number") throw new Error("profile.score must be number");
    if (typeof p.province !== "string") throw new Error("profile.province must be string");
    const provinceId = resolveProvince(p.province);
    if (!provinceId) throw new Error(`unknown province: ${p.province}`);
    if (!Array.isArray(p.subjects)) throw new Error("profile.subjects must be array");
    for (const s of p.subjects) {
      if (!ALL_SUBJECTS.includes(s as Subject)) throw new Error(`unknown subject: ${s}`);
    }
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const out = match({
      score: p.score,
      province: provinceId,
      subjects: p.subjects as Subject[],
      rank: p.rank,
      interests: p.interests,
      constraints: p.constraints as Profile["constraints"]
    }, limit);
    printJson({ ok: true, ...out });
  },

  async "recommend-major"(args) {
    const { positional, flags } = parseFlags(args);
    const keyword = positional[0];
    if (!keyword) throw new Error("missing <interest>. e.g. `gaokao-pro recommend-major 计算机 ...`");
    const score = Number(flags.score);
    if (!Number.isFinite(score)) throw new Error("--score <n> is required");
    if (typeof flags.province !== "string") throw new Error("--province is required");
    const provinceId = resolveProvince(flags.province);
    if (!provinceId) throw new Error(`unknown province: ${flags.province}`);
    if (typeof flags.subjects !== "string") throw new Error("--subjects is required");
    const subjects = flags.subjects.split(",").map((s) => s.trim()) as Subject[];
    for (const s of subjects) {
      if (!ALL_SUBJECTS.includes(s)) throw new Error(`unknown subject: ${s}`);
    }
    const year = Number(flags.year);
    if (!Number.isFinite(year)) throw new Error("--year is required");
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const filter = {
      f985: flags["985"] === true ? true : undefined,
      f211: flags["211"] === true ? true : undefined,
      dualClass: flags["dual-class"] === true ? true : undefined,
      belong: typeof flags.belong === "string" ? flags.belong : undefined
    };
    const out = await recommendMajor({ keyword, score, provinceId, subjects, year, filter, limit });
    printJson({ ok: true, ...out });
  },

  async "chart-check"(args) {
    const { flags } = parseFlags(args);
    let profileJson: unknown;
    const src = typeof flags.profile === "string" ? flags.profile : "-";
    if (src === "-") {
      profileJson = JSON.parse(readFileSync(0, "utf8"));
    } else {
      if (!existsSync(src)) throw new Error(`profile not found: ${src}`);
      profileJson = JSON.parse(readFileSync(src, "utf8"));
    }
    const p = profileJson as { score?: number; rank?: number; province?: string; subjects?: string[]; year?: number };
    let province_id: ProvinceId | undefined;
    if (typeof p.province === "string") {
      const id = resolveProvince(p.province);
      if (id) province_id = id;
    }
    const out = chartCheck({ ...p, province_id });
    printJson(out);
  },

  async compare(args) {
    const { positional, flags } = parseFlags(args);
    const a = positional[0];
    const b = positional[1];
    if (!a || !b) throw new Error("usage: compare <A> <B> [--province <name|id>]");
    const focusProvince = typeof flags.province === "string"
      ? resolveProvince(flags.province) ?? undefined
      : undefined;
    const out = compare(a, b, focusProvince);
    printJson({ ok: true, ...out });
  },

  async paiming(args) {
    const { positional } = parseFlags(args);
    const q = positional[0];
    if (!q) throw new Error("usage: paiming <name|zs_code|schoolId>");
    const out = await paiming(q);
    printJson({ ok: true, ...out });
  },

  async employment(args) {
    const { positional } = parseFlags(args);
    const q = positional[0];
    if (!q) throw new Error("usage: employment <school>. e.g. `gaokao-pro employment 清华` 或 `gaokao-pro employment 10003`");
    const rec = findEmployment(q);
    if (!rec) {
      const hint = listEmploymentCoverage().map((c) => c.school).join(", ");
      throw new Error(`no employment data for "${q}". Available: ${hint}`);
    }
    printJson({ ok: true, ...rec });
  },

  async "employment-list"() {
    const list = listEmploymentCoverage();
    printJson({ ok: true, count: list.length, schools: list });
  },

  async manifest(args) {
    const { positional } = parseFlags(args);
    const provinceArg = positional[0];
    const yearArg = positional[1];
    if (!provinceArg || !yearArg) throw new Error("usage: manifest <province> <year>. e.g. `gaokao-pro manifest 河南 2025`");
    const year = Number(yearArg);
    if (!Number.isInteger(year)) throw new Error(`year must be an integer, got: ${yearArg}`);
    const rec = findManifest(provinceArg, year);
    if (!rec) throw new Error(`no manifest record for province="${provinceArg}" year=${year}. Try \`gaokao-pro manifest-list --year ${year}\` to see options.`);
    printJson({ ok: true, ...rec });
  },

  async "manifest-list"(args) {
    const { flags } = parseFlags(args);
    const year = typeof flags.year !== "undefined" ? Number(flags.year) : undefined;
    const records = listManifestProvinces(year);
    const stats = manifestStats();
    printJson({ ok: true, stats, count: records.length, records });
  },

  async adapter(args) {
    const { positional } = parseFlags(args);
    const query = positional[0];
    if (!query) throw new Error("missing <name|zs_code>. e.g. `gaokao-pro adapter 清华` or `gaokao-pro adapter 10003`");
    const adapter = findSchoolAdapter(query);
    if (!adapter) throw new Error(`no adapter for "${query}". Try a different name or zs_code, or check the dataset.`);
    printJson({ ok: true, adapter });
  },

  async program(args) {
    const { positional } = parseFlags(args);
    const type = positional[0];
    const valid = ["qiangji", "zonghepingjia", "zhongwai_hezuo", "guojia_zhuanxiang", "gaoxiao_zhuanxiang", "minzu_ban", "yuke_ban", "gao_shui_yundong", "high_art"];
    if (!type || !valid.includes(type)) {
      throw new Error(`type must be one of: ${valid.join(", ")}`);
    }
    const schools = listSchoolsOfferingProgram(type as Parameters<typeof listSchoolsOfferingProgram>[0]);
    printJson({
      ok: true,
      program: type,
      count: schools.length,
      schools: schools.map((s) => ({
        name: s.name,
        zs_code: s.zs_code,
        zsw_url: s.zsw_url,
        detail: type === "gaoxiao_zhuanxiang" ? s.programs.gaoxiao_zhuanxiang : (s.programs[type as keyof typeof s.programs] as unknown)
      }))
    });
  },

  async tiqian(args) {
    const { positional } = parseFlags(args);
    const province = positional[0];
    if (!province) throw new Error("missing <province>. Try one of: " + listProvinceKeys().join(", ") + " (or 'all')");
    if (province === "all") {
      printJson({ ok: true, cross_province_programs: getCrossProvincePrograms() });
      return;
    }
    const data = findProvinceSpecialty(province);
    if (!data) throw new Error(`no specialty plan ingested for ${province}. Available: ${listProvinceKeys().join(", ")}`);
    printJson({ ok: true, ...data });
  },

  async xuanke(args) {
    const { positional } = parseFlags(args);
    const raw = positional[0];
    if (!raw) throw new Error("missing raw xuanke string. e.g. `gaokao-pro xuanke 70001_70002`");
    printJson({ ok: true, ...decodeXuanke(raw) });
  },

  async memory(args) {
    const { positional, flags } = parseFlags(args);
    const sub = positional[0] ?? "list";
    if (sub === "list") {
      const state = loadMemory();
      printJson({ ok: true, path: memoryPath(), ...state });
      return;
    }
    if (sub === "set") {
      const pairs: Record<string, string> = {};
      for (const arg of positional.slice(1)) {
        const idx = arg.indexOf("=");
        if (idx < 0) throw new Error(`bad k=v pair: ${arg}`);
        pairs[arg.slice(0, idx)] = arg.slice(idx + 1);
      }
      if (Object.keys(pairs).length === 0) throw new Error("memory set needs at least one k=v");
      const state = setPrefs(pairs);
      printJson({ ok: true, prefs: state.prefs });
      return;
    }
    if (sub === "watch") {
      const id = Number(positional[1]);
      if (!Number.isFinite(id)) throw new Error("memory watch needs <schoolId> as a number");
      const state = addWatched(
        id,
        typeof flags.name === "string" ? flags.name : undefined,
        typeof flags.note === "string" ? flags.note : undefined
      );
      printJson({ ok: true, watched: state.watched_schools });
      return;
    }
    if (sub === "event") {
      const type = positional[1];
      const detail = positional.slice(2).join(" ");
      if (!type) throw new Error("memory event needs <type> <detail>");
      const state = logEvent(type, detail);
      printJson({ ok: true, last_event: state.events[state.events.length - 1] });
      return;
    }
    if (sub === "clear") {
      clearMemory();
      printJson({ ok: true, cleared: true });
      return;
    }
    throw new Error(`unknown memory subcommand: ${sub}. valid: list/set/watch/event/clear`);
  },

  async selftest() {
    const out = await runSelftest();
    for (const r of out.results) {
      const tag = r.ok ? "ok  " : "FAIL";
      const ms = r.ms !== undefined ? ` (${r.ms}ms)` : "";
      const reason = r.reason ? `: ${r.reason}` : "";
      process.stdout.write(`  ${tag} ${r.stage}${ms}${reason}\n`);
    }
    process.exit(out.ok ? 0 : 1);
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
  },

  async "art-tongkao"(args) {
    const { flags } = parseFlags(args);
    const pa = flags.province;
    if (typeof pa !== "string") throw new Error("--province <name|id> is required");
    const id = resolveProvince(pa);
    if (!id) throw new Error(`unknown province: ${pa}`);
    const year = parseSAYear(flags.year);
    if (typeof flags.category === "string") {
      const category = validateArtCategory(flags.category); // throws on typo
      const rec = findArtFormula(id, category, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, category, year }, record: rec });
    } else {
      const list = listArtFormulasForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    }
  },

  async "sports-tongzhao"(args) {
    const { flags } = parseFlags(args);
    const pa = flags.province;
    if (typeof pa !== "string") throw new Error("--province <name|id> is required");
    const id = resolveProvince(pa);
    if (!id) throw new Error(`unknown province: ${pa}`);
    const year = parseSAYear(flags.year);
    const rec = findSportsFormula(id, year);
    printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, record: rec });
  },

  async "qiangji-line"(args) {
    const { flags } = parseFlags(args);
    const year = parseSAYear(flags.year);
    const pa = flags.province;
    const sa = flags.school;
    if (typeof sa === "string" && typeof pa === "string") {
      const id = resolveProvince(pa);
      if (!id) throw new Error(`unknown province: ${pa}`);
      const rec = findQiangjiQuota(sa, id, year);
      printJson({ ok: true, query: { school: sa, region: id, name: PROVINCES[id].name, year }, record: rec });
    } else if (typeof pa === "string") {
      const id = resolveProvince(pa);
      if (!id) throw new Error(`unknown province: ${pa}`);
      const list = listQiangjiForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    } else if (typeof sa === "string") {
      const list = listQiangjiForSchool(sa, year);
      printJson({ ok: true, query: { school: sa, year }, count: list.length, records: list });
    } else {
      throw new Error("--school <name> or --province <name|id> required (or both)");
    }
  },

  async zonghe(args) {
    const { flags } = parseFlags(args);
    const pa = flags.province;
    if (typeof pa !== "string") throw new Error("--province <name|id> is required");
    const id = resolveProvince(pa);
    if (!id) throw new Error(`unknown province: ${pa}`);
    const year = parseSAYear(flags.year);
    if (typeof flags.school === "string") {
      const rec = findZongPing(flags.school, id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, school: flags.school, year }, record: rec });
    } else {
      const list = listZongPingForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    }
  },

  async minzu(args) {
    const { flags } = parseFlags(args);
    const pa = flags.province;
    if (typeof pa !== "string") throw new Error("--province <name|id> is required");
    const id = resolveProvince(pa);
    if (!id) throw new Error(`unknown province: ${pa}`);
    const year = parseSAYear(flags.year);
    const rec = findMinzuPolicy(id, year);
    printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, record: rec });
  },

  async qatw(args) {
    const { positional, flags } = parseFlags(args);
    const ra = positional[0] ?? (typeof flags.region === "string" ? flags.region : undefined);
    if (typeof ra !== "string") throw new Error("region name/id required (e.g., 香港 / 81)");
    const id = resolveProvince(ra);
    if (!id || (id !== 71 && id !== 81 && id !== 82)) {
      throw new Error(`qatw requires 71 台湾 / 81 香港 / 82 澳门, got: ${ra}`);
    }
    const year = parseSAYear(flags.year);
    if (typeof flags.channel === "string") {
      const channel = validateQATWChannel(flags.channel); // throws on typo
      const rec = findQATWChannel(id, channel, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, channel, year }, record: rec });
    } else {
      const list = listQATWForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    }
  },

  async "special-coverage"() {
    printJson({ ok: true, coverage: coverageReport() });
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
