# Changelog

## 0.3.3 — 2026-05-29

### Fix — 100-persona red-team 系统性修补

**Round 1 — 整省/整 verb 断链 critical bugs**:
- `slip-risk` 接受空 group_code / `auto` / 半角 `(01)` / 全角 `（01）` → **浙江/山东 整省现在能跑滑档评估** (此前 group_code="" 完全打不通)
- `inferTrack()` 对 港澳台 (71/81/82) 抛友好错误指向 `qatw` verb → recommend/paths/rank 不再 silent fail
- `paths()` 按候选分数 floor 过滤 强基/综评/港校/军校 (450 分不再"合格"清华强基)
- `国家专项` 从单条全国占位 → 23 实施省份分别注册 (`paths --rural` 在河南/四川/贵州/云南等省正确显示)
- `新疆 reform = "3+1+2"` → `"old"` (2025 仍是老高考, 3+1+2 改革2027 首届) → recommend/roadmap 整省不再返回 0 校

**Round 2 — 数据矛盾**:
- 浙大三位一体比例 `85:10:5` → `50:30:20` (浙大公开真实比例)
- 河北 huadang 4 个 case `112 志愿` → `96 志愿` (河北 2024+ 本科批是 96, 112 是辽宁)
- 内蒙古 calendar `2026 起平行替代动态投档` → `2024 起已替代` (real 政策时间)
- 云南 2025 艺术 `culture_control_line: {historical:345}` 与 `extras: no provincial control line` 自相矛盾 → 9 records 的 `culture_control_line` 置 null + 新增 notes 说明政策

**Round 3 — UX cleanup**:
- `tiqian <省>` 接受中文名 ("浙江" / "广东") 不再只认 pinyin
- `tiqian-pi --type` 支持模糊匹配 (`公费师范` 命中 `公费师范生`, `国家专项计划` 命中 `国家专项`)
- `minzu` 接受位置参数 (`minzu 河南`) 与其他 verb 一致
- `roadmap` 在无调剂省 (浙江/山东/河北/重庆/辽宁/贵州/青海) 把"⚠️ 调剂雷"改写"ℹ️ 组内冷门" (不再说"勾服从可能掉到冷门"——这些省没有勾服从这一步)
- `slip-risk` 错误信息中文化 + 列已知组提示

### Tests
- `reform-track.test.ts` 新增 港澳台 special-region throw 测试
- 全部 300+ 单元+smoke 测试通过

## 0.3.2 — 2026-05-29

### Merge — LAWTED issue #5 (worktree-ralph-loop-special-admissions)
集成 LAWTED v0.2.0 分支的特殊招生模块 (34 区域 × 3 年 × 6 类 = 1,497 条记录):

- **6 数据集** (`cli/data/datasets/special-admissions/`):
  - `art-formula-{2023,2024,2025}.json` — 艺术统考 6 大类公式 + 合格线
  - `sports-formula-{...}.json` — 体育统招 5 种 SportsFormulaKind
  - `qiangji-quota-{...}.json` — 39 强基校 × 31 省入围线
  - `zongping-{...}.json` — 浙江三位一体 / 苏沪鲁粤综评
  - `minzu-policy-{...}.json` — 加分梯度 + 民族班/预科 + 退坡时间表
  - `qatw-channel-{...}.json` — 港澳台 8 通道 (联招/居住证/保送/DSE/独立招生等)
- **3 区域** (GB/T 2260): 71 台湾 / 81 香港 / 82 澳门 (reform: "special")
- **7 新 verbs**: art-tongkao / sports-tongzhao / qiangji-line / zonghe / minzu / qatw / special-coverage
- **7 新 MCP tools** (38 → 46 总数 = 包含 outlook 共增 8)
- **34 source markdowns** + family-quickstart + coverage tracker
- **2 新测试套**: test:special (smoke 15/15) + test:validate (18 files all valid)

### Audit caveats (from parallel scan)
- ~94 zongping `confidence: low` 记录缺 `notes` 字段 (透明记数据稀疏，不是编造)
- qatw-channel-2025 dropped `admission_rate` vs 2023/24 (schema drift, 已记)
- 湖北艺术 2024/25 `formula=None, confidence=high` 但无 notes — 待 LAWTED 确认是否 2024 政策真实改动
- minzu-policy 51 (四川) 一条 `bonus: 50` 实为 民族预科 降分 (字段命名歧义，不影响数据)
- 强基入围线填充率: 2023 4.5% / 2024 35% / 2025 38% — 985 大校多 null 但 confidence:high (上游不公开)
- Loader 不复用 main 的 `load<T>` helper (技术债，下一轮统一)

