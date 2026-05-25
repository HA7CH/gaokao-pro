# gaokao-pro

用 Claude Code 规划你的高考。

把下面这段 prompt 粘进 Claude Code / Codex / Cursor：

```
跑 `npx gaokao-pro@latest help` 把命令摸清楚，然后帮我规划 2026 年的高考志愿。

先问我：分数（估分 / 模考分 / 高考分都行，标清楚是哪种）、省份、选科组合、目标专业方向或职业兴趣、偏好（目标城市 / 是否限定 985/211 / 学费预算）。如果给的是估分或模考分，参考 2023-2025 历年一分一段做粗估位次；等高考真实分数出来再用 2026 当年一分一段精算。

每条推荐都用 CLI 拉真实数据支撑——查历年最低分、跨校搜专业、把分数换算成位次区间。
```

Or use the CLI yourself:

```bash
npx gaokao-pro@latest recommend \
  --score 660 --province henan --subjects 物理,化学,生物 \
  --985 --limit 5 --explain

npx gaokao-pro@latest rank --province beijing --year 2024 --score 650
# → 全省位次 3176 名以内
```

```
gaokao-pro recommend  score=660  河南(3+1+2)  subjects=物理/化学/生物  track=物理类  evaluated=44

[冲  REACH]  4 schools
  school              delta  min(2025)  city    tags  belong
  南京大学            -9     669        南京市  985   教育部
  北京航空航天大学    -10    670        北京市  985   工业和信息化部
  ...

[稳  MATCH]  4 schools
  ...

[保  SAFETY]  4 schools
  ...
```

No signup, no token, no backend. Talks straight to
`static-data.gaokao.cn` (the 中国教育在线 / 掌上高考 static JSON tier — no
auth, no sign, no rate limit observed). Ships with a built-in 2,400-school
local index (1 MB gzipped) so `recommend` and `top` run fully offline.

## Verbs

| Verb        | What it does                                                              |
|-------------|---------------------------------------------------------------------------|
| `recommend` | 冲 / 稳 / 保 buckets for your score in a province (offline)                |
| `top`       | Top-N best schools your score can reach (offline)                         |
| `find`      | Search majors across schools (e.g. all 985 schools that recruit 计算机)    |
| `school`    | School metadata: 985/211/双一流/学科评估/校友会排名                          |
| `plan`      | Forward-looking admission plan per (school, year, province)               |
| `actual`    | Backward-looking actual admissions: 最低分 / 平均分 / 最低位次              |
| `scores`    | Historical min-score time series for a (school, province) pair            |
| `rank`      | score ↔ 全省位次 via official 一分一段表 (beijing 2023-2025 ingested)        |
| `provinces` | List supported provinces with 新高考 reform regime                          |
| `mcp`       | Run as MCP server — `claude mcp add gaokao-pro -- npx -y gaokao-pro mcp`  |

Run `gaokao-pro help` for the full command reference.

## Flags

- `--province <name|id>` — accepts 中文 (河南), pinyin (henan), or GB id (41).
- `--subjects <list>` — comma-separated, e.g. `物理,化学,生物` for 3+1+2 or 3+3 provinces; subject set drives track inference (物理类/历史类/综合改革/文/理).
- `--985 / --211 / --dual-class` — label filters.
- `--belong <教育部|工信部|...>` — by 隶属.
- `--limit <n>` — cap results.
- `--explain` — show reasoning per recommendation (table mode).
- `--format table|json` — defaults to `table` on TTY, `json` when piped (great for `jq` / Claude Code).

## How it scores

Recommend uses a transparent score-delta heuristic — no opaque model. For each
school: `delta = userScore − historicalMin(latestMatchingYear, sameTrack)`,
bucketed as:

- `保` SAFETY:  `delta ≥ +15`
- `稳` MATCH:   `−5 ≤ delta < +15`
- `冲` REACH:   `−25 ≤ delta < −5`
- out of range: `delta < −25`

The deltas are surfaced in every result so you can override the cutoffs.

## Refreshing the index

The bundled `data/school-index.json.gz` was probed against
`static-data.gaokao.cn` on **2026-05-22** (2,422 schools, includes 2023-2025
historical min scores). To rebuild against the latest upstream:

```bash
pnpm install
pnpm probe                  # ≈ 60-90s at concurrency 25, writes cli/data/school-index.json.gz
```

## Status

Early — `v0.0.2`. Coming: rank-based recommendations (using `min_section`
from `schoolspecialscore`), MCP server, Claude Code plugin, hosted landing
at gaokao.ha7ch.com.

Part of [HA7CH](https://ha7ch.com) — sibling of `job-pro` and `cv-pro`.

## License

MIT.
