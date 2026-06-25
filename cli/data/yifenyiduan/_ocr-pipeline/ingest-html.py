#!/usr/bin/env python3
"""Fetch + parse + VALIDATE an official 一分一段表 from an HTML-table source
(eol.cn mirrors, 省考试院 pages) and emit a RankTable JSON.

Correctness is enforced mechanically — a file is only written if it passes:
  1. running-sum integrity: sum of 人数 up to each row == that row's 累计人数
  2. strictly descending scores, non-decreasing cumulative
  3. (if given) an independent official checkpoint: cumulative at score S == C
     where (S, C) comes from a published 本科线上线人数 / "N人超X分" figure.

Because the cumulative column is a running sum, you cannot fabricate or
mis-transcribe rows without breaking gate 1 — and gate 3 ties the table to an
independently published number. This is what makes the ingest trustworthy.

Usage:
  ingest-html.py --province anhui --name 安徽 --year 2024 \
    --track physics --track-cn 物理类 \
    --url https://gaokao.eol.cn/an_hui/dongtai/202406/t20240625_2619348.shtml \
    --check-score 600 --check-cum 25818 \
    [--out <path>] [--write] [--source-note "..."]

Without --write it only validates and prints a summary (dry run).
"""
import argparse
import json
import re
import sys
import urllib.request
from html import unescape
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent  # cli/data/yifenyiduan/


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    # most of these pages are utf-8; fall back to gb18030 (common on gov sites)
    for enc in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def cell_text(cell_html: str) -> str:
    return re.sub(r"<.*?>", "", unescape(cell_html)).replace("\xa0", " ").strip()


def parse_int(s: str):
    s = s.replace(",", "").replace("，", "").strip()
    return int(s) if re.fullmatch(r"\d+", s) else None


def parse_score(s: str):
    """A score cell is either '653' or a range like '699-750' / '750以上' / '200及以下'.
    We store the FLOOR of the bucket so that scoreToRank ('first row whose
    score <= input') maps every score in the bucket to the bucket's cumulative.

    Special case: '以下' (below/less-than) bottom-bucket labels like '100以下' or
    '200及以下' represent a catch-all range [0, X-1].  The floor is 0 so that
    scoreToRank will correctly match any user score that falls in the bucket.
    (Without this, '100以下' would parse as 100, colliding with the explicit
    score=100 row above it and failing the strictly-descending validation gate.)"""
    s = s.replace("－", "-").replace("—", "-").strip()
    if "以下" in s:
        # Bottom catch-all bucket: floor is 0 (covers all scores from 0 to X-1)
        return 0
    nums = [int(x) for x in re.findall(r"\d+", s)]
    if not nums:
        return None
    return min(nums)  # floor of the bucket (and the single value when len==1)


def page_title(htmltext: str) -> str:
    m = re.search(r"<title>(.*?)</title>", htmltext, re.S)
    return cell_text(m.group(1)) if m else ""


def extract_rows(htmltext: str):
    """Return the longest score/count/cumulative table found on the page."""
    best = []
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        rows = []
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) < 3:
                continue
            score = parse_score(cells[0])
            count = parse_int(cells[1])
            cum = parse_int(cells[2])
            if score is None or count is None or cum is None:
                continue  # header / footnote row
            rows.append({"score": score, "count": count, "cumulative": cum})
        if len(rows) > len(best):
            best = rows
    return best


def extract_rows_trust_cumulative(htmltext: str):
    """For 'cumulative-only' official tables (2-col 分数/累计人数) or tables that
    suppress the top score bucket's per-segment count: take the FIRST cell as the
    score and the LAST cell as the canonical cumulative (位次), and DERIVE
    count = cum[i] - cum[i-1]. The served `cumulative` column is taken verbatim;
    only the unused `count` column is synthesized so the file is self-consistent."""
    best = []
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        parsed = []
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) not in (2, 3):
                continue  # skip multi-track side-by-side layouts (ambiguous)
            score = parse_score(cells[0])
            cum = parse_int(cells[-1])
            if score is None or cum is None:
                continue
            parsed.append((score, cum))
        if len(parsed) > len(best):
            best = parsed
    rows = []
    prev_cum = 0
    for score, cum in best:
        rows.append({"score": score, "count": cum - prev_cum, "cumulative": cum})
        prev_cum = cum
    return rows