## 0.3.1 — 2026-05-29

### Add — 透明倾向：📊 / 📋 / 💭 三层标签
- **roadmap pick 输出附 📋 政策依据**：每个 pick 现在自动 attach 学校的 program 政策标签（强基/公费师范/优师/综评/三位一体/中外合作综评/国家专项/高校专项/公安/军校/民族班/农村医学）— 让家长一眼看出"为什么这个学校被推"的非主观依据。
- **新 verb `outlook`** + **新数据集 `zhuanye-outlook-2030.json`** (38 个最常报+新兴专业):
  - 📊 数据事实：可验证的招生计划 + 增长率
  - 📋 政策依据：教育部 / 工信部 / 国务院 公开文件
  - 💭 我的判断：含 `outlook_2030` / `confidence` (高/中/低) / `why` / `wrong_scenario` (反例场景)
- 覆盖：集成电路/AI/量子/储能/机器人/智能制造/临床/口腔/康复/精神医学/护理 等绿榜，会计/法学/工商管理/英语/汉语言/学前教育/生物科学/应用物理/土木 等红榜。
- MCP 工具数 38 → 39 (`outlook` 暴露)。

## 0.3.0 — 2026-05-29

### UX — Coze / 中国家长 bot 优化
- **学校简称 alias 系统**：findUniversity 现在用 SCHOOL_ALIASES 映射，新增 60+ 常用简称（北邮 / 华师 / 中大 / 哈医大 / 港中深 等 → 全名）。alias 优先于 substring 匹配，避免 "华师" 错配 "西华师范"、"中大" 错配 "西北大学" 等经典 bug。
- **友好中文错误**："数据集里没找到「北京XX」；可能想找：北京舞蹈学院 / 北京电影学院" + `suggestUniversities()` helper。
- **`detectGroupTrap()` 调剂雷区检测**：扫每个组的 majors[] spcode 前 4 位，识别"热门工科（计算机/电信/AI）+ 冷门陷阱（护理/林学/应物/食品）"混搭组。`groups` 表格 + `roadmap` 每 pick 自动 attach 警告。

### Add — Coze 集成
- **`gaokao-pro server --port 3000`** — 零依赖 Node HTTP 服务器，把全部 38 个 MCP 工具暴露为 REST 端点。
  - `GET /` 健康检查
  - `GET /api/tools` 工具清单
  - `GET /openapi.json` OpenAPI 3.0 spec（Coze 插件直接 import）
  - `POST /api/tools/{name}` 调用任意工具，body = JSON args
  - CORS 默认开启
- **`paths` 输出 120 → 19 行**：默认只显示合格条目，按 program_type 折叠（`--all` 看全部含未开通的）。
- **`roadmap --format md`**：22 行 markdown 输出（emoji + 调剂雷标记 + baseline 警告），手机聊天 UI 友好。

## 0.2.2 — 2026-05-29

### Add — 2026 数据预留 + baseline 警告
- 新增 `cli/data/datasets/data-year-status.json` 记录每个数据集的 2025 baseline / 2026 公布窗口 / fallback message:
  - **college_groups**: 2026-06-25 → 07-15 (出分后)
  - **投档线**: 2026-07-15 → 07-30 (本科批投档结束后)
  - **一分一段**: 2026-06-25 → 07-01 (出分次日)
  - **提前批 catalog**: 2026-04 → 06 (各程序简章)
  - **calendar**: 2026 partial (4 confirmed + 27 tentative)
- 新增 `data-status` verb + MCP `data_status` tool (38 工具) 显示完整状态。
- **recommend / top / slip-risk / roadmap 输出尾部自动 attach `【2025 baseline 提示】`** 告知家长：
  - recommend: 基于 2025 历年最低分；2026 投档线发布前仅作参考
  - slip-risk: 2026 投档线可能波动 ±5-15 分
  - roadmap: 6/25 出分后请用真实分 + 当年一分一段重跑
- 大量 spcode 回填 (26 round-1 校 × 7 省): 82% → 98% 覆盖.

## 0.2.1 — 2026-05-29

### Fix
- `groups` verb now surfaces each major's **6-digit national 专业代码** (e.g. `"090502"` for 园林). The data was already in the underlying files (~93% coverage from gaokao.cn's `spcode` field) but the normalizer didn't expose it. Added `MAJOR_CODE_KEYS` (`spcode/code/sp_code/major_code/spname_code/zycode/zy_code/majorcode`) and added `code: string | null` to the public `Major` type.
- Added regression test guaranteeing ≥30% of majors surface a 6-digit code.

