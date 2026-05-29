# Changelog

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
