# static-data.gaokao.cn — schema notes

Probed 2026-05-22 against `school_id=31` (北京大学), `year=2024`, `province=41` (河南).

## Envelope

All responses share:

```json
{
  "code": "0000",
  "message": "成功",
  "data": { ... },
  "md5": "...",
  "time": "2026-05-22 15:24:23"
}
```

`code === "0000"` is the success sentinel. We unwrap `data` in the client.

## Endpoints

### `GET /school/{schoolId}/info.json`

School metadata. **The single most useful endpoint** — one call gets
basics + 学科评估 + historical min scores across all provinces.

Identifier reality check:
- `school_id` is gaokao.cn's internal id (small int, ~ 1..3000)
- `zs_code` is 教育部's 5-digit standard code (e.g. "10001" 北大, "10003" 清华)
- These do not have a simple offset relationship. Probe to build a map.

Gold field: `pro_type_min`. Schema:
```jsonc
"pro_type_min": {
  "41": [                                 // province_id (41 = 河南)
    { "year": 2025, "type": { "2073": "691", "2074": "671" } },  // 物理类/历史类
    { "year": 2024, "type": { "1": "696", "2": "652" } },         // 理工/文史 (老高考)
    { "year": 2023, "type": { "1": "696", "2": "672" } }
  ],
  // ... one entry per province
}
```

Note 河南 transitioned from 老高考 (`type` ∈ {1 理, 2 文}) to 新高考 3+1+2
(`type` ∈ {2073 物理类, 2074 历史类}) in 2025. The same province key
mixes both schemes across years — the client should expose `track` as a
typed enum.

Other notable fields:
- `f985`, `f211`, `is_dual_class`: "1" = yes, "2" = no
- `xueke_rank`: `{ "A+": "21", "A": "11", ... }` — counts from 第四轮学科评估
- `rank.ruanke_rank`, `rank.qs_world`, `rank.us_rank`
- `school_type_name` (本科/专科), `type_name` (综合/理工/师范/...)
- `nature_name` (公办/民办/中外合作办学)
- `belong` (教育部 / 工信部 / 省属 / ...)
- `content` (long intro, ~1-2KB)
- `dualclass[]`, `subject_arr[]`, `master_arr[]`, `doctor_arr[]`

### `GET /schoolspecialplan/{schoolId}/{year}/{provinceId}.json`

Per-school × per-year × per-province admission plan.

Outer schema is buckets keyed by `<level1>_<batch>_<other>`:

```jsonc
{
  "2_7_0": {           // level1=2 (文史), batch=7 (本一)
    "numFound": 16,
    "item": [ AdmissionPlanItem, ... ]
  },
  "1_7_0": { ... }     // level1=1 (理工) bucket
}
```

The client flattens all buckets into a single array.

Per-item fields we care about:
- `spcode`: 6-digit 国标 专业代码 (e.g. `080901` 计算机科学与技术,
  `030101K` 法学). Trailing letter exists for special categories
  (K=National security strategic, W=cybersecurity, T=experimental).
- `sp_name` / `spname`: short / full 专业名 (full may include 备注 in parens)
- `num`: 计划人数 (integer)
- `length`: 学制 (e.g. "四年", "五年")
- `tuition`: 学费 (Yuan/year, as string)
- `batch` + `local_batch_name`: 批次 (e.g. "本科一批", "本科批", "提前批")
- `zslx` + `zslx_name`: 招生类型 (普通类 / 中外合作办学 / 国家专项 / 高校专项 / 地方专项 / 民族班 / 预科班 / ...)
- `type`: track code (see `codes.ts` TRACK_NAMES)
- `level2_name`: 学科门类 (e.g. 工学, 文学, 法学)
- `level3_name`: 专业类 (e.g. 计算机类, 临床医学类)
- `info` + `remark`: 备注 (often the 大类招生 sub-direction list)

Selected-subject fields (新高考 provinces):
- `sp_fxk`: 首选科目 (物理/历史) for individual-major mode
- `sp_sxk`: 再选科目 requirement (e.g. "化学;生物 任选1")
- `sp_xuanke`: full raw requirement string
- `sp_info`: notes
- `sg_*` variants: same fields at 院校专业组 level (when `special_group !== "0"`)

For 老高考 provinces (河南 2024 and earlier, 山西, etc.) these are blank
and `special_group === "0"`.

## Province codes (verified)

```
11 北京  12 天津  13 河北  14 山西  15 内蒙古
21 辽宁  22 吉林  23 黑龙江
31 上海  32 江苏  33 浙江  34 安徽  35 福建  36 江西  37 山东
41 河南  42 湖北  43 湖南  44 广东  45 广西  46 海南
50 重庆  51 四川  52 贵州  53 云南  54 西藏
61 陕西  62 甘肃  63 青海  64 宁夏  65 新疆
```

These match GB/T 2260 administrative-division prefixes — easy to map.

## Track codes (verified across info.json and plan endpoints)

| code | name | regime |
|---|---|---|
| 1 | 理工 | 老高考 (文理分科) |
| 2 | 文史 | 老高考 |
| 3 | 综合改革 | 新高考 3+3 (上海/北京/天津/山东/海南/浙江) |
| 2073 | 物理类 | 新高考 3+1+2 (首选物理) |
| 2074 | 历史类 | 新高考 3+1+2 (首选历史) |

## Known gotchas

1. **`school_id` ≠ `zs_code`**: must probe to map. `school_id` is small dense
   ints (~1..2900); `zs_code` is sparse 5-digit codes.
2. **Same `spcode` in different schools may have different sub-directions** in `info`.
3. **大类招生**: items like "工科试验班类" share one `spcode` and bundle
   multiple downstream majors that are decided after enrollment. Historical
   data is on the bucket, not the eventual major.
4. **院校专业组 mode**: 新高考 provinces report scores at the group level,
   not individual major. `special_group` field carries the group id.
5. **Year transitions**: provinces switching from 老高考 to 新高考 will
   have mixed `type` codes across years. Don't assume a province has one
   set of tracks forever.