### Improve
- `groups` verb now defaults to table-mode output on TTY, with per-group section showing 专业代码 in brackets next to each major (e.g. `[080901] 计算机科学与技术 计划2`). Pipe or pass `--format json` to get the legacy JSON.
- `--format table` flag added for forcing table mode even when piped.

This directly answers questions like "if I apply to BUPT 计算机 and don't get in, what majors am I 调剂'd to?" — `groups --university 北邮 --province 河南` now lists every major in the same group with its national code, and `slip-risk` can weigh them via `--must` / `--ok` / `--reject` keyword preferences.

## 0.2.0 — 2026-05-29

Major iteration covering parent-facing 滑档 risk, 综评提前批 catalog, 高水平运动队 specialty, plus new composite verbs (`paths`, `dossier`, `roadmap`, `province-overview`).

### New verbs

- `slip-risk <学校> <省> <组> --score N [--rank N] [--must --ok --reject]` — risk verdict (high/moderate/low/comfortable) + ≤3 matching 历史 滑档 cases. Combines (score, rank) gap × province 调剂 rules × group major-spread × optional pref weighting.
- `paths <省> [--score --rank --minority --rural --serve --sport --sport-tier --language --school]` — one-call list of every applicable 提前批 / 综评 / 高水平运动队 program with ✓/✗ + caveat per row.
- `dossier <学校>` — 7-dataset aggregation per school: 招生网 + 院校专业组 + 强基/综评 校测 + 综评 by-school + 高水平运动队 + 提前批 catalog + 涉及该校的滑档 cases. Sections nullable with `_status: not_in_dataset`.
- `roadmap <省> --score --subjects [...]` — recommend 冲/稳/保 + per-pick slip-risk + paths summary + 关键提醒 caveats.
- `province-overview <省>` — mirror of dossier, but for provinces. Aggregates 调剂rules + 2026 calendar + 综评 schools open + 提前批 programs + 滑档历史 + 一分一段 + colleges admitting here.
- `calendar <省> | --list` — 2026 投档时间日历 (31 provinces; 4 confirmed + 27 tentative based on 2025).
- `huadang [<省>] [--category --list-categories]` — 滑档/退档 历史案例 (80 cases: 33 real + 47 composite, 31-province coverage).
- `xiaoce <学校>` — 强基/综评 校测 detail per school (subjects offered / 笔试-面试-体测 / 录取分配比 / 签约条款).
- `tiqian-pi [<省>] [--type --school --list-types]` — 提前批 catalog (151 programs × 16 types × 38+ provinces).
- `zongping <省>` — 综评 2026 by-school (UCAS / SUSTech / ShanghaiTech / CUHKSZ / 沪/苏/浙/鲁/粤 综评 校).
- `gaoshui-sport <运动名>` — 高水平运动队 by sport (post-2024 reform; tier_required × exam_window × score_path).
- `capabilities` — dataset health/capability report (counts across all datasets).

### New datasets

- `college-groups/*.json` — 79 → 258 schools × ~17,000 groups × ~140,000 majors. Top ~70 schools at 31-province national coverage; rest at 7-30 provinces.
- `xiaoce-detail-2025.json` — 强基/综评 校测 detail (59 schools).
- `gaoshui-yundongdui-2025.json` — Post-2024 reform 高水平运动队 (39 schools, per-sport detail incl. swim).
- `zonghepingjia-2026.json` — 综评 by-school (40 schools, cross-province coverage like UCAS).
- `tiqian-pi-programs-2025.json` — 提前批 catalog (151 programs × 16 types).
- `huadang-cases-2022-2025.json` — 滑档/退档 历史案例 (80 cases × 31 provinces × 14 categories).
- `zhiyuan-calendar-2026.json` — 31-province 2026 投档时间 calendar.

### CLI/MCP

- MCP tool count: 25 → 37.
- `recommend` / `top` outputs auto-append per-province 滑档 footer (special bold warning for 无调剂 provinces: 浙江/山东/河北/重庆/辽宁/贵州/青海).
- `slip-risk` auto-attaches ≤3 huadang precedents matching the risk signal (无调剂 / 不勾服从 / 组内冷热门 / 新高考首届).

### Web

- `softwareVersion` updated to `0.2.0` in `src/app/layout.tsx` (structured data).

### Test coverage

- 290+ tests passing (unit + integration + smoke).
- New test files: `slip-risk.test.ts` (9 cases incl. precedent contract), `paths.test.ts` (10), `dossier.test.ts` (5), `integration.test.ts` (8 cross-verb).

## 0.1.17 — prior

CLI version pinned for `recommend / top / scores / plan / actual / match / find / rank` baseline.