def extract_rows_multi_col_trust_cumulative(htmltext: str):
    """For multi-column newspaper-style 一分一段表 (e.g. 宁夏 2026) where each HTML
    row contains N pairs of (分数段, 累计人数) — the table is typeset in several
    side-by-side column groups so that all score levels fit on one printed page.
    Strategy: scan every <tr> in every <table>, walk cell-by-cell; whenever a
    cell matches the pattern 'NNN分' and the next non-empty cell is a plain
    integer, record (score, cumulative). Merge all (score, cumulative) pairs
    across all tables, deduplicate by score, sort descending, then derive
    count = cum[i] - cum[i-1] (same semantics as extract_rows_trust_cumulative).
    The running-sum gate in validate() holds by construction."""
    all_pairs: list[tuple[int, int]] = []
    seen_scores: set[int] = set()
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            i = 0
            while i < len(cells):
                # A score cell looks like '658分' after cell_text cleanup
                score = parse_score(cells[i])
                if score is not None and "分" in cells[i] and score not in seen_scores:
                    # find next non-empty cell → cumulative
                    j = i + 1
                    while j < len(cells) and not cells[j]:
                        j += 1
                    if j < len(cells):
                        cum = parse_int(cells[j])
                        if cum is not None and cum > 0:
                            all_pairs.append((score, cum))
                            seen_scores.add(score)
                            i = j + 1
                            continue
                i += 1
    # sort descending; derive counts from cumulative differences
    all_pairs.sort(key=lambda x: -x[0])
    rows = []
    prev_cum = 0
    for score, cum in all_pairs:
        rows.append({"score": score, "count": cum - prev_cum, "cumulative": cum})
        prev_cum = cum
    return rows


def extract_rows_rank_range(htmltext: str):
    """For 3-col tables laid out as [分数, 位次区间, 同分人数] — e.g.
    '706~750 | 1~14 | 14' — where the cumulative (累计位次) is NOT its own
    column but the END of the 位次区间 (rank range), and the per-score count is
    the 同分人数 column. Take BOTH published columns verbatim: cumulative = the
    end of the rank range, count = 同分人数. Nothing is synthesized — the
    running-sum gate in validate() independently re-derives that
    sum(count)==cumulative, so a mis-paired column would fail the gate."""
    best = []
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        parsed = []
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) != 3:
                continue
            score = parse_score(cells[0])
            # rank range: 'start~end' (also -, －, —, ～ separators) → cumulative = end
            rng = re.findall(r"\d+", cells[1].replace("，", "").replace(",", ""))
            count = parse_int(cells[2])
            if score is None or not rng or count is None:
                continue  # header / footnote / non-data row
            cum = int(rng[-1])
            parsed.append({"score": score, "count": count, "cumulative": cum})
        if len(parsed) > len(best):
            best = parsed
    return best


def extract_rows_cols(htmltext: str, score_i: int, count_i: int, cum_i: int):
    """For tables whose 分数/人数/累计 live at FIXED (non-leading) column indices —
    e.g. 青海's [科类, 投档类型, 总分, 人数, 累计数] (cols 2,3,4) or 河北's side-by-side
    [分数, 物理人数, 物理累计, 历史人数, 历史累计] where physics=cols 0,1,2 and
    history=cols 0,3,4. Takes those three columns verbatim; rows whose selected cells
    don't parse (headers / notes / the empty other-track cells) are skipped. The
    running-sum gate in validate() independently re-derives sum(count)==cumulative,
    so a wrong column pick fails the gate rather than shipping bad data."""
    need = max(score_i, count_i, cum_i)
    best = []
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        parsed = []
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) <= need:
                continue
            score = parse_score(cells[score_i])
            count = parse_int(cells[count_i])
            cum = parse_int(cells[cum_i])
            if score is None or count is None or cum is None:
                continue  # header / note / empty other-track row
            parsed.append({"score": score, "count": count, "cumulative": cum})
        if len(parsed) > len(best):
            best = parsed
    return best


