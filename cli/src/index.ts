#!/usr/bin/env node
import { getSchoolInfo, getAdmissionPlan, getAdmissionScores, extractHistoricalScores } from "./gaokao-cn.js";
import { PROVINCES, TRACK_NAMES, resolveProvince, ALL_SUBJECTS, type Subject } from "./codes.js";
import { recommend } from "./recommend.js";
import { find } from "./find.js";
import { top } from "./top.js";
import { isTty, formatRecommend, formatTop } from "./format.js";
import { runMcpServer } from "./mcp.js";
import { runHttpServer } from "./http-server.js";
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
  findXiaoceDetailBySchool,
  findCasesByProvince,
  findCasesByCategory,
  loadHuadangCases,
  findCalendarByProvince,
  loadZhiyuanCalendar2026,
  loadSchoolsAdapters as loadSchoolsAdaptersFn,
  verbWarning,
  loadDataYearStatus,
  loadZhuanyeOutlook,
  findOutlookByMajor
} from "./datasets.js";
import { compare } from "./compare.js";
import { paiming } from "./paiming.js";
import { findEmployment, listEmploymentCoverage } from "./employment.js";
import { findManifest, listManifestProvinces, manifestStats } from "./manifest.js";
import { findUniversity, listGroups, safetyScore, datasetStats, slipRisk, provinceTiaojiInfo, detectGroupTrap } from "./groups.js";
import { paths as pathsFn, type ProfileLite } from "./paths.js";
import { dossier as dossierFn } from "./dossier.js";
import { roadmap as roadmapFn } from "./roadmap.js";
import { provinceOverview as provinceOverviewFn } from "./province-overview.js";
import { VERSION } from "./version.js";
// LAWTED v0.2.0 — 特殊招生 (艺术/体育/强基/综评/民族/港澳台) 6 类 × 3 年数据集
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
  coverageReport as saCoverageReport,
  validateArtCategory,
  validateQATWChannel
} from "./special-admissions.js";
import type { Year as SAYear } from "./types/special-admissions.js";

function parseSAYear(flag: unknown, fallback: SAYear = 2025): SAYear {
  if (typeof flag === "string") {
    const n = Number(flag);
    if (n === 2023 || n === 2024 || n === 2025 || n === 2026) return n as SAYear;
    throw new Error(`--year must be 2023/2024/2025/2026, got: ${flag}`);
  }
  return fallback;
}

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
// 支持家长常用简写: "物化生" → ["物理","化学","生物"], "史地政" → ["历史","地理","政治"]
// 也兼容已经是单 char 数组的形式.
function expandSubjectShorthand(subjects: string[]): string[] {
  const CHAR_MAP: Record<string, string> = {
    "物": "物理", "化": "化学", "生": "生物",
    "史": "历史", "地": "地理", "政": "政治",
    "技": "技术"
  };
  const out: string[] = [];
  for (const s of subjects) {
    const trimmed = s.trim();
    // 完整名称直通
    if (ALL_SUBJECTS.includes(trimmed as Subject)) {
      out.push(trimmed);
      continue;
    }
    // 简写: 每字一科 (e.g. "物化生" / "史地政" / "物化技")
    if (trimmed.length >= 2 && trimmed.length <= 4 && [...trimmed].every(c => c in CHAR_MAP)) {
      for (const c of trimmed) out.push(CHAR_MAP[c]);
      continue;
    }
    out.push(trimmed); // 保留, 让 validateSubjects 报错
  }
  return out;
}

