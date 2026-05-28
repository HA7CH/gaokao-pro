# gaokao-pro

用 Claude Code 规划你的高考。
[gaokao.ha7ch.com](https://gaokao.ha7ch.com)

把下面这段 prompt 粘进 Claude Code / Codex / Cursor：

```
跑 `npx gaokao-pro@latest help` 把命令摸清楚，然后帮我规划 2026 年的高考志愿。

先问我：分数（估分 / 模考分 / 高考分都行，标清楚是哪种）、省份、选科组合、目标专业方向或职业兴趣、偏好（目标城市 / 是否限定 985/211 / 学费预算）。如果给的是估分或模考分，参考 2023-2025 历年一分一段做粗估位次；等高考真实分数出来再用 2026 当年一分一段精算。

每条推荐都用 CLI 拉真实数据支撑——查历年最低分、跨校搜专业、把分数换算成位次区间。
```

## Install

```bash
npx gaokao-pro@latest help
```

Or globally:

```bash
npm install -g gaokao-pro
```

(Curl|bash installer is also still available:
`curl -fsSL https://raw.githubusercontent.com/HA7CH/gaokao-pro/main/install.sh | bash`)

## How it works

`gaokao-pro` is a CLI + MCP server that grounds an AI conversation in
official Chinese college-admissions data. Claude drives the flow; the
CLI is the data spine.

Tools Claude can call (via Bash or MCP):

**Mainline (普通类志愿规划)**

| Verb        | What it does                                                              |
|-------------|---------------------------------------------------------------------------|
| `recommend` | 冲 / 稳 / 保 buckets for your score in a province (offline, 2,400+ schools) |
| `top`       | Top-N best schools your score can reach                                   |
| `find`      | Search majors across schools — e.g. all 985 schools recruiting 计算机       |
| `school`    | University metadata: 985 / 211 / 双一流 / 学科评估 / 排名                    |
| `plan`      | Forward-looking admission plan (year × province × school)                 |
| `actual`    | Backward-looking actual admissions: 最高/最低/平均分 + 最低位次              |
| `scores`    | Historical min-score time series for a (school, province) pair            |
| `rank`      | score ↔ 全省位次 via official 一分一段表 (beijing 2023-2025 ingested)        |
| `provinces` | List 34 regions (31 mainland + 港/澳/台) with 新高考 reform mode            |
| `mcp`       | Run as MCP server — `claude mcp add gaokao-pro -- npx -y gaokao-pro mcp`  |

**Special admissions (特殊招生 — v0.2.0)** — 服务艺术 / 体育 / 强基 / 综评 / 民族 / 港澳台家庭

| Verb               | What it does                                                                |
|--------------------|-----------------------------------------------------------------------------|
| `art-tongkao`      | 艺术统考 6 大类(美术/音乐/舞蹈/表导/播音/书法)综合分公式 + 合格线 × 3 年        |
| `sports-tongzhao`  | 体育统招公式 5 种 kind(加权/直接相加/按专业课/按高考总分/本专合一)+ 控制线   |
| `qiangji-line`     | 强基计划 39 校 × 31 省 × 3 年 入围线 + 招生量 + 复交南"报名即入围"标记         |
| `zonghe`           | 综合评价 — 浙江三位一体 / 江苏 A-B 类 / 沪鲁粤京 11 校 主流公式 + 入围线       |
| `minzu`            | 少数民族加分梯度 + 民族班/预科降分;含 9 民族大省 + 11 退坡省 rollback 时间表  |
| `qatw`             | 港澳台双向通道:全国联招 / 居住证高考 / 保送生 / DSE 互认 / 港校独立 / 学测     |
| `special-coverage` | 18 个特殊招生 dataset 的覆盖率统计                                            |

Data sources:
- **`static-data.gaokao.cn`** (中国教育在线 / 掌上高考 static JSON tier) —
  no auth, no sign, no rate limit. Powers `school` / `plan` / `actual` /
  `scores` / `find` / the offline index for `recommend` / `top`.
- **`cli/data/yifenyiduan/`** — extracted 一分一段表 JSON, per province per
  year per track. Beijing 2023-2025 ingested. Roadmap: 34 regions.
- **`cli/data/datasets/special-admissions/`** — v0.2.0 ships 18 JSON files
  (6 categories × 3 years) totaling **1,497 records** covering 34 regions for
  特殊招生. Source markdowns at `docs/special-admissions-3year/`.
  Family quickstart at `docs/family-quickstart.md`; coverage details at
  `docs/coverage-tracker-special-admissions.md`; release notes in `CHANGELOG.md`.

## Repo

```
gaokao-pro/
├── cli/                                  # npm package
│   ├── src/
│   │   ├── index.ts                      # CLI router + help (17 verbs incl. 7 special)
│   │   ├── gaokao-cn.ts                  # static-data.gaokao.cn client
│   │   ├── recommend.ts                  # 冲/稳/保 algorithm (offline)
│   │   ├── top.ts / find.ts              # top-N + cross-school search
│   │   ├── rank-table.ts                 # 一分一段 loader (score ↔ rank)
│   │   ├── mcp.ts                        # stdio MCP server (27 tools incl. 7 special)
│   │   ├── special-admissions.ts         # v0.2.0 — 特殊招生 loader (artic/sports/qiangji/...)
│   │   ├── types/special-admissions.ts   # v0.2.0 — 6 record interfaces + dataset shape
│   │   ├── format.ts / index-loader.ts / probe.ts
│   │   ├── codes.ts                      # 34 region codes (31 mainland + 71/81/82)
│   │   └── provinces/                    # province-bureau fallback adapters
│   ├── data/
│   │   ├── school-index.json.gz          # 2,422-school corpus (1 MB gzipped)
│   │   ├── yifenyiduan/                  # 一分一段 (beijing 2023/24/25 + 山东/广东/四川 物理类)
│   │   └── datasets/
│   │       ├── qiangji-2024.json         # 39 强基校清单
│   │       ├── zonghepingjia-2024.json   # 综评校清单
│   │       └── special-admissions/       # v0.2.0 — 18 JSON files (6 cat × 3 yr,1,497 records)
│   └── test/
│       ├── smoke.ts                      # live API smoke
│       └── special-admissions.smoke.ts   # offline 15 smoke checks
├── src/                                  # gaokao.ha7ch.com landing page
└── docs/
    ├── data-sources.md
    ├── coverage-tracker-special-admissions.md   # v0.2.0 progress matrix
    └── special-admissions-3year/                # 34 region 3-year markdowns
```

## Develop

```bash
pnpm install
pnpm dev                            # gaokao.ha7ch.com landing on :3000
pnpm -C cli dev recommend --score 660 --province henan --subjects 物理,化学,生物 --985
pnpm -C cli test                    # 10 smoke checks against live API + local data
pnpm -C cli probe                   # rebuild cli/data/school-index.json.gz
pnpm -C cli build                   # tsc → cli/dist/
```

## v0.2.0 — Special admissions (特殊招生)

For families targeting 艺术 / 体育 / 强基 / 综评 / 港澳台 / 民族班,gaokao-pro v0.2.0 adds:

- **34 regions** indexed (31 mainland + 71 台湾 / 81 香港 / 82 澳门 per GB/T 2260)
- **3 年历史** (2023/2024/2025) coverage,捕捉新高考改革过渡(8 省 2024 首届 / 7 省 2025 首届 / 新疆 2027)
- **6 类数据集** with **1,497** structured records:
  - **艺术统考**: 6 大类公式(美设/音乐/舞蹈/表导/播音/书法),含河南 5 选 1、云南 2025 取消省线、湖北 ×2 还原、辽宁百分制再加权 等独有口径
  - **体育统招**: 5 种 SportsFormulaKind — weighted / additive(湘青)/ professional_first(陕甘)/ gaokao_only(海南)/ merged_specline(重庆 25 本专合一)
  - **强基计划**: 39 校 × 31 省 × 3 年 入围线 + 报名即入围 12 校标记 + 西部 75% 文化门槛(甘青宁新)
  - **综合评价**: 浙江三位一体 39 校(独有学考维度)+ 江苏 23 校 A/B 类 + 沪鲁粤 11 校 85+15
  - **民族政策**: 9 民族大省加分梯度(甘肃两州五县 +20 全国最高、新疆单列类 +15、西藏双联户 +10)+ 11 退坡省 rollback 时间表
  - **港澳台通道**: 全国联招 / 居住证高考 / 保送生(澳特有)/ DSE 互认(港特有)/ 学测申请陆校(台特有,2025 已覆盖 451 内地校)/ 陆生申请台校(2020/04/09 起暂停)

Quick start:

```bash
gaokao-pro art-tongkao --province 河南 --category 美术与设计 --year 2025
gaokao-pro sports-tongzhao --province 湖北 --year 2025   # 1.25 系数独有
gaokao-pro qiangji-line --school 清华大学 --province 北京 --year 2025
gaokao-pro zonghe --province 浙江 --year 2025             # 三位一体 39 校
gaokao-pro minzu --province 广西 --year 2025              # 三统一 +15 梯度
gaokao-pro qatw 香港 --channel 全国联招 --year 2025       # 2025 暴涨线 430/460
gaokao-pro special-coverage                                # dataset coverage stats
```

Source markdowns at `docs/special-admissions-3year/{pinyin}.md` (one per region).
Coverage tracker at `docs/coverage-tracker-special-admissions.md`.

## Adding a new province's 一分一段

The infrastructure is in place — adding a new province is a JSON drop:

1. Get the 一分一段表 PDF/Excel from the 省考试院 (see `docs/data-sources.md` for URLs).
2. Extract rows in this shape:
   ```json
   {
     "province": "henan",
     "province_name": "河南",
     "year": 2024,
     "track": "physics",
     "source": "河南省教育考试院 (heao.com.cn)",
     "count": 547,
     "rows": [
       { "score": 700, "count": 12, "cumulative": 12 },
       { "score": 699, "count": 18, "cumulative": 30 }
     ]
   }
   ```
3. Save to `cli/data/yifenyiduan/{province-pinyin}-{year}-{track}.json`.
4. `rank` / `rank-tables` / MCP pick it up automatically.

Tracks: `combined` (3+3 provinces), `physics` / `history` (3+1+2), `science` / `liberal` (老高考).

## License

MIT. Part of [HA7CH](https://ha7ch.com) — sibling of `job-pro` and `cv-pro`.
