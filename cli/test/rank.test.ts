// Locks in the correctness of the score↔位次 (rank) conversion in rank-table.ts.
// OFFLINE only — reads local JSON tables under cli/data/yifenyiduan/.
// Anchor table: beijing 2024 combined (province id 11), which the smoke test
// also relies on (`650 → rank ~3176`). Run via `npx tsx test/run.ts` from cli/.
import { test, assert, assertEqual } from "./_harness.js";
import {
  listRankTables,
  loadRankTable,
  scoreToRank,
  rankToScore,
  type RankTable,
} from "../src/rank-table.js";

const BEIJING = 11; // province id (see codes.ts)
const YEAR = 2024;
const TRACK = "combined";

function load(): RankTable {
  const t = loadRankTable(BEIJING, YEAR, TRACK);
  assert(t !== null, "beijing 2024 combined table must be present locally");
  return t as RankTable;
}

// ── presence / shape ──────────────────────────────────────────────────────
test("listRankTables includes beijing 2024", () => {
  const tables = listRankTables();
  const has = tables.some((t) => t.province === "beijing" && t.year === 2024);
  assert(has, "beijing 2024 should appear in listRankTables()");
});

test("beijing 2024 loads with rows", () => {
  const t = load();
  assert(t.rows.length > 0, "table should have rows");
  assert(t.rows.length >= 50, `expected many rows, got ${t.rows.length}`);
  assertEqual(t.province, "beijing", "province id");
  assertEqual(t.year, 2024, "year");
});

// ── known anchor ──────────────────────────────────────────────────────────
test("anchor: score 650 → rank ≈ 3176", () => {
  const t = load();
  const rank = scoreToRank(t, 650);
  assert(rank !== null, "650 should resolve to a rank");
  // Smoke uses [2000,5000]; tighten to a small tolerance around the known 3176.
  assert(
    Math.abs((rank as number) - 3176) <= 50,
    `expected rank ≈ 3176 for score 650, got ${rank}`
  );
});

// ── monotonicity ──────────────────────────────────────────────────────────
test("rows sorted score-descending", () => {
  const t = load();
  for (let i = 1; i < t.rows.length; i++) {
    assert(
      t.rows[i].score < t.rows[i - 1].score,
      `scores must be strictly descending at row ${i}: ${t.rows[i - 1].score} then ${t.rows[i].score}`
    );
  }
});

test("cumulative is non-decreasing as score drops", () => {
  // rows are score-descending; lower score = more people at-or-above, so the
  // cumulative count must never decrease as we walk the rows.
  const t = load();
  let prev = -Infinity;
  for (let i = 0; i < t.rows.length; i++) {
    const cum = t.rows[i].cumulative;
    assert(
      cum >= prev,
      `cumulative must be non-decreasing; row ${i} (score ${t.rows[i].score}) = ${cum} < prev ${prev}`
    );
    prev = cum;
  }
});

test("scoreToRank is non-increasing as score increases (higher score = better rank)", () => {
  const t = load();
  let prev: number | null = null;
  // walk scores from low (min) up to high (max); rank should never increase.
  const min = t.rows[t.rows.length - 1].score;
  const max = t.rows[0].score;
  for (let s = min; s <= max; s++) {
    const r = scoreToRank(t, s);
    assert(r !== null, `expected a rank for in-range score ${s}`);
    if (prev !== null) {
      assert(
        (r as number) <= prev,
        `higher score ${s} should yield rank ≤ previous (${r} vs ${prev})`
      );
    }
    prev = r;
  }
});

// ── round-trip sanity ─────────────────────────────────────────────────────
// scoreToRank(s) returns the cumulative of the highest row whose score ≤ s.
// rankToScore(rank) returns the lowest score whose cumulative ≥ rank.
// Since beijing 2024 has a row for every integer score in [400,700] and
// cumulative is strictly increasing as score drops, the round-trip is exact
// for any in-range integer score that is itself a row score.
test("round-trip: rankToScore(scoreToRank(s)) === s for mid-range scores", () => {
  const t = load();
  for (const s of [620, 600, 580, 550, 500, 450]) {
    const rank = scoreToRank(t, s);
    assert(rank !== null, `score ${s} should resolve to a rank`);
    const back = rankToScore(t, rank as number);
    assertEqual(back, s, `round-trip for score ${s} (rank ${rank})`);
  }
});

// ── boundaries: scoreToRank ───────────────────────────────────────────────
// CONTRACT (from impl): scoreToRank returns the cumulative of the first row
// whose score ≤ input. A score ABOVE the table max therefore matches the
// top row → it CLAMPS to the top cumulative (it does NOT return null).
test("boundary: score above table max clamps to top-row cumulative", () => {
  const t = load();
  const topRow = t.rows[0]; // highest score row (score 700, cumulative 117)
  const rank = scoreToRank(t, topRow.score + 50); // e.g. 750
  assertEqual(
    rank,
    topRow.cumulative,
    "score above max should clamp to the top row's cumulative, not null"
  );
});

// CONTRACT: a score BELOW the lowest row's score matches no row → returns null.
test("boundary: score below table min returns null", () => {
  const t = load();
  const minScore = t.rows[t.rows.length - 1].score; // 400
  assertEqual(
    scoreToRank(t, minScore - 1),
    null,
    "score below the lowest row should return null"
  );
});

test("boundary: exact min-row score returns its cumulative", () => {
  const t = load();
  const lastRow = t.rows[t.rows.length - 1];
  assertEqual(
    scoreToRank(t, lastRow.score),
    lastRow.cumulative,
    "exact lowest row score should return that row's cumulative"
  );
});

// ── boundaries: rankToScore ───────────────────────────────────────────────
// CONTRACT: rankToScore returns the lowest score whose cumulative ≥ rank.
// rank = 1 matches the very first row (its cumulative is already ≥ 1) →
// returns the TOP score, not the bottom.
test("boundary: rankToScore(1) returns the top-row score", () => {
  const t = load();
  const topRow = t.rows[0];
  assertEqual(
    rankToScore(t, 1),
    topRow.score,
    "rank 1 should resolve to the highest score in the table"
  );
});

// CONTRACT: a rank larger than the total candidates exceeds every cumulative →
// no row satisfies cumulative ≥ rank → returns null.
test("boundary: rank beyond total candidates returns null", () => {
  const t = load();
  const maxCumulative = t.rows[t.rows.length - 1].cumulative;
  assertEqual(
    rankToScore(t, maxCumulative + 1),
    null,
    "rank larger than every cumulative should return null"
  );
});

test("boundary: rank equal to total candidates returns the bottom score", () => {
  const t = load();
  const lastRow = t.rows[t.rows.length - 1];
  assertEqual(
    rankToScore(t, lastRow.cumulative),
    lastRow.score,
    "rank equal to the max cumulative should resolve to the lowest score"
  );
});