function validateSubjects(subjects: string[]): Subject[] {
  const expanded = expandSubjectShorthand(subjects);
  for (const s of expanded) {
    if (!ALL_SUBJECTS.includes(s as Subject)) {
      throw new Error(`unknown subject: ${s} (valid: ${ALL_SUBJECTS.join(", ")}). 简写支持: 物化生/史地政/物化政 等 (每字一科)`);
    }
  }
  return expanded as Subject[];
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
                    [--format table|json]
      院校专业组 view for a university. Without --province, lists per-
      province group/major counts. With --province, lists each 专业组 in
      that province with all majors + their 6-位国标 专业代码 (e.g.
      [080901] 计算机科学与技术). TTY defaults to table; pipe outputs JSON.
      Pass --must/--ok/--reject to attach a safety score per group.
      e.g. gaokao-pro groups --university 北京邮电 --province 河南
           gaokao-pro groups --university 清华大学 --province henan --must 物理

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
      提前批 special-program catalog (151 programs × 16 types × 38+ provinces).
      Cross-axis query: 强基计划 (39 校) / 公费师范生 / 优师 / 综评 / 三位一体
      / 中外合作综评 / 国家专项 / 高校专项 / 公安院校 (16 校) / 军校 (27 校)
      / 农村订单医学 / 航海类 / 小语种 / 民族班 / 预科班 / 港校综评 (HKU/CUHK/
      HKUST). Each entry carries eligibility + commitment + ratio + url for
      parent-facing 履约条款 review.
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

  gaokao-pro province-overview <省份> [--json]
      省份 overview 一站聚合: 调剂rules + 2026 calendar + 综评 open
      schools + 提前批 programs eligible + 滑档 cases in 该省 + college-
      groups colleges admitting here. Mirror of dossier (school 侧).
      e.g. gaokao-pro province-overview 河南
           gaokao-pro province-overview 浙江 --json

  gaokao-pro outlook <专业名|spcode>  |  gaokao-pro outlook --list
      本科专业 2030 前景 — 三层标签 (📊 数据事实 / 📋 政策依据 / 💭 我的判断).
      覆盖 ~40 个最常报+新兴专业 (集成电路/AI/储能/机器人/临床医学/康复/
      会计/法学/工商管理 等). 每个 💭 主观判断带 confidence + wrong_scenario,
      透明标记什么是事实、什么是猜测.
      e.g. gaokao-pro outlook 集成电路
           gaokao-pro outlook 会计
           gaokao-pro outlook --list

  gaokao-pro data-status [--json]
      数据集年度状态: 2026 关键数据 (招生计划/分数线/一分一段) 公布时间
      窗口 + fallback message + per-verb baseline warning. CRITICAL:
      6 月底前 verb 用 2025 baseline，必须告诉家长 2026 何时可拿。
      recommend / slip-risk / roadmap 输出尾部自动 attach 提示。
      e.g. gaokao-pro data-status

  gaokao-pro calendar <省份> [--json]  |  gaokao-pro calendar --list
      2026 投档时间日历 (31 省): 考试日期 / 出分时间 / 各批次填报-投档-
      录取-征集时间窗 + 关键节点 (强基报名/综评校测/军检etc). 4 省官方
      确认 (上海/贵州/广西/青海), 27 省基于 2025 tentative (明示标记)。
      e.g. gaokao-pro calendar 河南
           gaokao-pro calendar --list

  gaokao-pro roadmap <省> --score N --subjects <list> [--rank N]
                          [--minority --rural --serve --sport <名>
                           --sport-tier <级> --language <非英>
                           --per-bucket N] [--json]
      完整志愿规划 — 一次串起 recommend + per-pick slip-risk + paths:
      · 冲/稳/保 三档 picks (每档默认 5 校)
      · 每 pick 标注 in_groups_dataset + 代表组 slip-risk verdict
        (🔴HIGH/🟡MOD/🟢LOW/✅OK) + 历史案例数
      · 全部 提前批/综评/运动队 可选路径 + summary
      · 关键提醒: 无调剂兜底省 / 缺位次 / 新高考首届 etc.
      e.g. gaokao-pro roadmap 河南 --score 660 --subjects 物理,化学,生物 --rank 4500

  gaokao-pro dossier <学校名> [--json]
      院校 dossier 一站式聚合：招生网+contact+program flags + 院校专业组
      summary + 强基/综评 校测 detail + 综评 by-school + 高水平运动队 +
      提前批 programs + 涉及该校的滑档历史. 替代 6-7 个独立 verb 调用。
      每个 section 独立 nullable (\"not_in_dataset\" 状态明示)，避免猜测。
      e.g. gaokao-pro dossier 清华大学
           gaokao-pro dossier 浙江大学 --json

  gaokao-pro huadang [<省份>] [--category <类>] [--list-categories] [--json]
      滑档/退档 历史案例 (2022-2025, 45 个): 真实/综合案例双标记，每条带
      考生 profile / 经过 / 教训 / 来源. 类别覆盖 不勾服从/选科不符/单科
      分/体检不符/身高体能/外语语种/专项资格/政审不过/无调剂兜底/梯度过
      密/小年大年/组内冷热门/新高考首届/旧动态投档.
      e.g. gaokao-pro huadang 河南
           gaokao-pro huadang --category 不勾服从

  gaokao-pro paths <省份> [--score N] [--rank N] [--minority] [--rural]
                         [--serve] [--sport <名>] [--sport-tier <级>]
                         [--language <非英语>] [--school <名>] [--json]
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

  gaokao-pro server [--port 3000] [--host 127.0.0.1]
      Start HTTP server exposing all tools as REST endpoints. Useful for
      Coze / 飞书 / 钉钉机器人 / non-Claude bot platforms.
      Endpoints:
        GET  /                      health + version
        GET  /api/tools             tool list
        GET  /openapi.json          OpenAPI 3.0 spec (Coze plugin import)
        POST /api/tools/{name}      call any tool; body = JSON args
      e.g.  gaokao-pro server --port 3000
            curl -X POST http://localhost:3000/api/tools/recommend \\
                 -H 'Content-Type: application/json' \\
                 -d '{"score":590,"province":"43","subjects":["物理","化学","生物"]}'

  gaokao-pro help | --help
      Show this help.

Notes:
  schoolId is gaokao.cn's internal id (NOT 教育部 5-digit zs_code).
  Run \`gaokao-pro school 31\` once to see the mapping in the 'zs_code' field.
`;

const VERBS: Record<string, Verb> = {
  async capabilities(args) {
    // 一站式 dataset health/capability report — useful for Claude (or anyone)
    // to discover what's loadable and how big each section is.
    const { flags } = parseFlags(args);
    const out: Record<string, unknown> = { version: VERSION };
    try {
      const stats = datasetStats();
      out.college_groups = { universities: stats.universities, total_groups: stats.total_groups, total_majors: stats.total_majors, year: stats.year, available_years: stats.available_years };
    } catch (e) { out.college_groups_error = String(e); }
    // Lazy-load each dataset; tolerate missing files.
    const lazyLoad = (label: string, fn: () => unknown) => {
      try { out[label] = fn(); } catch (e) { out[label + "_error"] = String(e); }
    };
    lazyLoad("school_adapters", () => ({ count: (loadSchoolsAdaptersFn().schools ?? []).length }));
    lazyLoad("tiqian_pi_catalog", () => {
      const types = listTiqianProgramTypes();
      return { types: types.length, program_types: types };
    });
    lazyLoad("zongping_2026", () => {
      // We don't have a direct count loader; count from list across known provinces
      const provinces = ["北京","上海","江苏","浙江","山东","广东","河南","湖北","湖南","福建","河北","四川","陕西","辽宁","黑龙江","吉林","内蒙古","广西","云南","贵州","甘肃","江西","安徽","天津"];
      const all = new Set<string>();
      for (const p of provinces) for (const s of listZongheSchoolsByProvince(p)) all.add(s.school);
      return { distinct_schools: all.size };
    });
    lazyLoad("gaoshui_2025", () => {
      // Probe via sport list
      const sports = ["游泳","田径","篮球","排球","足球","乒乓球","羽毛球","网球","武术套路","射击"];
      const counts: Record<string, number> = {};
      for (const s of sports) counts[s] = listGaoshuiSchoolsBySport(s).length;
      return { sports_indexed: counts };
    });
    lazyLoad("huadang_cases", () => ({ count: loadHuadangCases().cases.length, categories: loadHuadangCases().categories }));
    lazyLoad("calendar_2026", () => ({ provinces: loadZhiyuanCalendar2026().provinces.length }));
    lazyLoad("xiaoce_detail", () => {
      // Probe via a few well-known schools
      const probe = ["清华","北大","复旦","上交","浙大","南大","中科大","中山大学","华东师范","上海科技大学"];
      let hits = 0;
      for (const s of probe) if (findXiaoceDetailBySchool(s)) hits++;
      return { probe_hits: hits, probe_size: probe.length };
    });
    if (flags.json === true || flags.format === "json") { printJson({ ok: true, ...out }); return; }
    process.stdout.write("gaokao-pro capabilities\n");
    for (const [k, v] of Object.entries(out)) {
      process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
    }
  },

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

  async server(args) {
    const { flags } = parseFlags(args);
    const port = typeof flags.port === "string" || typeof flags.port === "number" ? Number(flags.port) : 3000;
    const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(`--port 必须是 1-65535 的整数，收到: ${String(flags.port)}`);
    }
    await runHttpServer(port, host);
    // The server runs forever; this never resolves naturally. Block until
    // SIGINT / SIGTERM.
    await new Promise<void>(() => undefined);
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
    // 接受中文省名或拼音; 用 resolveProvince 统一标准化
    const id = resolveProvince(province);
    let data = findProvinceSpecialty(province);
    if (!data && id) {
      // 中文名传入 → 转拼音再查
      const pinyin = PROVINCES[id].pinyin;
      data = findProvinceSpecialty(pinyin);
    }
    if (!data) {
      const friendly = listProvinceKeys().map(k => {
        // Show both pinyin + Chinese for each ingested province
        const matchId = (Object.entries(PROVINCES) as [string, {pinyin: string; name: string}][]).find(([, v]) => v.pinyin === k);
        return matchId ? `${k}/${matchId[1].name}` : k;
      }).join(", ");
      throw new Error(`「${province}」未 ingest 完整提前批数据。已 ingest: ${friendly}。其它省份可用 \`tiqian-pi <省份>\` 查 提前批 catalog (151 项目)。`);
    }
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
    if (!u) {
      const sugg = (await import("./groups.js")).suggestUniversities(uni, 3);
      const hint = sugg.length > 0 ? `；可能想找：${sugg.join(" / ")}` : `；可试简称如 北邮/北航/华师/上交 等`;
      throw new Error(`数据集里没找到「${uni}」${hint}`);
    }
    if (province) {
      const groups = listGroups(uni, province);
      const must = typeof flags["must"] === "string" ? (flags["must"] as string).split(",").map(s => s.trim()) : [];
      const ok = typeof flags["ok"] === "string" ? (flags["ok"] as string).split(",").map(s => s.trim()) : [];
      const reject = typeof flags["reject"] === "string" ? (flags["reject"] as string).split(",").map(s => s.trim()) : [];
      const enrichedGroups = groups.map(g => {
        const safety = (must.length || ok.length || reject.length) ? safetyScore(g, { must_have: must, acceptable: ok, reject }) : null;
        return { ...g, safety };
      });
      const wantTable = flags.format === "table" || (flags.format !== "json" && flags.json !== true && isTty());
      if (!wantTable) {
        printJson({ ok: true, university: u.university, code: u.code, province, groups: enrichedGroups });
        return;
      }
      // Table mode: per-group section with 专业代码 inline.
      const lines: string[] = [];
      lines.push(`院校专业组 — ${u.university}${u.code ? ` (${u.code})` : ""} / ${province}`);
      lines.push("");
      for (const g of enrichedGroups) {
        const head = [`【组 ${g.group_code}】`];
        if (g.track) head.push(g.track);
        if (g.subject_require) head.push(`选科: ${g.subject_require}`);
        if (g.category) head.push(g.category);
        if (typeof g.group_min_score === "number") head.push(`组投档线 ${g.group_min_score}${typeof g.group_min_rank === "number" ? `/${g.group_min_rank}位` : ""}`);
        lines.push(head.join(" · "));
        for (const m of g.majors) {
          const code = m.code ? `[${m.code}]` : "[      ]";
          const plan = typeof m.plan === "number" ? ` 计划${m.plan}` : "";
          const score = typeof m.min_score === "number" ? ` 最低${m.min_score}` : "";
          lines.push(`  ${code} ${m.name ?? "(unnamed)"}${plan}${score}`);
        }
        if (g.safety) {
          lines.push(`  → 调剂安全分: ${g.safety.score.toFixed(2)} (${g.safety.verdict}) · 匹配${g.safety.matched_majors.length} / 拒绝${g.safety.rejected_majors.length}`);
        }
        // Trap detection: 同组热门 + 冷门混搭 (经典 计算机 + 护理 调剂坑)
        const trap = detectGroupTrap(g);
        if (trap.is_trap && trap.spread_hint) {
          lines.push(`  ${trap.spread_hint}`);
        }
        lines.push("");
      }
      process.stdout.write(lines.join("\n"));
    } else {
      const wantTable = flags.format === "table" || (flags.format !== "json" && flags.json !== true && isTty());
      if (!wantTable) {
        printJson({ ok: true, university: u.university, code: u.code, year: u.year, provinces_count: u.provinces.length, provinces: u.provinces.map(p => ({ province: p.province, groups_count: p.groups_count, majors_total: p.majors_total })) });
        return;
      }
      const lines: string[] = [];
      lines.push(`院校专业组 总览 — ${u.university}${u.code ? ` (${u.code})` : ""} · ${u.year}`);
      lines.push(`覆盖省份: ${u.provinces.length}`);
      lines.push("");
      for (const p of u.provinces) {
        lines.push(`  ${p.province}: ${p.groups_count} 组 / ${p.majors_total} 专业`);
      }
      process.stdout.write(lines.join("\n") + "\n");
    }
  },

  async "groups-stats"() {
    printJson({ ok: true, stats: datasetStats() });
  },

  async "slip-risk"(args) {
    const { positional, flags } = parseFlags(args);
    const uni = positional[0] ?? (typeof flags.university === "string" ? flags.university : null);
    const province = positional[1] ?? (typeof flags.province === "string" ? flags.province : null);
    // groupCode: 山东/浙江 等专业平行省可传 "auto" 或省略 (auto-pick best group)
    let groupCode = positional[2] ?? (typeof flags.group === "string" ? flags.group : null);
    if (groupCode === undefined || groupCode === null) groupCode = "auto";
    if (!uni || !province) {
      throw new Error("usage: gaokao-pro slip-risk <学校> <省份> [<组号|auto>] --score <n> [--rank <n>] [--year <year>] [--must …] [--ok …] [--reject …] [--json]\n  组号留空或写 auto 时, 工具自动选最有数据的组 (适用 山东/浙江 专业平行省)");
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
    if (result.precedents && result.precedents.length > 0) {
      lines.push("");
      lines.push("相似历史案例 (precedents):");
      for (const p of result.precedents) {
        const stamp = p.is_composite ? "📌" : "📍";
        lines.push(`  ${stamp} ${p.case_id} · ${p.year} · ${p.category}`);
        lines.push(`     教训: ${p.one_line_lesson}`);
      }
      lines.push("");
      lines.push("(查看完整案例: gaokao-pro huadang " + result.province + ")");
    }
    const w = verbWarning("slip-risk");
    if (w) {
      lines.push("");
      lines.push(`【2025 baseline 提示】${w}`);
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

  async roadmap(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province) throw new Error("usage: gaokao-pro roadmap <省> --score N --subjects <list> [--rank N] [--minority --rural --serve --sport --sport-tier --language] [--per-bucket N] [--json]");
    const score = Number(flags.score);
    if (!Number.isFinite(score)) throw new Error("--score N is required");
    if (typeof flags.subjects !== "string") throw new Error("--subjects <list> is required");
    const subjects = validateSubjects(flags.subjects.split(",").map((s) => s.trim()));
    const rank = (typeof flags.rank === "string" || typeof flags.rank === "number") ? Number(flags.rank) : null;
    const result = roadmapFn({
      province,
      score,
      rank,
      subjects,
      per_bucket: flags["per-bucket"] !== undefined ? Number(flags["per-bucket"]) : 5,
      minority: flags.minority === true,
      rural: flags.rural === true,
      serve: flags.serve === true,
      sport_tier: typeof flags["sport-tier"] === "string" ? flags["sport-tier"] : null,
      sport_name: typeof flags.sport === "string" ? flags.sport : null,
      language: typeof flags.language === "string" ? flags.language : null,
    });
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...result });
      return;
    }
    // Markdown / chat mode — compact phone-friendly output for Coze / 微信 / 飞书 bot.
    if (flags.format === "md" || flags.format === "markdown" || flags.format === "chat") {
      const md: string[] = [];
      md.push(`**${province} ${score} 分${rank !== null ? `（位次 ${rank}）` : ""} · ${subjects.join("/")}**`);
      md.push("");
      const tj = result.province_rules.has_tiaoji;
      md.push(`> 调剂: ${tj === false ? "⚠️ 无 (掉档=滑档)" : tj === true ? "有 (可勾兜底)" : "?"}${result.province_rules.strategy ? " · 策略 " + result.province_rules.strategy : ""}`);
      md.push("");
      for (const [bucket, emoji] of [["冲", "🚀"], ["稳", "🎯"], ["保", "🛡"]] as const) {
        const items = result.buckets[bucket];
        if (!items.length) continue;
        md.push(`${emoji} **${bucket}** (${items.length})`);
        for (const c of items) {
          const tag = c.is985 ? "985" : c.is211 ? "211" : c.dualClass === "双一流" ? "双一流" : "";
          const tagStr = tag ? ` ${tag}` : "";
          const risk = c.representative_slip_risk;
          const verdictEmoji: Record<string, string> = { high_risk: "🔴", moderate_risk: "🟡", low_risk: "🟢", comfortable: "✅" };
          const riskStr = risk ? ` ${verdictEmoji[risk.verdict] ?? ""}` : "";
          md.push(`- ${c.name}${tagStr} (基线 ${c.baselineMinScore}, 差 ${c.delta >= 0 ? "+" : ""}${c.delta})${riskStr}`);
          if (risk && risk.trap_majors && risk.trap_majors.length > 0) {
            const tjLabel = result.province_rules.has_tiaoji === false ? "组内冷门" : "调剂雷";
            md.push(`  ⚠️ ${tjLabel}: ${risk.trap_majors.slice(0, 3).join("、")}`);
          }
          // 📋 policy basis (compact; up to 2 per pick in chat mode)
          if (c.reasoning && c.reasoning.policy_basis.length > 0) {
            for (const p of c.reasoning.policy_basis.slice(0, 2)) {
              md.push(`  📋 ${p}`);
            }
          }
        }
        md.push("");
      }
      const by = result.paths_summary.by_category;
      if (Object.keys(by).length > 0) {
        md.push(`📚 **可选路径**: ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
      }
      if (result.caveats.length) {
        md.push("");
        md.push("⚠️ **关键提醒**:");
        for (const c of result.caveats) md.push(`- ${c}`);
      }
      const w = verbWarning("roadmap");
      if (w) {
        md.push("");
        md.push(`_${w}_`);
      }
      process.stdout.write(md.join("\n") + "\n");
      return;
    }
    const lines: string[] = [];
    lines.push(`志愿规划 roadmap — ${province} · 分=${score}${rank !== null ? ` · 位次=${rank}` : ""} · 选科=${subjects.join("/")}`);
    lines.push("");
    lines.push(`【${province} 省调剂规则】单位=${result.province_rules.unit ?? "-"} · 调剂=${result.province_rules.has_tiaoji === null ? "?" : (result.province_rules.has_tiaoji ? "有" : "⚠️无")}${result.province_rules.strategy ? " · 策略=" + result.province_rules.strategy : ""}`);
    lines.push("");
    for (const [bucket, label] of [["冲", "REACH"], ["稳", "MATCH"], ["保", "SAFETY"]] as const) {
      const items = result.buckets[bucket];
      if (!items.length) continue;
      lines.push(`【${bucket}  ${label}】 ${items.length} 校`);
      for (const c of items) {
        const tags: string[] = [];
        if (c.is985) tags.push("985");
        else if (c.is211) tags.push("211");
        else if (c.dualClass === "双一流") tags.push("双一流");
        const tagStr = tags.length ? ` [${tags.join("/")}]` : "";
        const dataset = c.in_groups_dataset ? `(组数据:${c.groups_in_province ?? "?"})` : "(未在组数据集)";
        const risk = c.representative_slip_risk;
        let riskStr = "";
        if (risk) {
          const verdictLabel: Record<string, string> = {
            high_risk: "🔴HIGH", moderate_risk: "🟡MOD", low_risk: "🟢LOW", comfortable: "✅OK"
          };
          riskStr = ` · 代表组${risk.group_code}: ${verdictLabel[risk.verdict] ?? risk.verdict} (gap ${risk.score_gap === null ? "?" : (risk.score_gap >= 0 ? "+" : "") + risk.score_gap})`;
          if (risk.precedent_count > 0) riskStr += ` ·有${risk.precedent_count}个历史案例`;
        }
        lines.push(`  · ${c.name}${tagStr} delta=${c.delta >= 0 ? "+" : ""}${c.delta} (${c.baselineYear}基线${c.baselineMinScore}) · ${c.city} ${dataset}${riskStr}`);
        // 调剂雷区 提示 (热门 + 冷门同组) — 仅在有"服从调剂"机制的省份显示
        // 浙江/山东/河北/重庆/辽宁/贵州/青海 等无调剂省份不应该提"勾服从可能掉到冷门"
        if (risk && risk.trap_majors && risk.trap_majors.length > 0) {
          const hasTiaoji = result.province_rules.has_tiaoji;
          if (hasTiaoji === true) {
            lines.push(`    ⚠️ 调剂雷: ${risk.trap_majors.slice(0, 4).join("、")}${risk.trap_majors.length > 4 ? "等" : ""} (同组热门 ${risk.hot_majors_sample.slice(0, 2).join("、")} — 勾服从可能掉到冷门)`);
          } else {
            // 无调剂省 = 专业平行, 调剂雷转换为"组内冷门提示"
            lines.push(`    ℹ️ 组内冷门: ${risk.trap_majors.slice(0, 3).join("、")}${risk.trap_majors.length > 3 ? "等" : ""} (${result.province_rules.unit ?? "专业平行"}, 没有勾服从这一步)`);
          }
        }
        // 三层标签 — 推荐依据透明化
        if (c.reasoning && c.reasoning.policy_basis.length > 0) {
          for (const p of c.reasoning.policy_basis.slice(0, 3)) {
            lines.push(`    📋 ${p}`);
          }
        }
      }
      lines.push("");
    }
    lines.push(`【提前批/综评/运动队 可选路径】合格 ${result.paths_summary.total_eligible} 条`);
    for (const [cat, n] of Object.entries(result.paths_summary.by_category)) {
      lines.push(`  ${cat}: ${n} 校/项目`);
    }
    if (result.paths_summary.top_eligible.length) {
      lines.push("  Top 路径 (按数据集顺序):");
      for (const p of result.paths_summary.top_eligible) {
        lines.push(`    ✓ [${p.program_type}] ${p.school}${p.caveat ? " — " + p.caveat : ""}`);
      }
    }
    lines.push("");
    if (result.caveats.length) {
      lines.push("【关键提醒】");
      for (const c of result.caveats) lines.push(`  ⚠️ ${c}`);
    }
    const w = verbWarning("roadmap");
    if (w) {
      lines.push("");
      lines.push(`【2025 baseline 提示】${w}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async outlook(args) {
    const { positional, flags } = parseFlags(args);
    const query = positional[0] ?? (typeof flags.major === "string" ? flags.major : null);

    if (flags.list === true) {
      const file = loadZhuanyeOutlook();
      if (flags.json === true || flags.format === "json") {
        printJson({ ok: true, count: file.majors.length, majors: file.majors.map(m => ({ name: m.name, category: m.category, verdict: m.my_judgment.verdict })) });
        return;
      }
      process.stdout.write(`2030 专业前景 — ${file.majors.length} 个专业已录入\n\n`);
      const byCategory: Record<string, { name: string; verdict: string }[]> = {};
      for (const m of file.majors) {
        const cat = m.category ?? "其他";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({ name: m.name, verdict: m.my_judgment.verdict });
      }
      for (const [cat, list] of Object.entries(byCategory)) {
        process.stdout.write(`【${cat}】\n`);
        for (const m of list) process.stdout.write(`  ${m.verdict.slice(0, 2)} ${m.name}\n`);
        process.stdout.write(`\n`);
      }
      return;
    }

    if (!query) {
      throw new Error("usage: gaokao-pro outlook <专业名|spcode>  |  gaokao-pro outlook --list");
    }
    const matches = findOutlookByMajor(query);
    if (matches.length === 0) {
      throw new Error(`「${query}」未在 outlook 数据集找到 (覆盖 ${loadZhuanyeOutlook().majors.length} 个最常报+新兴专业)；试 'gaokao-pro outlook --list' 看全表`);
    }
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, count: matches.length, majors: matches });
      return;
    }
    const lines: string[] = [];
    for (const m of matches) {
      lines.push(`【${m.name}】${m.spcode_examples ? "  spcode: " + m.spcode_examples.join(" / ") : ""}${m.category ? "  分类: " + m.category : ""}`);
      lines.push(`  ${m.my_judgment.verdict}`);
      lines.push("");
      lines.push("📊 数据事实 (可验证):");
      for (const f of m.data_facts) lines.push(`  · ${f}`);
      lines.push("");
      if (m.policy_basis.length > 0) {
        lines.push("📋 政策依据 (高确定性):");
        for (const p of m.policy_basis) lines.push(`  · ${p}`);
        lines.push("");
      }
      lines.push("💭 我的判断 (主观, 可能错):");
      lines.push(`  outlook 2030: ${m.my_judgment.outlook_2030}`);
      lines.push(`  confidence: ${m.my_judgment.confidence}`);
      lines.push(`  why: ${m.my_judgment.why}`);
      lines.push(`  wrong_scenario: ${m.my_judgment.wrong_scenario}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
    process.stdout.write(lines.join("\n"));
  },

  async "data-status"(args) {
    const { flags } = parseFlags(args);
    const s = loadDataYearStatus();
    if (!s) throw new Error("data-year-status.json not found");
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...s });
      return;
    }
    const lines: string[] = [];
    lines.push(`数据集年度状态 — 填报年=${s.current_filing_year} · baseline=${s.baseline_year}`);
    lines.push("");
    for (const [name, ds] of Object.entries(s.datasets)) {
      lines.push(`【${name}】`);
      if (ds.active_year !== undefined) lines.push(`  active_year: ${ds.active_year}`);
      if (ds.status) lines.push(`  状态: ${ds.status}`);
      if (ds.expected_2026_window) lines.push(`  2026 公布窗口: ${ds.expected_2026_window}`);
      if (ds.fallback_message) lines.push(`  fallback: ${ds.fallback_message}`);
      if (ds.note) lines.push(`  备注: ${ds.note}`);
      lines.push("");
    }
    lines.push("各 verb 自带年度提示:");
    for (const [verb, msg] of Object.entries(s.verb_warnings)) {
      lines.push(`  ${verb}: ${msg}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async "province-overview"(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province) throw new Error("usage: gaokao-pro province-overview <省份> [--json]");
    const result = provinceOverviewFn(province);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...result });
      return;
    }
    const lines: string[] = [];
    lines.push(`省份 overview — ${result.province}`);
    lines.push("");

    // Rules
    lines.push("【志愿规则】");
    lines.push(`  改革: ${result.rules.reform ?? "?"} · 单位: ${result.rules.unit ?? "?"} · 调剂: ${result.rules.has_tiaoji === null ? "?" : (result.rules.has_tiaoji ? "有" : "⚠️无")}`);
    if (result.rules.slip_warning) lines.push(`  滑档提示: ${result.rules.slip_warning}`);
    if (result.rules.strategy) lines.push(`  策略: ${result.rules.strategy}`);
    lines.push("");

    // Calendar
    if (result.calendar && "_status" in result.calendar) {
      lines.push("【2026 时间日历】(无数据)");
    } else {
      const cal = result.calendar;
      const tentative = (cal as { tentative?: boolean }).tentative;
      lines.push(`【2026 时间日历】${tentative ? "⚠️ tentative (基于 2025)" : ""}`);
      if (cal.exam_dates) lines.push(`  考试: ${cal.exam_dates} · 出分: ${cal.score_release ?? "?"}`);
      for (const b of cal.batches || []) {
        const range = b.fill_start ? `${b.fill_start}${b.fill_end ? " → " + b.fill_end : ""}` : "?";
        lines.push(`  ${b.name}: 填报 ${range}${b.dispatch_date ? " · 投档 " + b.dispatch_date : ""}${b.release_date ? " · 录取 " + b.release_date : ""}`);
      }
    }
    lines.push("");

    // Totals snapshot
    lines.push("【数据集覆盖】");
    lines.push(`  综评校 (zongping):     ${result.totals.zongping_count} 校`);
    lines.push(`  提前批 programs:        ${result.totals.tiqian_count} 项 (${result.totals.program_types.length} 类型, ${result.totals.eligible_unconditional} 项无 profile 限制)`);
    lines.push(`  滑档历史 cases:        ${result.totals.huadang_count} 条`);
    lines.push(`  college-groups 校:     ${result.totals.colleges_with_groups} 校`);
    lines.push("");

    // 提前批 by type
    if (result.totals.program_types.length > 0) {
      lines.push("【可走的提前批类型】");
      const byType: Record<string, number> = {};
      for (const p of result.tiqian_programs) byType[p.program_type] = (byType[p.program_type] || 0) + 1;
      for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${t}: ${n} 校/项目`);
      }
      lines.push("");
    }

    // 综评 schools quick
    if (result.zongping_schools.length > 0) {
      lines.push("【综评 open schools】");
      for (const s of result.zongping_schools.slice(0, 12)) {
        lines.push(`  - ${s.school}${s.ratio ? " · " + s.ratio : ""}${s.seats !== null && s.seats !== undefined ? " · 计划 " + s.seats : ""}`);
      }
      if (result.zongping_schools.length > 12) lines.push(`  …+${result.zongping_schools.length - 12} 校`);
      lines.push("");
    }

    // huadang preview
    if (result.huadang_cases.length > 0) {
      lines.push("【涉及该省的滑档案例】");
      for (const c of result.huadang_cases.slice(0, 5)) {
        const stamp = c.is_composite ? "📌" : "📍";
        lines.push(`  ${stamp} ${c.case_id} · ${c.year} · ${c.category}${c.school ? " · " + c.school : ""}`);
      }
      if (result.huadang_cases.length > 5) lines.push(`  …+${result.huadang_cases.length - 5} 案例 (查看 gaokao-pro huadang ${result.province})`);
      lines.push("");
    }

    // colleges admitting
    if (result.colleges_admitting.length > 0) {
      lines.push(`【college-groups 数据覆盖的校 (该省招生)】 ${result.colleges_admitting.length} 校`);
      const top = result.colleges_admitting.sort((a, b) => b.majors_total - a.majors_total).slice(0, 15);
      for (const c of top) {
        lines.push(`  · ${c.name}${c.code ? ` (${c.code})` : ""} - ${c.groups_count} 组 / ${c.majors_total} 专业`);
      }
      if (result.colleges_admitting.length > 15) lines.push(`  …+${result.colleges_admitting.length - 15} 校`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async calendar(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!province) {
      if (flags.list === true) {
        const file = loadZhiyuanCalendar2026();
        const provinces = file.provinces.map(p => p.province);
        if (flags.json === true || flags.format === "json") { printJson({ ok: true, count: provinces.length, provinces }); return; }
        process.stdout.write("2026 投档时间日历 — 覆盖省份:\n" + provinces.map(p => "  - " + p).join("\n") + "\n");
        return;
      }
      throw new Error("usage: gaokao-pro calendar <省份> [--json]  |  gaokao-pro calendar --list");
    }
    const cal = findCalendarByProvince(province);
    if (!cal) {
      throw new Error(`no 2026 calendar found for ${province}. Try 'gaokao-pro calendar --list'.`);
    }
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...cal });
      return;
    }
    const lines: string[] = [];
    const tentative = (cal as { tentative?: boolean; based_on_year?: number }).tentative;
    const basedYear = (cal as { based_on_year?: number }).based_on_year;
    lines.push(`2026 投档时间日历 — ${cal.province}${tentative ? ` ⚠️ tentative (基于 ${basedYear ?? "?"} 年)` : ""}`);
    if (cal.exam_dates) lines.push(`  考试: ${cal.exam_dates}`);
    if (cal.score_release) lines.push(`  出分: ${cal.score_release}`);
    lines.push("");
    for (const b of cal.batches || []) {
      lines.push(`【${b.name}】`);
      if (b.fill_start) lines.push(`  填报: ${b.fill_start}${b.fill_end ? " → " + b.fill_end : ""}`);
      if (b.dispatch_date) lines.push(`  投档: ${b.dispatch_date}`);
      if (b.release_date) lines.push(`  录取查询: ${b.release_date}`);
      if (b.supplementary_fill) lines.push(`  征集填报: ${b.supplementary_fill}`);
      if (b.supplementary_release) lines.push(`  征集查询: ${b.supplementary_release}`);
      if (b.notes) lines.push(`  备注: ${b.notes}`);
      lines.push("");
    }
    if (cal.key_milestones?.length) {
      lines.push("【关键节点】");
      for (const m of cal.key_milestones) lines.push(`  ${m.date}: ${m.event}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async dossier(args) {
    const { positional, flags } = parseFlags(args);
    const school = positional[0] ?? (typeof flags.school === "string" ? flags.school : null);
    if (!school) throw new Error("usage: gaokao-pro dossier <学校名> [--json]");
    const result = dossierFn(school);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...result });
      return;
    }
    const lines: string[] = [];
    lines.push(`院校 dossier — ${result.school}${result.zs_code ? ` (${result.zs_code})` : ""}`);
    lines.push(`数据覆盖: ${result.totals.sections_with_data} / ${result.totals.sections_with_data + result.totals.sections_missing} 个 section`);
    lines.push("");

    // 1) Adapter
    if (result.adapter && "_status" in result.adapter) {
      lines.push("【招生网 + program flags】(无数据)");
    } else {
      const a = result.adapter;
      lines.push("【招生网 + program flags】");
      if (a.zsw_url) lines.push(`  招生网: ${a.zsw_url}`);
      if (a.contact?.phone) lines.push(`  电话:   ${a.contact.phone}`);
      if (a.contact?.email) lines.push(`  邮箱:   ${a.contact.email}`);
      const flagMap: [string, string][] = [
        ["qiangji", "强基"],
        ["zonghepingjia", "综评"],
        ["zhongwai_hezuo", "中外合作"],
        ["guojia_zhuanxiang", "国家专项"],
        ["gaoxiao_zhuanxiang", "高校专项"],
        ["minzu_ban", "民族班"],
        ["yuke_ban", "预科班"],
        ["gao_shui_yundong", "高水平运动队"],
        ["high_art", "艺术类"],
      ];
      const open: string[] = [];
      for (const [k, label] of flagMap) {
        const v = (a.programs as Record<string, unknown>)[k];
        if (v === true || (typeof v === "object" && v !== null && "offers" in v && (v as { offers?: boolean }).offers === true)) {
          open.push(label);
        }
      }
      if (open.length) lines.push(`  开设项目: ${open.join("、")}`);
    }
    lines.push("");

    // 2) Groups summary
    if (result.groups_summary && "_status" in result.groups_summary) {
      lines.push("【院校专业组】(无数据)");
    } else {
      const g = result.groups_summary;
      lines.push("【院校专业组】");
      lines.push(`  ${g.year}: ${g.provinces_count} 省 / ${g.groups_count} 组 / ${g.majors_total} 专业`);
      lines.push(`  覆盖省份: ${g.province_names.join("、")}`);
    }
    lines.push("");

    // 3) Xiaoce
    if (result.xiaoce && "_status" in result.xiaoce) {
      lines.push("【强基/综评 校测 detail】(无数据)");
    } else {
      const x = result.xiaoce;
      lines.push("【强基/综评 校测 detail】");
      if (x.qiangji) {
        lines.push(`  强基: 笔试=${x.qiangji.校测_笔试 ?? "?"} · 面试=${x.qiangji.校测_面试 ?? "?"} · 分配=${x.qiangji.录取分配 ?? "?"}`);
      }
      if (x.zongping) {
        lines.push(`  综评: 覆盖省=${(x.zongping.省份 || []).join("、")} · 校测=${x.zongping.校测_面试 ?? x.zongping.校测_笔试 ?? "?"} · 分配=${x.zongping.录取分配 ?? "?"}`);
      }
    }
    lines.push("");

    // 4) Zongping
    if (result.zongping && "_status" in result.zongping) {
      lines.push("【综评 by-school】(无数据)");
    } else {
      const z = result.zongping;
      lines.push("【综评 by-school】");
      lines.push(`  覆盖省份: ${z.provinces.join("、")}`);
      if (z.entry.ratio) lines.push(`  分配比: ${z.entry.ratio}`);
      if (z.entry.seats !== null && z.entry.seats !== undefined) lines.push(`  计划: ${z.entry.seats}`);
    }
    lines.push("");

    // 5) Gaoshui
    if (result.gaoshui && "_status" in result.gaoshui) {
      lines.push("【高水平运动队】(无数据)");
    } else {
      const g = result.gaoshui;
      lines.push(`【高水平运动队】 (${g.sports_count} 项目)`);
      for (const sp of g.school.sports) {
        const detail = [sp.tier_required, sp.score_path].filter(Boolean).join(" · ");
        lines.push(`  - ${sp.name}${detail ? ` (${detail})` : ""}`);
      }
    }
    lines.push("");

    // 6) Tiqian programs
    if (result.tiqian_programs.length === 0) {
      lines.push("【提前批 programs】(无数据)");
    } else {
      lines.push(`【提前批 programs】 (${result.tiqian_programs.length} 项)`);
      for (const p of result.tiqian_programs) {
        const epLabel = (p.eligible_provinces || []).slice(0, 5).join("、") + ((p.eligible_provinces || []).length > 5 ? "…" : "");
        lines.push(`  [${p.program_type}] · 覆盖: ${epLabel}`);
      }
    }
    lines.push("");

    // 7) Huadang cases
    if (result.huadang_cases.length === 0) {
      lines.push("【涉及该校的滑档历史案例】(无数据)");
    } else {
      lines.push(`【涉及该校的滑档历史案例】 (${result.huadang_cases.length} 条)`);
      for (const c of result.huadang_cases) {
        const stamp = c.is_composite ? "📌" : "📍";
        lines.push(`  ${stamp} ${c.case_id} · ${c.year} ${c.province} · ${c.category}`);
        lines.push(`     ${c.what_happened.length > 100 ? c.what_happened.slice(0, 100) + "…" : c.what_happened}`);
      }
    }
    process.stdout.write(lines.join("\n") + "\n");
  },

  async huadang(args) {
    const { positional, flags } = parseFlags(args);
    const province = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    const category = typeof flags.category === "string" ? flags.category : null;
    if (!province && !category && !flags["list-categories"]) {
      throw new Error("usage: gaokao-pro huadang [<省份>] [--category <类型>] [--list-categories] [--json]");
    }
    if (flags["list-categories"] === true) {
      const file = loadHuadangCases();
      if (flags.json === true || flags.format === "json") { printJson({ ok: true, categories: file.categories }); return; }
      process.stdout.write("滑档/退档 分类:\n" + file.categories.map(c => `  - ${c}`).join("\n") + "\n");
      return;
    }
    let cases = province ? findCasesByProvince(province) : loadHuadangCases().cases;
    if (category) cases = cases.filter(c => c.category === category);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, query: { province, category }, count: cases.length, cases });
      return;
    }
    const lines: string[] = [];
    const header = province ? `滑档/退档历史案例 — ${province}${category ? " · " + category : ""}` : `滑档/退档历史案例 · ${category}`;
    lines.push(header, "");
    if (cases.length === 0) {
      lines.push("(无匹配案例)");
    }
    for (const c of cases) {
      const stamp = c.is_composite ? "📌(综合案例)" : "📍(实例)";
      lines.push(`${stamp} ${c.case_id} · ${c.year} ${c.province} · ${c.type} · ${c.category}${c.school ? " · " + c.school : ""}`);
      lines.push(`  考生: ${c.candidate_profile_summary}`);
      lines.push(`  经过: ${c.what_happened}`);
      lines.push(`  教训: ${c.lesson}`);
      if (c.tags?.length) lines.push(`  标签: ${c.tags.join("、")}`);
      if (c.source_hint) lines.push(`  来源: ${c.source_hint}`);
      lines.push("");
    }
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
      school_filter: typeof flags.school === "string" ? flags.school : null,
    };
    const result = pathsFn(profile);
    if (flags.json === true || flags.format === "json") {
      printJson({ ok: true, ...result });
      return;
    }
    const showAll = flags.all === true || flags.verbose === true;
    const lines: string[] = [];
    lines.push(`志愿路径 — ${province}${profile.score ? " · 分=" + profile.score : ""}${profile.rank ? " · 位次=" + profile.rank : ""}`);
    const profileBits = [
      profile.is_minority ? "少数民族" : null,
      profile.is_rural_county ? "农村专项" : null,
      profile.agree_to_serve ? "同意服务期" : null,
      profile.sport_tier ? `体育=${profile.sport_tier}/${profile.sport_name ?? "?"}` : null,
      profile.small_language ? `第一外语=${profile.small_language}` : null,
    ].filter(Boolean);
    if (profileBits.length > 0) lines.push(`profile: ${profileBits.join(" / ")}`);
    lines.push("");
    lines.push(`调剂规则: 单位=${result.province_rules.unit ?? "-"} · 调剂=${result.province_rules.has_tiaoji === false ? "⚠️无" : "有"}${result.province_rules.strategy ? " · " + result.province_rules.strategy : ""}`);
    lines.push("");
    lines.push(`合格 ${result.total_eligible} 条 (有约束/未开 ${result.total_caveat - result.total_eligible} 条)`);
    lines.push("");

    // Group by category. Default: only show ELIGIBLE entries, collapsed by
    // program_type. With --all, show ineligible too.
    const byCat: Record<string, typeof result.pathways> = {};
    for (const p of result.pathways) {
      if (!showAll && !p.eligible) continue;
      if (!byCat[p.category]) byCat[p.category] = [];
      byCat[p.category].push(p);
    }
    for (const [cat, list] of Object.entries(byCat)) {
      // Bucket by program_type within category to collapse duplicates.
      const byType: Record<string, typeof list> = {};
      for (const p of list) {
        const t = p.program_type ?? "其他";
        if (!byType[t]) byType[t] = [];
        byType[t].push(p);
      }
      lines.push(`【${cat}】 ${list.length} 项`);
      for (const [t, ps] of Object.entries(byType)) {
        const schools = ps.map(p => p.school);
        const compact = schools.length > 6
          ? `${schools.slice(0, 5).join("、")}…+${schools.length - 5}`
          : schools.join("、");
        const caveat = ps[0].caveat ? `  — ${ps[0].caveat}` : "";
        lines.push(`  [${t}] (${ps.length}) ${compact}${caveat}`);
      }
      lines.push("");
    }

    if (!showAll) {
      // Footer: hint at how to see all (including the closed/ineligible ones).
      const ineligible = result.pathways.filter(p => !p.eligible).length;
      if (ineligible > 0) {
        lines.push(`(隐藏了 ${ineligible} 条不合格条目；--all 显示全部含未开通路径)`);
      }
    }
    process.stdout.write(lines.join("\n") + "\n");
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
  },

  // ---- LAWTED v0.2.0 — 特殊招生 (艺术/体育/强基/综评/民族/港澳台) 7 verbs ----

  async "art-tongkao"(args) {
    const { positional, flags } = parseFlags(args);
    const pa = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!pa) throw new Error("usage: gaokao-pro art-tongkao <省份> [--category <类>] [--year 2023|2024|2025|2026]");
    const id = resolveProvince(pa);
    if (!id) throw new Error(`unknown province: ${pa}`);
    const year = parseSAYear(flags.year);
    if (typeof flags.category === "string") {
      const category = validateArtCategory(flags.category);
      const rec = findArtFormula(id, category, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, category, year }, record: rec });
    } else {
      const list = listArtFormulasForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    }
  },

  async "sports-tongzhao"(args) {
    const { positional, flags } = parseFlags(args);
    const pa = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!pa) throw new Error("usage: gaokao-pro sports-tongzhao <省份> [--year 2023|2024|2025|2026]");
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
    const { positional, flags } = parseFlags(args);
    // Accept either positional or --province (consistent with paths/dossier/etc.)
    const pa = positional[0] ?? (typeof flags.province === "string" ? flags.province : null);
    if (!pa) throw new Error("usage: gaokao-pro minzu <省份>  |  gaokao-pro minzu --province <name|id>");
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
      const channel = validateQATWChannel(flags.channel);
      const rec = findQATWChannel(id, channel, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, channel, year }, record: rec });
    } else {
      const list = listQATWForRegion(id, year);
      printJson({ ok: true, query: { region: id, name: PROVINCES[id].name, year }, count: list.length, records: list });
    }
  },

  async "special-coverage"() {
    printJson({ ok: true, coverage: saCoverageReport() });
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
