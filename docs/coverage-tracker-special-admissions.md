# Special Admissions Coverage Tracker

**Goal**: Serve every Chinese gaokao family — 31 mainland province-level units + 3 special regions (HK/MO/TW) = 34 total.

**Ralph Loop**: source-of-truth for what's done. Update each iteration.

**Started**: 2026-05-29 (iter 1)
**Last updated**: 2026-05-29 (iter 2)

## Geographic Coverage

| Code | Region | Type | Reform | Research | On disk | Schema | CLI cmd |
|---|---|---|---|---|---|---|---|
| 11 | 北京 | 直辖市 | 3+3 | ✅ | ✅ | ❌ | ❌ |
| 12 | 天津 | 直辖市 | 3+3 | ✅ | ✅ | ❌ | ❌ |
| 13 | 河北 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 14 | 山西 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 15 | 内蒙古 | 自治区 | old → 26首届 | ✅ | ✅ | ❌ | ❌ |
| 21 | 辽宁 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 22 | 吉林 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 23 | 黑龙江 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 31 | 上海 | 直辖市 | 3+3 (17首届) | ✅ | ✅ | ❌ | ❌ |
| 32 | 江苏 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 33 | 浙江 | 省 | 3+3 (17首届) | ✅ | ✅ | ❌ | ❌ |
| 34 | 安徽 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 35 | 福建 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 36 | 江西 | 省 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 37 | 山东 | 省 | 3+3 (20首届) | ✅ | ✅ | ❌ | ❌ |
| 41 | 河南 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 42 | 湖北 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 43 | 湖南 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 44 | 广东 | 省 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 45 | 广西 | 自治区 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 46 | 海南 | 省 | 3+3 (20首届) + 900制 | ✅ | ✅ | ❌ | ❌ |
| 50 | 重庆 | 直辖市 | 3+1+2 (21首届) | ✅ | ✅ | ❌ | ❌ |
| 51 | 四川 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 52 | 贵州 | 省 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 53 | 云南 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 54 | 西藏 | 自治区 | old + A/B双线制 | ✅ | ✅ | ❌ | ❌ |
| 61 | 陕西 | 省 | 3+1+2 (25首届) | ✅ | ✅ | ❌ | ❌ |
| 62 | 甘肃 | 省 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 63 | 青海 | 省 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 64 | 宁夏 | 自治区 | 3+1+2 (24首届) | ✅ | ✅ | ❌ | ❌ |
| 65 | 新疆 | 自治区 | old → 27首届 | ✅ | ✅ | ❌ | ❌ |
| 71 | 台湾 | 特殊 | 联招+学测 451校(陆生→台 20年起停) | ✅ | ✅ | ❌ | ❌ |
| 81 | 香港 | 特别行政区 | 联招+港校独立+港中大/港城提前批+DSE互认 | ✅ | ✅ | ❌ | ❌ |
| 82 | 澳门 | 特别行政区 | 联招+保送+6校独立(四校联考内地不可参加) | ✅ | ✅ | ❌ | ❌ |

**Summary**: **34/34 researched · 34/34 on disk** · 0/34 in schema · 0/34 in CLI

**codes.ts**: ✅ 34 regions (71/81/82 with reform="special")

## Gap Inventory

### P0 — Coverage gaps (Ralph Loop blocking) — **DONE**
- [x] HK/MO/TW agents complete (iter 1)
- [x] Add codes 71/81/82 to `cli/src/codes.ts` (iter 1)
- [x] Verify TS build passes after codes change (iter 1, build green)

### P1 — Data persistence — **DONE**
- [x] Write 31 province × 3yr research to `docs/special-admissions-3year/{pinyin}.md` (iter 2)
- [x] Write 3 special regions to disk (iter 1)
- [x] INDEX.md updated with all 34 ✅ (iter 2)

### P2 — Schema design — **DONE iter 2**
- [x] `cli/src/types/special-admissions.ts` — TS interfaces compiled (build green)
  - `ArtFormulaRecord` — 6 大类公式 + 合格线
  - `SportsFormulaRecord` — 5 种 `SportsFormulaKind`(weighted/additive/professional_first/gaokao_only/merged_specline)
  - `QiangjiQuotaRecord` — 39 校 × 31 省 × 3 年 入围线矩阵 + 西部 75% 门槛标记
  - `ZongPingRecord` — 含 `is_sanweiyiti` 浙江独有维度
  - `MinzuPolicyRecord` — 多档 `MinzuBonusTier[]` + 退坡时间表 `rollback_schedule`
  - `QATWChannelRecord` — 8 类 `QATWChannelType`(联招/居住证/保送/DSE/港校独立/澳校独立/学测/陆生赴台)