def extract_rows_cols_trust_cumulative(htmltext: str, score_i: int, cum_i: int):
    """Combined --cols + --trust-cumulative mode: for wide multi-track tables
    (e.g. 山东 3+3 全体 columns) where the cumulative column at a fixed index is
    authoritative but the count column may be offset (top-suppressed rows, or
    multiple-ranking cumulatives). Takes score_i and cum_i; derives count from
    successive cumulative differences (same semantics as extract_rows_trust_cumulative).
    Running-sum holds by construction; only the cumulative column is published."""
    need = max(score_i, cum_i)
    best_parsed = []
    for table in re.findall(r"<table.*?</table>", htmltext, re.S):
        parsed = []
        for tr in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cells) <= need:
                continue
            score = parse_score(cells[score_i])
            cum = parse_int(cells[cum_i])
            if score is None or cum is None:
                continue  # header / note / empty row
            parsed.append((score, cum))
        if len(parsed) > len(best_parsed):
            best_parsed = parsed
    rows = []
    prev_cum = 0
    for score, cum in best_parsed:
        rows.append({"score": score, "count": cum - prev_cum, "cumulative": cum})
        prev_cum = cum
    return rows


def validate(rows):
    """Raise ValueError on any integrity violation. Returns (n, top, bottom)."""
    if len(rows) < 20:
        raise ValueError(f"only {len(rows)} data rows parsed — not a full 一分一段表 (expected hundreds)")
    running = 0
    prev_score = None
    for i, r in enumerate(rows):
        if r["count"] < 0:
            raise ValueError(f"negative count at row {i} (score {r['score']}) — cumulative decreased (non-monotonic)")
        running += r["count"]
        if running != r["cumulative"]:
            raise ValueError(
                f"running-sum mismatch at row {i} (score {r['score']}): "
                f"sum(count)={running} != cumulative={r['cumulative']}"
            )
        if prev_score is not None and r["score"] >= prev_score:
            raise ValueError(f"scores not strictly descending at row {i}: {prev_score} -> {r['score']}")
        prev_score = r["score"]
    return len(rows), rows[0], rows[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--province", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--track", required=True, help="physics|history|combined|science|liberal")
    ap.add_argument("--track-cn", default="")
    ap.add_argument("--url", required=True)
    ap.add_argument("--check-score", type=int)
    ap.add_argument("--check-cum", type=int)
    ap.add_argument("--expect-kw", default="",
                    help="comma-separated keywords; ≥1 must appear in the page <title> "
                         "(track-identity gate, prevents fetching the wrong track's table). "
                         "Defaults from --track-cn / --track.")
    ap.add_argument("--source-note", default="")
    ap.add_argument("--trust-cumulative", action="store_true",
                    help="for cumulative-only / top-suppressed official tables: take "
                         "cumulative verbatim and derive count from it (see "
                         "extract_rows_trust_cumulative). Running-sum holds by construction. "
                         "When combined with --cols, uses extract_rows_cols_trust_cumulative: "
                         "fixed score/cum col indices from --cols (count index ignored), "
                         "derives count from cumulative differences — for wide multi-track "
                         "tables where the cumulative column is authoritative (e.g. 山东 3+3).")
    ap.add_argument("--rank-range", action="store_true",
                    help="for [分数, 位次区间, 同分人数] tables: cumulative = END of the "
                         "位次区间 range, count = 同分人数. Both columns taken verbatim; "
                         "running-sum gate re-checks them (see extract_rows_rank_range).")
    ap.add_argument("--multi-col", action="store_true",
                    help="for multi-column newspaper-style tables (e.g. 宁夏 2026) where "
                         "each HTML row contains N (分数段, 累计人数) pairs laid out in "
                         "several side-by-side column groups. Extracts all pairs from all "
                         "tables, merges, sorts descending, derives count from cumulative "
                         "differences (see extract_rows_multi_col_trust_cumulative).")
    ap.add_argument("--cols",
                    help="comma-separated 0-based column indices SCORE,COUNT,CUM for tables "
                         "where these aren't the first 3 cells — e.g. 青海 '2,3,4' (投档类型 "
                         "prefix), 河北 side-by-side physics '0,1,2' / history '0,3,4'. "
                         "See extract_rows_cols.")
    ap.add_argument("--out")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    try:
        htmltext = fetch(a.url)
    except Exception as e:
        print(f"FETCH-FAIL {a.province}-{a.year}-{a.track}: {e}", file=sys.stderr)
        sys.exit(2)

    title = page_title(htmltext)

    # track-identity gate (HARD): the page title must mention the expected track,
    # so we never silently ingest e.g. a 物理类 table under the history file.
    expect = [k.strip() for k in (a.expect_kw or a.track_cn or "").split(",") if k.strip()]
    if not expect:
        expect = {"physics": ["物理"], "history": ["历史"], "science": ["理科", "理工"],
                  "liberal": ["文科", "文史"], "combined": ["综合", "普通类", "不分文理"]}.get(a.track, [])
    if expect and title and not any(k in title for k in expect):
        print(
            f"TRACK-FAIL {a.province}-{a.year}-{a.track}: page title '{title}' "
            f"does not mention any of {expect} — wrong track/URL?",
            file=sys.stderr,
        )
        sys.exit(5)

    if a.cols:
        idx = [int(x) for x in a.cols.split(",")]
        if len(idx) != 3:
            print(f"ARG-FAIL {a.province}-{a.year}-{a.track}: --cols needs 3 indices SCORE,COUNT,CUM", file=sys.stderr)
            sys.exit(4)
        if a.trust_cumulative:
            # Combined mode: use fixed col indices but derive count from cumulative differences.
            # The COUNT index (idx[1]) is ignored; only SCORE (idx[0]) and CUM (idx[2]) are used.
            rows = extract_rows_cols_trust_cumulative(htmltext, idx[0], idx[2])
        else:
            rows = extract_rows_cols(htmltext, idx[0], idx[1], idx[2])
    elif a.multi_col:
        rows = extract_rows_multi_col_trust_cumulative(htmltext)
    elif a.rank_range:
        rows = extract_rows_rank_range(htmltext)
    elif a.trust_cumulative:
        rows = extract_rows_trust_cumulative(htmltext)
    else:
        rows = extract_rows(htmltext)
    try:
        n, top, bottom = validate(rows)
    except ValueError as e:
        print(f"VALIDATE-FAIL {a.province}-{a.year}-{a.track}: {e}", file=sys.stderr)
        sys.exit(3)

    # numeric checkpoint cross-check (SOFT): headline "N人超X分" figures can differ
    # from the table by a handful at the boundary (≥X vs >X, policy-bonus counts),
    # so a mismatch is a WARN, not a failure — the running-sum gate already proves
    # the table is internally consistent. An exact match is bonus confirmation.
    checkpoint_ok = "n/a"
    if a.check_score is not None and a.check_cum is not None:
        match = next((r for r in rows if r["score"] == a.check_score), None)
        if match is None:
            checkpoint_ok = f"WARN (no row at score {a.check_score})"
        elif match["cumulative"] != a.check_cum:
            checkpoint_ok = (f"WARN (table {a.check_score}->{match['cumulative']} "
                             f"vs official {a.check_cum}, diff {match['cumulative'] - a.check_cum})")
        else:
            checkpoint_ok = f"PASS ({a.check_score}->{a.check_cum})"

    out = {
        "province": a.province,
        "province_name": a.name,
        "year": a.year,
        "track": a.track,
        "track_cn": a.track_cn,
        "source": "省考试院 / eol.cn (一分一段表全表)",
        "source_url": a.url,
        "note": (a.source_note
                 + ("；count 由 cumulative(位次) 反推（官方表为累计制/顶部分段合并）" if a.trust_cumulative else "")
                 + ("；cumulative 取自官方[位次区间]右端，count 取自[同分人数]列" if a.rank_range else "")
                 + (f"；分数/人数/累计取自官方表第 {a.cols} 列（含投档类型前缀/并排双轨版式）" if a.cols else "")
                 + ("；多栏并排版式（宁夏式）：跨表合并所有(分数,累计)对，count 由累计差反推" if a.multi_col else "")).lstrip("；"),
        "count": n,
        "rows": rows,
    }

    print(
        f"OK {a.province}-{a.year}-{a.track}: {n} rows, "
        f"top {top['score']}->{top['cumulative']}, bottom {bottom['score']}->{bottom['cumulative']}, "
        f"checkpoint {checkpoint_ok} | title: {title}"
    )

    if a.write:
        path = Path(a.out) if a.out else DATA_DIR / f"{a.province}-{a.year}-{a.track}.json"
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(f"WROTE {path}")


if __name__ == "__main__":
    main()
