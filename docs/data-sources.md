# Data sources

50-agent feasibility scan summary. Verdicts: 🟢 anonymous + structured · 🟡 scrape-able · 🔴 hard · ⚫ blocked.

## Primary

| Source | Verdict | Notes |
|---|---|---|
| **static-data.gaokao.cn** (掌上高考 / 中国教育在线 static JSON) | 🟢 | No auth, no sign, no rate limit. 2700+ schools × 2015-2025 × 31 provinces. **Main data source.** Endpoints: `/school/{id}/info.json`, `/schoolspecialplan/{id}/{year}/{provinceId}.json`. |

## Province bureaus — for 一分一段表 + 投档线 fallback

| Province | Verdict | Site |
|---|---|---|
| 广东 | 🟢 | eea.gd.gov.cn — ZIP downloads, 物理/历史 split |
| 北京 | 🟢 | bjeea.cn — OSS reference at ZE3kr/bjeea-bulk-query |
| 河北 | 🟢 | hebeea.edu.cn — Excel downloads |
| 江苏 | 🟢 | jseea.cn — PDF, clean format |
| 广西 | 🟢 | gxeea.cn — fully public |
| 黑龙江 | 🟢 | lzk.hl.cn — no auth |
| 西藏 | 🟢 | zsks.edu.xizang.gov.cn |
| 山东 | 🟡 | sdzk.cn + xkkm.sdzk.cn (选科要求 system) |
| 浙江 | 🟡 | zjzs.net — 段线 public, 招生计划 login |
| 上海 | 🟡 | shmeea.edu.cn — top scores withheld for privacy |
| 河南 | 🟡 | heao.com.cn — 招生计划 login (datacenter returns 412) |
| 22 other provinces | 🟡 | Public 一分一段/投档线, login for plans. HTML/PDF scrape. |
| 湖南 | 🔴 | hneao.edu.cn unstable infra |

## National

| Source | Verdict | Notes |
|---|---|---|
| 教育部 moe.gov.cn | 🟡 | 高校名单 + 本科专业目录 PDF (annual) |
| 阳光高考 gaokao.chsi.com.cn | 🟡 | 院校库 HTML; 412 anti-bot in places |
| 学信网 chsi.com.cn | 🟡 | No API; 第五轮学科评估 not public |

## Aggregator competitors

| Source | Verdict | Notes |
|---|---|---|
| 优志愿 youzy.cn | 🔴 | MD5+JWT signing, hostile TOS. Skip. |
| 蝶变 / 完美志愿 / 圆梦志愿 | 🔴 | Closed App APIs. Skip. |

## AI competitors

| Product | Mode | Price | Weakness |
|---|---|---|---|
| 夸克高考 | 通义千问 + Agent | Free | App-only, black-box, slow (5-10 min report) |
| 百度AI高考 | DeepSeek + 搜索 | Free | App-only, reported low recommendation quality |
| 网易高考智愿 | Rules + DB | Free | Thin content |
| 优志愿 | Probability model | ¥360-980 + 一对一 | Paywall, two confusing modes |
| 掌上高考 | EOL algorithm | ¥98 + ¥2980 1-on-1 | Black-box, App-only |

**Our angle**: local CLI + MCP + Claude Code integration + open source + auditable recommendation logic. Target: tech-literate parents + B2B (schools, education NGOs).

## Compliance

🟡 Medium risk. 2024 MOE actively investigating commercial 志愿填报 services
(张雪峰 incident). PIPL applies to score+rank+province as quasi-educational
records. Defenses: data minimization, open source, no automated
"recommendation judgment" (show raw data + score-to-rank lookup, let user
decide), proactive disclosure to provincial 考试院.
