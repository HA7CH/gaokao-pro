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
  getCrossProvincePrograms,
  listGaoshuiSchoolsBySport,
  listZongheSchoolsByProvince,
  listTiqianProgramsByProvince,
  listTiqianProgramsByType,
  listTiqianProgramTypes,
  listTiqianProgramsBySchool,
  findXiaoceDetailBySchool
} from "./datasets.js";
import { compare } from "./compare.js";
import { paiming } from "./paiming.js";
import { findEmployment, listEmploymentCoverage } from "./employment.js";
import { findManifest, listManifestProvinces, manifestStats } from "./manifest.js";
import { findUniversity, listGroups, safetyScore, datasetStats, slipRisk, provinceTiaojiInfo } from "./groups.js";
import { paths as pathsFn, type ProfileLite } from "./paths.js";
import { VERSION } from "./version.js";

type Verb = (args: string[]) => Promise<void>;

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

// Validate a list of subjects against the canonical set, throwing a consistent
// error for the first unknown one. Used by match/recommend-major/recommend/top.
function validateSubjects(subjects: string[]): Subject[] {
  for (const s of subjects) {
    if (!ALL_SUBJECTS.includes(s as Subject)) {
      throw new Error(`unknown subject: ${s} (valid: ${ALL_SUBJECTS.join(", ")})`);
    }
  }
  return subjects as Subject[];
}

