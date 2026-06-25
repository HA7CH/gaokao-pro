#!/usr/bin/env python3
"""Parse the official 安徽 2026 成绩分档表 PDF (which HAS a real text layer,
extracted via `pdftotext -layout`) into RankTable JSON, enforcing the SAME
running-sum integrity gate as ingest-html.py.

The Anhui PDF lays out each page as 5 side-by-side column-groups, each
[分数, 人数, 累计人数], read top-to-bottom then left-to-right (descending score).
Pages 1-3 = 历史科目组合 (history), pages 4-6 = 物理科目组合 (physics).

We parse every (score, count, cumulative) triple, drop the suppressed
'200及以下 ... 略' tail bucket and 'X及以上' is kept as floor score, sort by score
descending, then run the identical validate() invariant: sum(count)==cumulative
at every row. A mis-parse breaks the gate, so nothing can be fabricated.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent  # cli/data/yifenyiduan/


def validate(rows):
    """Identical invariant to ingest-html.py: running-sum + strict descent."""
    if len(rows) < 20:
        raise ValueError(f"only {len(rows)} data rows parsed — not a full 一分一段表")
    running = 0
    prev_score = None
    for i, r in enumerate(rows):
        if r["count"] < 0:
            raise ValueError(f"negative count at row {i} (score {r['score']})")
        running += r["count"]
        if running != r["cumulative"]:
            raise ValueError(
                f"running-sum mismatch at row {i} (score {r['score']}): "
                f"sum(count)={running} != cumulative={r['cumulative']}")
        if prev_score is not None and r["score"] >= prev_score:
            raise ValueError(f"scores not strictly descending at row {i}: {prev_score} -> {r['score']}")
        prev_score = r["score"]
    return len(rows), rows[0], rows[-1]


def parse_score(tok):
    """'671及以上' / '705及以上' -> floor int; plain '600' -> 600; else None."""
    nums = re.findall(r"\d+", tok)
    if not nums:
        return None
    return int(nums[0])


def extract_track(text, track_header_kw):
    """text is full `pdftotext -layout` output. track_header_kw is e.g.
    '历史科目组合' or '物理科目组合'. We only keep lines that belong to that track's
    pages (between its header and the next track's header / EOF), then pull every
    [score count cum] triple out of the 5-group rows."""
    lines = text.splitlines()
    # mark which lines fall under the target track header
    in_track = False
    rows = {}
    for ln in lines:
        if "科类：" in ln:
            in_track = track_header_kw in ln
            continue
        if not in_track:
            continue
        # data line: contains many integers; strip the all-integer tokens out.
        # First normalize: replace 'NNN及以上'/'NNN及以下' so the leading score parses.
        # Tokenize on whitespace.
        toks = ln.split()
        # We walk tokens, grouping into (score, count, cum) triples. A group starts
        # with a score token (either pure int in 195..760, or 'NNN及以上'). The next
        # two tokens must be pure ints (count, cum). '略' / 'NNN及以下' terminate.
        i = 0
        while i < len(toks):
            t = toks[i]
            if "及以下" in t:
                break  # suppressed tail bucket for this row — stop this line
            sc = None
            if "及以上" in t:
                sc = parse_score(t)
            elif re.fullmatch(r"\d{3}", t) or re.fullmatch(r"\d{2,3}", t):
                v = int(t)
                if 195 <= v <= 760:
                    sc = v
            if sc is None:
                i += 1
                continue
            # need next two pure-int tokens
            if i + 2 < len(toks) + 1 and i + 2 <= len(toks) - 1 + 1:
                pass
            if i + 2 <= len(toks) - 1:
                c_tok, u_tok = toks[i + 1], toks[i + 2]
                if re.fullmatch(r"\d+", c_tok) and re.fullmatch(r"\d+", u_tok):
                    count = int(c_tok)
                    cum = int(u_tok)
                    if sc not in rows:  # dedupe (page header score repeats avoided)
                        rows[sc] = (count, cum)
                    i += 3
                    continue
            i += 1
    # to list, sorted by score descending
    out = []
    for sc in sorted(rows.keys(), reverse=True):
        count, cum = rows[sc]
        out.append({"score": sc, "count": count, "cumulative": cum})
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--province", default="anhui")
    ap.add_argument("--name", default="安徽")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--track", required=True, help="physics|history")
    ap.add_argument("--track-cn", required=True)
    ap.add_argument("--track-header", required=True, help="物理科目组合|历史科目组合")
    ap.add_argument("--url", required=True)
    ap.add_argument("--check-score", type=int)
    ap.add_argument("--check-cum", type=int)
    ap.add_argument("--source-note", default="")
    ap.add_argument("--out")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    text = subprocess.run(
        ["pdftotext", "-layout", a.pdf, "-"],
        check=True, capture_output=True, text=True).stdout

    rows = extract_track(text, a.track_header)
    try:
        n, top, bottom = validate(rows)
    except ValueError as e:
        print(f"VALIDATE-FAIL {a.province}-{a.year}-{a.track}: {e}", file=sys.stderr)
        sys.exit(3)

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
        "source": "省考试院 / ahzsks.cn (成绩分档表 PDF 文本层)",
        "source_url": a.url,
        "note": a.source_note,
        "count": n,
        "rows": rows,
    }

    print(f"OK {a.province}-{a.year}-{a.track}: {n} rows, "
          f"top {top['score']}->{top['cumulative']}, bottom {bottom['score']}->{bottom['cumulative']}, "
          f"checkpoint {checkpoint_ok}")

    if a.write:
        path = Path(a.out) if a.out else DATA_DIR / f"{a.province}-{a.year}-{a.track}.json"
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(f"WROTE {path}")


if __name__ == "__main__":
    main()
