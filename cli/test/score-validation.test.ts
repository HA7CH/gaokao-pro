// Locks in the correctness of score-input validation (finding #12).
//
// Covers the shared helpers in src/codes.ts (validateScore / maxScoreFor) and
// the offline entry points that wire them in (recommend / top / match). These
// are OFFLINE-only paths — they read the local school index, no network — so
// they're safe to exercise here. recommendMajor/find DO hit the network and are
// intentionally NOT touched.
//
// Validation contract (read from src/codes.ts + the three entry points):
//   validateScore(score, provinceId) RETURNS void on valid input and THROWS a
//   plain Error (Chinese message starting "无效分数:") on invalid input. The
//   three entry points are all SYNCHRONOUS and call validateScore() as their
//   first statement, so an invalid score throws synchronously before any index
//   work happens. We therefore use assertThrows (sync) throughout.
//
// Provincial caps: 海南(46)=900, 上海(31)=660, everything else=750.
// Valid range is (0, cap] — strictly positive, up to and including the cap.
import { test, assert, assertEqual, assertThrows } from "./_harness.js";
import { validateScore, maxScoreFor, type ProvinceId } from "../src/codes.js";
import { recommend } from "../src/recommend.js";
import { top } from "../src/top.js";
import { match } from "../src/match.js";

const HENAN = 41 as ProvinceId;   // normal province (cap 750)
const HAINAN = 46 as ProvinceId;  // cap 900
const SHANGHAI = 31 as ProvinceId; // cap 660
const SUBJECTS = ["物理", "化学", "生物"] as const;

// --- maxScoreFor ----------------------------------------------------------

test("maxScoreFor 海南 = 900", () => {
  assertEqual(maxScoreFor(HAINAN), 900);
});

test("maxScoreFor 上海 = 660", () => {
  assertEqual(maxScoreFor(SHANGHAI), 660);
});

test("maxScoreFor default province (河南) = 750", () => {
  assertEqual(maxScoreFor(HENAN), 750);
});

// --- validateScore: ACCEPTS valid scores (no throw, returns void) ---------

test("validateScore accepts 660 for a normal province (河南)", () => {
  assertEqual(validateScore(660, HENAN), undefined);
});

test("validateScore accepts 660 for 海南", () => {
  assertEqual(validateScore(660, HAINAN), undefined);
});

test("validateScore accepts 660 for 上海 (= cap, boundary inclusive)", () => {
  assertEqual(validateScore(660, SHANGHAI), undefined);
});

test("validateScore accepts 750 for a normal province (河南, = cap)", () => {
  assertEqual(validateScore(750, HENAN), undefined);
});

test("validateScore accepts 900 for 海南 (= cap)", () => {
  assertEqual(validateScore(900, HAINAN), undefined);
});

// --- validateScore: REJECTS invalid scores (throws Error) -----------------

test("validateScore rejects negative (-50)", () => {
  assertThrows(() => validateScore(-50, HENAN), "negative score must throw");
});

test("validateScore rejects zero (0) — range is (0, cap], strictly positive", () => {
  assertThrows(() => validateScore(0, HENAN), "zero score must throw");
});

test("validateScore rejects NaN", () => {
  assertThrows(() => validateScore(NaN, HENAN), "NaN score must throw");
});

test("validateScore rejects Infinity", () => {
  assertThrows(() => validateScore(Infinity, HENAN), "Infinity score must throw");
});

test("validateScore rejects over-cap 800 for a 750 province (河南)", () => {
  assertThrows(() => validateScore(800, HENAN), "over-cap (750) score must throw");
});

test("validateScore rejects over-cap 901 for 海南 (cap 900)", () => {
  assertThrows(() => validateScore(901, HAINAN), "over-cap (900) score must throw");
});

test("validateScore rejects over-cap 661 for 上海 (cap 660)", () => {
  assertThrows(() => validateScore(661, SHANGHAI), "over-cap (660) score must throw");
});

// Confirm the throw is an Error carrying a meaningful, actionable message
// (not a bare throw / undefined). This pins the contract callers rely on.
test("validateScore error message identifies it as an invalid score", () => {
  let caught: unknown;
  try {
    validateScore(-50, HENAN);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, "expected an Error instance to be thrown");
  assert(
    /无效分数/.test((caught as Error).message),
    `error message should flag an invalid score, got: ${(caught as Error).message}`
  );
});

test("validateScore over-cap message names the province cap", () => {
  let caught: unknown;
  try {
    validateScore(800, HENAN);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, "expected an Error instance");
  assert(
    /750/.test((caught as Error).message),
    `over-cap message should mention the 750 cap, got: ${(caught as Error).message}`
  );
});

// --- End-to-end: recommend (offline) --------------------------------------

test("recommend rejects negative score (-50)", () => {
  assertThrows(
    () => recommend({ score: -50, provinceId: HENAN, subjects: [...SUBJECTS] }),
    "recommend with negative score must throw"
  );
});

test("recommend rejects absurd over-cap score (9999)", () => {
  assertThrows(
    () => recommend({ score: 9999, provinceId: HENAN, subjects: [...SUBJECTS] }),
    "recommend with over-cap score must throw"
  );
});

test("recommend succeeds with valid score (660) and returns buckets", () => {
  const out = recommend({ score: 660, provinceId: HENAN, subjects: [...SUBJECTS] });
  assert(out && typeof out === "object", "recommend should return an object");
  assert(out.buckets && typeof out.buckets === "object", "result should carry buckets");
  // All four bucket arrays should exist (correctness of the returned shape).
  assert(Array.isArray(out.buckets["保"]), "保 bucket should be an array");
  assert(Array.isArray(out.buckets["稳"]), "稳 bucket should be an array");
  assert(Array.isArray(out.buckets["冲"]), "冲 bucket should be an array");
  assert(Array.isArray(out.buckets.out), "out bucket should be an array");
  assertEqual(out.query.score, 660);
});

// --- End-to-end: top (offline) --------------------------------------------

test("top rejects invalid score (0)", () => {
  assertThrows(
    () => top({ score: 0, provinceId: HENAN, subjects: [...SUBJECTS] }),
    "top with zero score must throw"
  );
});

test("top succeeds with valid score (660) and returns rows", () => {
  const out = top({ score: 660, provinceId: HENAN, subjects: [...SUBJECTS] });
  assert(out && typeof out === "object", "top should return an object");
  assert(Array.isArray(out.rows), "top result should carry a rows array");
});

// --- End-to-end: match (offline) ------------------------------------------
// NOTE: match's profile uses `province` (not `provinceId`).

test("match rejects invalid score (NaN)", () => {
  assertThrows(
    () => match({ score: NaN, province: HENAN, subjects: [...SUBJECTS] }),
    "match with NaN score must throw"
  );
});

test("match succeeds with valid score (660) and returns candidates", () => {
  const out = match({ score: 660, province: HENAN, subjects: [...SUBJECTS] });
  assert(out && typeof out === "object", "match should return an object");
  assert(Array.isArray(out.candidates), "match result should carry a candidates array");
});
