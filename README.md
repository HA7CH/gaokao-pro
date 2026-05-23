# gaokao-pro

Plan your gaokao with your Claude Code.
[gaokao.ha7ch.com](https://gaokao.ha7ch.com)

Drop this prompt into Claude Code, Codex, or Cursor:

```
Run `npx gaokao-pro@latest help` to discover the CLI, then help me plan
my (or my child's) college applications for the 2026 高考.

Ask me for my score, 全省位次 if I know it, province, 选科 combination,
intended majors or career interests, and any preferences (target cities,
985/211 priority, budget). Use the CLI to ground every recommendation
in real admissions data — pull historical scores, search for matching
majors across schools, and translate score → 位次 when 一分一段 data
exists for my province. Always reply to me in Chinese.
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/HA7CH/gaokao-pro/main/install.sh | bash
```

npm release coming — `npx gaokao-pro@latest` will Just Work once we
finish wiring 2FA-bypass tokens on the publish account.

## How it works

`gaokao-pro` is a CLI + MCP server that grounds an AI conversation in
official Chinese college-admissions data. Claude drives the flow; the
CLI is the data spine.

Tools Claude can call (via Bash or MCP):

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
| `provinces` | List 31 provinces with their 新高考 reform mode                            |
| `mcp`       | Run as MCP server — `claude mcp add gaokao-pro -- npx -y gaokao-pro mcp`  |

Data sources:
- **`static-data.gaokao.cn`** (中国教育在线 / 掌上高考 static JSON tier) —
  no auth, no sign, no rate limit. Powers `school` / `plan` / `actual` /
  `scores` / `find` / the offline index for `recommend` / `top`.
- **`cli/data/yifenyiduan/`** — extracted 一分一段表 JSON, per province per
  year per track. Beijing 2023-2025 ingested. Roadmap: 31 provinces.

## Repo

```
gaokao-pro/
├── cli/                            # npm package
│   ├── src/
│   │   ├── index.ts                # CLI router + help
│   │   ├── gaokao-cn.ts            # static-data.gaokao.cn client
│   │   ├── recommend.ts            # 冲/稳/保 algorithm (offline)
│   │   ├── top.ts / find.ts        # top-N + cross-school search
│   │   ├── rank-table.ts           # 一分一段 loader (score ↔ rank)
│   │   ├── mcp.ts                  # stdio MCP server
│   │   ├── format.ts               # TTY table rendering
│   │   ├── index-loader.ts         # gunzip + cache the school index
│   │   ├── probe.ts                # rebuild the school index
│   │   ├── codes.ts                # 31 province codes + 新高考 reform map
│   │   └── provinces/              # province-bureau fallback adapters
│   ├── data/
│   │   ├── school-index.json.gz    # 2,422-school corpus (1 MB gzipped)
│   │   └── yifenyiduan/            # 一分一段 (beijing 2023/24/25 today)
│   └── test/smoke.ts               # live API smoke (10 checks)
├── src/                            # gaokao.ha7ch.com landing page
└── docs/                           # data-sources scan + schema notes
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
