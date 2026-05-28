# Changelog

## v0.2.0 — 2026-05-29 · 特殊招生(34 region × 3 year × 6 category)

为艺术 / 体育 / 强基 / 综评 / 港澳台 / 民族班家庭加的完整支持。

### Added

- **34 regions** indexed (31 mainland + 71 台湾 / 81 香港 / 82 澳门 per GB/T 2260). `provinces` verb now lists all 34.
- **18 special-admissions JSON datasets** (6 categories × 3 years) totaling **1,497 records**:
  - `art-formula-{2023,2024,2025}.json` — 6 大类公式 + 合格线 + 文化控制线
  - `sports-formula-{2023,2024,2025}.json` — 5 种 `SportsFormulaKind`(weighted / additive / professional_first / gaokao_only / merged_specline)
  - `qiangji-quota-{2023,2024,2025}.json` — 39 校 × 31 省 × 3 年 入围线 + 报名即入围 12 校
  - `zongping-{2023,2024,2025}.json` — 综评校(浙江三位一体 / 江苏 23 校 A·B 类 / 沪鲁粤 11 校 / 京闽 7 校)
  - `minzu-policy-{2023,2024,2025}.json` — 加分梯度 + 民族班/预科 + 退坡时间表
  - `qatw-channel-{2023,2024,2025}.json` — 港澳台双向 8 通道
- **7 new CLI verbs**: `art-tongkao` / `sports-tongzhao` / `qiangji-line` / `zonghe` / `minzu` / `qatw` / `special-coverage`
- **7 new MCP tools** (Claude 可直接调用)
- **34 source markdowns** at `docs/special-admissions-3year/{pinyin}.md`(每份 4000-8000 字,统一 10 段 schema)
- **Strict schema validator** at `cli/test/special-admissions.validate.ts`(`pnpm test:validate`)
- **Family quickstart** at `docs/family-quickstart.md`
- **Coverage tracker** at `docs/coverage-tracker-special-admissions.md`
- **Landing page** update: v0.2.0 special-admissions section + 新疆 reform info 修正(2024 启动,**2027 首届**)

### Province-specific quirks captured

- 艺术:河南 5 选 1、云南 2025 取消省线、湖北 ×2 还原、辽宁百分制再加权
- 体育:湘青直接相加、陕甘按专业课、海南按高考总分、重庆 25 本专合一、湖北 1.25 系数
- 强基:复交南"报名即入围"12 校、甘青宁新 75% 文化门槛
- 综评:浙江三位一体含学考维度、江苏 23 校 A/B 类公式分散、上海 6.3w 考生 25 入围暴涨
- 民族:甘肃两州五县 +20、新疆单列类 +15、西藏双联户 +10 + 进藏干部 +1/年
- 港澳台:2024 联招报名 +42.58% → 2025 分数线暴涨 +65/+70

### Fixed

- `cli/src/mcp.ts`: SERVER_INFO version 0.0.2 → 0.2.0 (was stale)
- sports-formula 8 data bugs from scribe agents (山西 23/24 缺 formula、云南 应为 additive、西藏 应为 professional_first)
- 49 stub records backfilled for 31/31 mainland coverage in all 5 categories × 3 years (had been missing for early-year sparse coverage)

### Schema

New TS types at `cli/src/types/special-admissions.ts`:
- `RegionId = ProvinceId | 71 | 81 | 82`
- `ArtFormulaRecord` / `SportsFormulaRecord` / `QiangjiQuotaRecord` / `ZongPingRecord` / `MinzuPolicyRecord` / `QATWChannelRecord`
- `SpecialAdmissionsDataset` envelope with `schema_version: "1.0.0"`

### Coverage matrix (actual)

```
                 23 records / regions     24 records / regions    25 records / regions
art-formula      109 / 28                 260 / 31 (含 qatw stub)   292 / 31 (含 qatw stub)
sports-formula    34 / 31 (含 qatw stub)   34 / 31                  34 / 31
qiangji-quota     44 / 31 (含 qatw stub)   67 / 31                 155 / 31 (含 qatw stub)
zongping          99 / 31 (含 qatw stub)  111 / 31                 117 / 31
minzu-policy      34 / 31 (31 mainland + 3 qatw stub × 3 年)
qatw-channel      11 / 3                   11 / 3                   11 / 3

31 mainland regions × 5 mainland categories × 3 years = 465 cells, 全部 ≥1 record(含 confidence:low stub)
3 special regions × 3 years (qatw) = 9 cells
3 special regions × 5 mainland categories × 3 years = 45 cross-verb guidance stub
Total: 1,497 records / 18 JSON files
```

Stub records (`confidence: low`) marked with notes pointing to source markdown when data is sparse(early-year coverage or 旧高考时期口径与 6 大类不可比),or "请用 qatw" cross-verb guidance for 港澳台 in mainland categories.

### Verification

- ✅ TS build green
- ✅ Strict schema validator: 18/18 files ALL VALID
- ✅ Special-admissions smoke: 15/15 passing
- ✅ Original smoke (live API): 16/16 passing — no regression
- ✅ MCP stdio: 27 tools registered, tools/call returns real data
- ✅ npm pack --dry-run: 1.0 MB, 101 files

### Migration

No breaking changes. All existing v0.1.x commands continue to work. New commands are additive.

---

## v0.1.5 — earlier · 31 province baseline

Initial release with普通类 verbs(`recommend` / `top` / `find` / `school` / `plan` / `actual` / `scores` / `rank` / `provinces` / `mcp`) and 一分一段 data for 北京 2023-2025 + 山东/广东/四川 物理类.