- [x] `RegionId = ProvinceId | 71 | 81 | 82` 覆盖 34 地

### P2b — JSON data population — **DONE iter 3** (17/18 files)
- [ ] `cli/data/datasets/special-admissions/art-formula-2023.json` (skipped — 旧高考稀疏数据,Task #8)
- [x] `cli/data/datasets/special-admissions/art-formula-{2024,2025}.json` — 25=289 records 31 regions, 24=similar
- [x] `cli/data/datasets/special-admissions/sports-formula-{2023,2024,2025}.json` — 31×3=93 records, all 31 mainland
- [x] `cli/data/datasets/special-admissions/qiangji-quota-{2023,2024,2025}.json` — 22/50/149 records (growing coverage)
- [x] `cli/data/datasets/special-admissions/zongping-{2023,2024,2025}.json` — 90/101/117 records, 6 大综评省全覆盖
- [x] `cli/data/datasets/special-admissions/minzu-policy-{2023,2024,2025}.json` — 20×3=60 records, 9 民族大省 + 11 退坡省全覆盖,含 rollback_schedule
- [x] `cli/data/datasets/special-admissions/qatw-channel-{2023,2024,2025}.json` — 11×3=33 records,3 地区 × 多通道

### P3 — CLI commands — **DONE iter 3**
- [x] `art-tongkao --province <P> [--category <C>] --year <Y>`
- [x] `sports-tongzhao --province <P> --year <Y>`
- [x] `qiangji-line [--school <S>] [--province <P>] --year <Y>`
- [x] `zonghe --province <P> [--school <S>] --year <Y>`
- [x] `minzu --province <P> --year <Y>`
- [x] `qatw <region> [--channel <C>] --year <Y>`
- [x] `special-coverage` — dataset coverage stats
- 7 verbs + HELP text + smoke test (15/15 passing)
- TS build green

### P3b — MCP tool registration — **DONE iter 3**
- [x] 7 tools added to `cli/src/mcp.ts` TOOLS array
- [x] 7 cases added to handler switch
- [x] TS build green
- Claude can now call `art_tongkao`/`sports_tongzhao`/`qiangji_line`/`zonghe`/`minzu`/`qatw`/`special_coverage` via MCP

### P4 — Known data quality issues to audit
- [ ] 青海 2025 艺术 6 类合格线(N/A,需 OCR 省考试院 PDF)
- [ ] 天津 2023-25 强基分校精确名额(N/A)
- [ ] 福建厦大 2025 强基新增 24 人(disputed,可能与单招混淆)
- [ ] 四川 2025 合格线 80% 提升(未在文件原文明示)
- [ ] 江苏 B 类综评录取分披露率低(仅 4 校公开)
- [x] 新疆 prompt 错把 "24 首届" — 实际 27 首届(已在 xinjiang.md 标注)
- [x] 山西 prompt 错把 "25 末年 old" — 实际 25 首届新高考(已在 shanxi.md 标注)

### P5 — Release prep — **DONE iter 4**
- [x] README 更新 — Mainline + Special admissions 双表 + v0.2.0 章节
- [x] 版本 bump 0.1.5 → 0.2.0(package.json + cli/src/index.ts VERSION)
- [x] art-formula-2023.json 补全(97 records,25 regions)
- [x] CI/test 集成(test:special script in package.json)
- [x] git commit in worktree branch worktree-ralph-loop-special-admissions
- [x] npm pack --dry-run 验证:18 JSON 文件都将 publish
- [ ] **user action**: merge worktree branch → main + npm publish + git push

## Ralph Loop Iteration Plan

Loop runs until **可以发布线上给 10 万高考家庭使用** — every cell ✅ AND P4 resolved AND release prep done.

- ✅ **Iter 1**: HK/MO/TW agents · enter worktree · codes.ts +71/81/82 · tracker + 3 special md
- ✅ **Iter 2**: 31 mainland md written · INDEX/tracker updated · TS schema designed · build green
- ✅ **Iter 3**: 6 scribe agents 并行 JSON 填充(17/18 文件)· 7 CLI verbs · 7 MCP tools · smoke test 15/15 passing · build green
- **Iter 4+**: art-2023 gap 评估 · README · 版本 bump · git commit/PR · 真实 N=1 用户测试
- **Done condition**: 真实家庭可用、文档完备、版本可发布