// Build the shared 985/211/双一流 filter fields from parsed flags. Callers that
// need extra fields (level/type/belong) spread the result and add their own.
function buildLabelFilter(flags: Record<string, string | boolean>): {
  f985: true | undefined;
  f211: true | undefined;
  dualClass: true | undefined;
} {
  return {
    f985: flags["985"] === true ? true : undefined,
    f211: flags["211"] === true ? true : undefined,
    dualClass: flags["dual-class"] === true ? true : undefined
  };
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

  gaokao-pro groups --university <name> [--province <name|id>]
                    [--must <list>] [--ok <list>] [--reject <list>]
      专业组 (major-group) view for a university. Without --province, lists
      per-province group/major counts. With --province, lists that province's
      groups; pass --must/--ok/--reject (comma-separated 选科) to attach a
      safety score per group.
      e.g. gaokao-pro groups --university 清华大学 --province henan --must 物理

  gaokao-pro groups-stats
      Coverage stats for the 专业组 dataset (schools / provinces / groups).

  gaokao-pro slip-risk <university> <province> <groupCode>
                       --score <n> [--rank <n>] [--year <year>]
                       [--must <list>] [--ok <list>] [--reject <list>]
                       [--json]
      滑档风险评估：给定考生分/位次/省份和目标 (学校, 专业组)，结合
      历史投档线、省级调剂规则、组内专业梯度、可选 must/ok/reject 偏好，
      给出 high_risk / moderate_risk / low_risk / comfortable 判定 + 中文
      reasons 列表。默认表格输出，--json 输出结构化数据。
      e.g. gaokao-pro slip-risk 清华大学 河南 02 --score 685 --rank 100

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

  gaokao-pro tiqian-pi [<province>] [--type <type>] [--school <name>] [--json]
  gaokao-pro tiqian-pi --list-types
      提前批 special-program catalog (42 programs × 16+ provinces). Cross-axis
      query: 公费师范生 / 优师 / 综评 / 三位一体 / 中外合作综评 / 国家专项 /
      高校专项 / 公安院校 / 军校 / 农村订单医学 / 航海类 / 小语种 /
      民族班 / 预科班. Each entry carries eligibility + commitment +
      ratio + url for parent-facing 履约条款 review.
      e.g. gaokao-pro tiqian-pi 山东 --type 综评提前批
           gaokao-pro tiqian-pi --school 清华
           gaokao-pro tiqian-pi --list-types

  gaokao-pro zongping <province>
      综合评价招生 2026 — by-school view (UCAS, SUSTech, ShanghaiTech,
      CUHKSZ, 北外, XJTLU, NYU Shanghai, DKU, 沪综评校, 浙三位一体, 苏粤鲁
      综评校, etc). Lists ratio / 校测 / seats / notes per school open
      to that province.
      e.g. gaokao-pro zongping 广东

  gaokao-pro gaoshui-sport <运动名> [--json]
      高水平运动队招生 (post-2024 reform) — schools recruiting a given
      sport, with tier_required / exam_window / score_path / plan_count /
      notes. Useful for 游泳/田径/篮球 etc. specialists.
      e.g. gaokao-pro gaoshui-sport 游泳
           gaokao-pro gaoshui-sport 田径 --json

  gaokao-pro xiaoce <学校名> [--json]
      强基/综评 校测 详情 (59 校): 开设科目 / 笔试/面试/体测内容 /
      录取分配比 / 报名+校测时间窗 / 可填学校上限 / 签约条款 (转专业/保研路径).
      对家长决定 "投入强基/综评备考性价比" 极有用。
      e.g. gaokao-pro xiaoce 清华
           gaokao-pro xiaoce 浙江大学 --json

  gaokao-pro paths <省份> [--score N] [--rank N] [--minority] [--rural]
                         [--serve] [--sport <名>] [--sport-tier <级>]
                         [--language <非英语>] [--json]
      志愿路径全景 — 给定省份 + 家长侧 profile flags，单次列出所有可走路径：
      提前批 catalog (公费师范/优师/综评/三位一体/中外合作/专项/公安/军校/
      农村订单医学/航海/小语种/民族班/预科) + 综评 by-school +
      高水平运动队 + 省级 滑档 规则。每条带 ✓/✗ + 中文 caveat (服务期/户籍/
      等级证书) 说明为何 (不) 合格。一句话告诉家长 "我家孩子能走哪些路径"。
      e.g. gaokao-pro paths 广东 --score 620 --minority
           gaokao-pro paths 北京 --rural --serve --sport-tier 一级运动员 --sport 游泳

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
    const subjects = validateSubjects(p.subjects);
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const out = match({
      score: p.score,
      province: provinceId,
      subjects,
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
    const subjects = validateSubjects(flags.subjects.split(",").map((s) => s.trim()));
    const year = Number(flags.year);
    if (!Number.isFinite(year)) throw new Error("--year is required");
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const filter = {
      ...buildLabelFilter(flags),
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
    if (!id) throw new Error("missing schoolId. e.g. `gaokao-pro plan 31 --year 2024 --province henan`");
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
    const subjects = validateSubjects(flags.subjects.split(",").map((s) => s.trim()));
    const schoolIds = typeof flags.schools === "string"
      ? flags.schools.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const rank = flags.rank !== undefined ? Number(flags.rank) : undefined;
    const limit = flags.limit !== undefined ? Number(flags.limit) : undefined;
    const filter = {
      ...buildLabelFilter(flags),
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
    const subjects = validateSubjects(flags.subjects.split(",").map((s) => s.trim()));
    const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
    const filter = buildLabelFilter(flags);
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
      const slipFooter = (() => {
        try {
          const info = provinceTiaojiInfo(PROVINCES[provinceId].name);
          if (!info) return "";
          const lines = [`\n【${PROVINCES[provinceId].name} 滑档提示】`];
          lines.push(`  单位 ${info.unit ?? "-"} · 调剂 ${info.has_tiaoji === null ? "?" : (info.has_tiaoji ? "有" : "⚠️无")}`);
          if (info.slip_warning) lines.push(`  ${info.slip_warning}`);
          if (info.strategy) lines.push(`  策略: ${info.strategy}`);
          return lines.join("\n");
        } catch { return ""; }
      })();
      process.stdout.write(header + formatTop(rows) + slipFooter + "\n");
    } else {
      printJson({ ok: true, ...out });
    }
  },

  async actual(args) {
    const { positional, flags } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId. e.g. `gaokao-pro actual 31 --year 2024 --province henan`");
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
      ...buildLabelFilter(flags),
      belong: typeof flags.belong === "string" ? flags.belong : undefined
    };
    const out = await find({ keyword, provinceId, year, filter, limit });
    printJson({ ok: true, ...out });
  },

  async groups(args) {
    const { flags } = parseFlags(args);
    const uni = typeof flags.university === "string" ? flags.university : (typeof flags.uni === "string" ? flags.uni : null);
    if (!uni) throw new Error("--university <name> required (e.g. 清华大学)");
    const province = typeof flags.province === "string" ? flags.province : null;
    const u = findUniversity(uni);
    if (!u) throw new Error(`university not found in dataset: ${uni}`);
    if (province) {
      const groups = listGroups(uni, province);
      const must = typeof flags["must"] === "string" ? (flags["must"] as string).split(",").map(s => s.trim()) : [];
      const ok = typeof flags["ok"] === "string" ? (flags["ok"] as string).split(",").map(s => s.trim()) : [];
      const reject = typeof flags["reject"] === "string" ? (flags["reject"] as string).split(",").map(s => s.trim()) : [];
      const enrichedGroups = groups.map(g => {
        const safety = (must.length || ok.length || reject.length) ? safetyScore(g, { must_have: must, acceptable: ok, reject }) : null;
        return { ...g, safety };
      });
      printJson({ ok: true, university: u.university, code: u.code, province, groups: enrichedGroups });
    } else {
      printJson({ ok: true, university: u.university, code: u.code, year: u.year, provinces_count: u.provinces.length, provinces: u.provinces.map(p => ({ province: p.province, groups_count: p.groups_count, majors_total: p.majors_total })) });
    }
  },

  async "groups-stats"() {
    printJson({ ok: true, stats: datasetStats() });
  },

  async "slip-risk"(args) {
    const { positional, flags } = parseFlags(args);
    const uni = positional[0] ?? (typeof flags.university === "string" ? flags.university : null);
    const province = positional[1] ?? (typeof flags.province === "string" ? flags.province : null);
    const groupCode = positional[2] ?? (typeof flags.group === "string" ? flags.group : null);
    if (!uni || !province || !groupCode) {
      throw new Error("usage: gaokao-pro slip-risk <university> <province> <groupCode> --score <n> [--rank <n>] [--year <year>] [--must …] [--ok …] [--reject …] [--json]");
    }
    const scoreRaw = flags.score;
    if (typeof scoreRaw !== "string" && typeof scoreRaw !== "number") {
      throw new Error("--score <n> is required");
    }
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) throw new Error(`--score must be a number, got: ${String(scoreRaw)}`);
    const rank = (typeof flags.rank === "string" || typeof flags.rank === "number")
      ? Number(flags.rank) : null;
    if (rank !== null && !Number.isFinite(rank)) throw new Error(`--rank must be a number, got: ${String(flags.rank)}`);
    const year = (typeof flags.year === "string" || typeof flags.year === "number")
      ? Number(flags.year) : undefined;

    const must = typeof flags["must"] === "string" ? (flags["must"] as string).split(",").map(s => s.trim()).filter(Boolean) : [];
    const ok = typeof flags["ok"] === "string" ? (flags["ok"] as string).split(",").map(s => s.trim()).filter(Boolean) : [];
    const reject = typeof flags["reject"] === "string" ? (flags["reject"] as string).split(",").map(s => s.trim()).filter(Boolean) : [];
    const prefs = (must.length || ok.length || reject.length)
      ? { must_have: must, acceptable: ok, reject } : undefined;

    const result = slipRisk({
      uniName: uni,
      provinceName: province,
      groupCode,
      candidateScore: score,
      candidateRank: rank,
      year,
      prefs,
    });

    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, result });
      return;
    }

    // Tabular human-readable output.
    const VERDICT_LABEL: Record<string, string> = {
      high_risk: "[HIGH RISK] 高滑档风险",
      moderate_risk: "[MODERATE] 中等风险",
      low_risk: "[LOW] 低风险",
      comfortable: "[OK] 较稳",
    };
    const lines: string[] = [];
    lines.push(`滑档风险评估 — ${result.university} / ${result.province} / 专业组 ${result.group_code}`);
    lines.push("");
    lines.push(`  判定:           ${VERDICT_LABEL[result.verdict] ?? result.verdict}`);
    lines.push(`  考生分/位次:    ${result.candidate_score}${result.candidate_rank !== null ? ` (位次 ${result.candidate_rank})` : ""}`);
    lines.push(`  组投档线/位次:  ${result.group_min_score ?? "(无数据)"}${result.group_min_rank !== null ? ` (位次 ${result.group_min_rank})` : ""}`);
    lines.push(`  分差 score_gap: ${result.score_gap === null ? "n/a" : (result.score_gap >= 0 ? `+${result.score_gap}` : String(result.score_gap))}`);
    lines.push(`  位次差 rank_gap:${result.rank_gap === null ? " n/a" : (result.rank_gap >= 0 ? ` +${result.rank_gap}` : ` ${result.rank_gap}`)}`);
    lines.push(`  省调剂规则:     调剂=${result.province_rules.has_tiaoji === null ? "未知" : (result.province_rules.has_tiaoji ? "有" : "无")}  单位=${result.province_rules.unit ?? "-"}  改革=${result.province_rules.reform ?? "-"}`);
    if (result.province_rules.slip_warning) {
      lines.push(`  省滑档提示:     ${result.province_rules.slip_warning}`);
    }
    if (result.safety) {
      lines.push(`  组内安全分:     ${result.safety.score.toFixed(2)} (${result.safety.verdict})  匹配${result.safety.matched_majors.length} / 拒绝${result.safety.rejected_majors.length}`);
    }
    if (result.major_gradient.sampled > 0 && result.major_gradient.spread !== null) {
      lines.push(`  组内专业分梯度: ${result.major_gradient.min}–${result.major_gradient.max} (差 ${result.major_gradient.spread}，采样 ${result.major_gradient.sampled} 个专业)`);
    }
    lines.push("");
    lines.push("理由 (reasons):");
    for (const r of result.reasons) {
      lines.push(`  - ${r}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async "tiqian-pi"(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province && !flags.type && !flags["list-types"] && !flags.school) {
      throw new Error("usage: gaokao-pro tiqian-pi <省份> [--type <program_type>] [--school <name>] [--json]  |  gaokao-pro tiqian-pi --list-types");
    }
    if (flags["list-types"] === true) {
      const types = listTiqianProgramTypes();
      if (flags.json === true || flags.format === "json") { printJson({ ok: true, types }); return; }
      process.stdout.write("提前批 program_type 列表:\n" + types.map(t => `  - ${t}`).join("\n") + "\n");
      return;
    }
    let programs;
    if (typeof flags.school === "string") {
      programs = listTiqianProgramsBySchool(flags.school);
      if (province) programs = programs.filter(p => (p.eligible_provinces || []).some(e => e === province || e.startsWith("全国")));
      if (typeof flags.type === "string") programs = programs.filter(p => p.program_type === flags.type);
    } else if (province) {
      programs = listTiqianProgramsByProvince(province);
      if (typeof flags.type === "string") {
        programs = programs.filter(p => p.program_type === flags.type);
      }
    } else {
      programs = listTiqianProgramsByType(flags.type as string);
    }
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, query: { province, type: flags.type ?? null }, count: programs.length, programs });
      return;
    }
    const headerParts: string[] = ["提前批可选项目"];
    if (typeof flags.school === "string") headerParts.push(`学校=${flags.school}`);
    if (province) headerParts.push(`省份=${province}`);
    if (typeof flags.type === "string") headerParts.push(`类型=${flags.type}`);
    const header = headerParts.join(" · ");
    const lines = [header, ""];
    for (const p of programs) {
      lines.push(`▸ ${p.program_type} · ${p.school}${p.zs_code ? ` (${p.zs_code})` : ""}`);
      if (p.scope_note) lines.push(`  覆盖: ${p.scope_note}`);
      if (p.majors && p.majors.length) lines.push(`  专业: ${p.majors.slice(0, 8).join("、")}${p.majors.length > 8 ? `…+${p.majors.length - 8}` : ""}`);
      if (p.plan_count_2025 !== null) lines.push(`  计划: ${p.plan_count_2025}`);
      if (p.eligibility) lines.push(`  资格: ${p.eligibility}`);
      if (p.commitment) lines.push(`  履约: ${p.commitment}`);
      if (p.exam_window) lines.push(`  时间: ${p.exam_window}`);
      if (p.ratio) lines.push(`  分配: ${p.ratio}`);
      if (p.url) lines.push(`  链接: ${p.url}`);
      lines.push("");
    }
    if (!programs.length) lines.push("(无匹配项目)");
    process.stdout.write(lines.join("\n"));
  },

  async zongping(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province) throw new Error("usage: gaokao-pro zongping <省份> [--json]");
    const schools = listZongheSchoolsByProvince(province);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, query: { province }, count: schools.length, schools });
      return;
    }
    const lines = [`综合评价招生 — ${province}`, ""];
    for (const s of schools) {
      lines.push(`▸ ${s.school}${s.zs_code ? ` (${s.zs_code})` : ""}`);
      if (s.ratio) lines.push(`  分配比: ${s.ratio}`);
      if (s.seats !== null) lines.push(`  计划: ${s.seats}`);
      if (s["校测含"]) lines.push(`  校测: ${s["校测含"]}`);
      if (s.notes) lines.push(`  备注: ${s.notes}`);
      lines.push("");
    }
    if (!schools.length) lines.push("(该省无 2026 综评数据)");
    process.stdout.write(lines.join("\n"));
  },

  async paths(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province) throw new Error("usage: gaokao-pro paths <省份> [--score N] [--rank N] [--minority] [--rural] [--serve] [--sport <项目>] [--sport-tier <一级|健将>] [--language <非英语>] [--json]");
    const profile: ProfileLite = {
      province,
      score: (typeof flags.score === "string" || typeof flags.score === "number") ? Number(flags.score) : null,
      rank: (typeof flags.rank === "string" || typeof flags.rank === "number") ? Number(flags.rank) : null,
      is_minority: flags.minority === true,
      is_rural_county: flags.rural === true,
      agree_to_serve: flags.serve === true,
      sport_tier: typeof flags["sport-tier"] === "string" ? flags["sport-tier"] : null,
      sport_name: typeof flags.sport === "string" ? flags.sport : null,
      small_language: typeof flags.language === "string" ? flags.language : null,
    };
    const result = pathsFn(profile);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...result });
      return;
    }
    const lines: string[] = [];
    lines.push(`志愿路径全景 — ${province} · 分=${profile.score ?? "?"} · 位次=${profile.rank ?? "?"}`);
    lines.push(`profile: 少数民族=${profile.is_minority ? "是" : "否"} · 农村专项=${profile.is_rural_county ? "是" : "否"} · 服务期=${profile.agree_to_serve ? "是" : "否"} · 体育=${profile.sport_tier ?? "无"}${profile.sport_name ? "/" + profile.sport_name : ""} · 小语种=${profile.small_language ?? "否"}`);
    lines.push("");
    lines.push(`【${province} 省调剂规则】单位=${result.province_rules.unit ?? "-"} · 调剂=${result.province_rules.has_tiaoji === null ? "?" : (result.province_rules.has_tiaoji ? "有" : "⚠️无")}${result.province_rules.strategy ? " · 策略=" + result.province_rules.strategy : ""}`);
    if (result.province_rules.slip_warning) lines.push(`  风险: ${result.province_rules.slip_warning}`);
    lines.push("");
    lines.push(`总结 — 合格路径 ${result.total_eligible} 条 · 有约束/服务期 ${result.total_caveat} 条`);
    for (const [cat, s] of Object.entries(result.summary_by_category)) {
      lines.push(`  ${cat}: ${s.eligible} 合格 / ${s.caveat} 有约束`);
    }
    lines.push("");
    const byCat: Record<string, typeof result.pathways> = {};
    for (const p of result.pathways) {
      if (!byCat[p.category]) byCat[p.category] = [];
      byCat[p.category].push(p);
    }
    for (const [cat, list] of Object.entries(byCat)) {
      lines.push(`【${cat}】`);
      for (const p of list) {
        const status = p.eligible ? "✓" : "✗";
        lines.push(`  ${status} ${p.program_type ? `[${p.program_type}] ` : ""}${p.school}${p.caveat ? ` — ${p.caveat}` : ""}`);
      }
      lines.push("");
    }
    process.stdout.write(lines.join("\n"));
  },

  async xiaoce(args) {
    const { positional, flags } = parseFlags(args);
    const school = positional[0] ?? (typeof flags.school === "string" ? flags.school : null);
    if (!school) throw new Error("usage: gaokao-pro xiaoce <学校名> [--json]  例: gaokao-pro xiaoce 清华");
    const detail = findXiaoceDetailBySchool(school);
    if (!detail) {
      process.stdout.write(`(找不到 ${school} 的 强基/综评 校测 detail; 当前 dataset 覆盖 59 校。试试 'gaokao-pro xiaoce 清华大学' 或 'gaokao-pro xiaoce 浙江大学')\n`);
      return;
    }
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...detail });
      return;
    }
    const lines: string[] = [];
    lines.push(`强基/综评 校测 detail — ${detail.school}${detail.zs_code ? ` (${detail.zs_code})` : ""}`);
    lines.push("");
    if (detail.qiangji) {
      const q = detail.qiangji;
      lines.push("【强基计划】");
      if (q.subjects_offered?.length) lines.push(`  开设科目:    ${q.subjects_offered.join("、")}`);
      if (q.校测_笔试) lines.push(`  校测·笔试:   ${q.校测_笔试}`);
      if (q.校测_面试) lines.push(`  校测·面试:   ${q.校测_面试}`);
      if (q.校测_体测) lines.push(`  校测·体测:   ${q.校测_体测}`);
      if (q.校测_pass_rate) lines.push(`  通过率:      ${q.校测_pass_rate}`);
      if (q.录取分配) lines.push(`  录取分配:    ${q.录取分配}`);
      if (q.报名窗口) lines.push(`  报名窗口:    ${q.报名窗口}`);
      if (q.校测时间) lines.push(`  校测时间:    ${q.校测时间}`);
      if (q.可填学校) lines.push(`  可填学校:    ${q.可填学校}`);
      if (q.签约条款) lines.push(`  签约条款:    ${q.签约条款}`);
      if (q.url) lines.push(`  链接:        ${q.url}`);
      lines.push("");
    }
    if (detail.zongping) {
      const z = detail.zongping;
      lines.push("【综合评价】");
      if (z.省份?.length) lines.push(`  覆盖省份:    ${z.省份.join("、")}`);
      if (z.校测_笔试) lines.push(`  校测·笔试:   ${z.校测_笔试}`);
      if (z.校测_面试) lines.push(`  校测·面试:   ${z.校测_面试}`);
      if (z.校测_体测) lines.push(`  校测·体测:   ${z.校测_体测}`);
      if (z.录取分配) lines.push(`  录取分配:    ${z.录取分配}`);
      if (z.报名窗口) lines.push(`  报名窗口:    ${z.报名窗口}`);
      if (z.校测时间) lines.push(`  校测时间:    ${z.校测时间}`);
      if (z.可填学校) lines.push(`  可填学校:    ${z.可填学校}`);
      if (z.签约条款) lines.push(`  签约条款:    ${z.签约条款}`);
      if (z.url) lines.push(`  链接:        ${z.url}`);
      lines.push("");
    }
    if (!detail.qiangji && !detail.zongping) {
      lines.push("(该校 数据集中既无 强基 也无 综评 detail)");
    }
    process.stdout.write(lines.join("\n"));
  },

  async "gaoshui-sport"(args) {
    const { positional, flags } = parseFlags(args);
    const sport = positional[0] ?? (typeof flags.sport === "string" ? flags.sport : null);
    if (!sport) throw new Error("usage: gaokao-pro gaoshui-sport <运动名> [--json]  例: gaokao-pro gaoshui-sport 游泳");
    const schools = listGaoshuiSchoolsBySport(sport);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, query: { sport }, count: schools.length, schools });
      return;
    }
    const lines = [`高水平运动队招生 — ${sport}`, ""];
    for (const s of schools) {
      lines.push(`▸ ${s.school}${s.zs_code ? ` (${s.zs_code})` : ""}`);
      const matched = s.sports.filter((sp) => sp.name.includes(sport));
      for (const sp of matched) {
        if (sp.tier_required) lines.push(`  等级: ${sp.tier_required}`);
        if (sp.exam_window) lines.push(`  时间: ${sp.exam_window}`);
        if (sp.score_path) lines.push(`  分数路径: ${sp.score_path}`);
        if (sp.plan_count !== null) lines.push(`  计划: ${sp.plan_count}`);
        if (sp.notes) lines.push(`  备注: ${sp.notes}`);
      }
      lines.push("");
    }
    if (!schools.length) lines.push(`(没有招收 ${sport} 的院校)`);
    process.stdout.write(lines.join("\n"));
  },

  async scores(args) {
    const { positional, flags } = parseFlags(args);
    const id = positional[0];
    if (!id) throw new Error("missing schoolId. e.g. `gaokao-pro scores 31 --province henan`");
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
