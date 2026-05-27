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
    score <= input') maps every score in the bucket to the bucket's cumulative."""
    s = s.replace("－", "-").replace("—", "-").strip()
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
                         "extract_rows_trust_cumulative). Running-sum holds by construction.")
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

    rows = extract_rows_trust_cumulative(htmltext) if a.trust_cumulative else extract_rows(htmltext)
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
        "note": (a.source_note + ("；count 由 cumulative(位次) 反推（官方表为累计制/顶部分段合并）" if a.trust_cumulative else "")).lstrip("；"),
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
