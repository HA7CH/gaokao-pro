// Unit tests locking in the correctness of match()'s composite scoring.
// Offline only — match() reads the local school index, no network.
//
// Background (finding #3, see src/match.ts header): the heaviest composite
// component (interestFit, weight 0.40) used to inject a CONSTANT 0.5 because
// the offline index carries no major-level signal. A constant at the heaviest
// weight biases every school identically — pure noise dominating ranking. The
// fix DROPS the interest component when there is no real signal and
// renormalizes the remaining weights (baseline/label/city) so they sum to 1.
// These tests pin that behavior so it cannot silently regress.
//
// interestFitScore() and computeComposite() are not exported, so we exercise
// them through the public match() API — a stronger lock, since it asserts the
// composite values that actually drive the ranking.
import { test, assert, assertEqual } from "./_harness.js";
import { match, type MatchCandidate, type Profile } from "../src/match.js";

// Documented composite weights (src/match.ts: W_INTEREST/W_BASELINE/W_LABEL/W_CITY).
// Not exported, so mirrored here; a test asserts they sum to 1.0 (their contract).
const W_INTEREST = 0.40;
const W_BASELINE = 0.35;
const W_LABEL = 0.15;
const W_CITY = 0.10;

// Mirror of labelWeight() in src/match.ts, derived from the public candidate
// fields (is985/is211/dualClass) so we can recompute the composite.
function labelWeightOf(c: MatchCandidate): number {
  if (c.is985) return 1.0;
  if (c.is211) return 0.7;
  if (c.dualClass === "双一流") return 0.5;
  return 0.2;
}

// Recompute the renormalized composite from the documented components, using
// ONLY the three components that carry signal offline (interest is absent).
// This mirrors computeComposite() with interestFit === null.
function recomposeWithoutInterest(c: MatchCandidate): number {
  const baselineNorm = c.baselineMinScore / 750;
  const labelW = labelWeightOf(c);
  const cityNorm = (c.cityBonus + 0.5) / 1.5; // normalize {-0.5,0,1} → [0,1]
  const totalW = W_BASELINE + W_LABEL + W_CITY;
  return (W_BASELINE * baselineNorm + W_LABEL * labelW + W_CITY * cityNorm) / totalW;
}

// Canonical smoke-mirroring profile: 660 / 河南(41) / 物化生 / 985-only.
const PROFILE_985: Profile = {
  score: 660,
  province: 41,
  subjects: ["物理", "化学", "生物"],
  constraints: { require_985: true }
};

// --------------------------------------------------------------------------
// weight constants
// --------------------------------------------------------------------------
test("composite weights sum to 1.0", () => {
  const sum = W_INTEREST + W_BASELINE + W_LABEL + W_CITY;
  assert(Math.abs(sum - 1.0) < 1e-12, `weights must sum to 1.0, got ${sum}`);
});

test("non-interest weights renormalize to 1.0 (composite of all-equal components == that value)", () => {
  // When the interest component is absent and the remaining three components
  // all equal v, the renormalized composite must equal v exactly — i.e. the
  // present weights divided by their own sum are a proper convex combination.
  const totalW = W_BASELINE + W_LABEL + W_CITY;
  for (const v of [0, 0.25, 0.5, 0.7777, 1]) {
    const composite = (W_BASELINE * v + W_LABEL * v + W_CITY * v) / totalW;
    assert(Math.abs(composite - v) < 1e-12, `all-equal=${v} should yield composite ${v}, got ${composite}`);
  }
});

// --------------------------------------------------------------------------
// match() well-formedness (mirrors smoke: ≥10 candidates for this profile)
// --------------------------------------------------------------------------
test("match 660 / 河南 / 物化生 / 985 returns ≥10 well-formed candidates", () => {
  const out = match(PROFILE_985, 20);
  assert(out.candidates.length >= 10, `expected ≥10 candidates, got ${out.candidates.length}`);
  assert(out.considered > 0, "considered should be > 0");
  assertEqual(out.candidates.length <= 20, true, "limit 20 respected");

  for (const c of out.candidates) {
    assert(typeof c.name === "string" && c.name.length > 0, `candidate name missing: ${JSON.stringify(c)}`);
    assert(Number.isFinite(c.composite), `composite not finite for ${c.name}: ${c.composite}`);
    assert(c.composite >= 0 && c.composite <= 1, `composite out of [0,1] for ${c.name}: ${c.composite}`);
    assert(Number.isFinite(c.baselineMinScore) && c.baselineMinScore > 0, `bad baseline for ${c.name}`);
    assert(Number.isFinite(c.delta), `delta not finite for ${c.name}`);
    // All filtered as 985 → every candidate must be 985.
    assertEqual(c.is985, true, `985 filter should yield only 985 schools (${c.name})`);
  }
});

// --------------------------------------------------------------------------
// ordering invariant
// --------------------------------------------------------------------------
test("candidates are sorted by composite descending", () => {
  const out = match(PROFILE_985, 20);
  for (let i = 1; i < out.candidates.length; i++) {
    assert(
      out.candidates[i - 1].composite >= out.candidates[i].composite,
      `not sorted desc at ${i}: ${out.candidates[i - 1].composite} < ${out.candidates[i].composite}`
    );
  }
});

// --------------------------------------------------------------------------
// renormalization correctness — the published composite IS the renormalized
// blend of the present (non-interest) components, with no constant injected.
// --------------------------------------------------------------------------
test("composite equals renormalized blend over present (non-interest) components", () => {
  const out = match(PROFILE_985, 20);
  assert(out.candidates.length > 0, "need candidates to verify");
  for (const c of out.candidates) {
    const expected = recomposeWithoutInterest(c);
    assert(
      Math.abs(expected - c.composite) < 1e-9,
      `composite mismatch for ${c.name}: published ${c.composite}, renormalized ${expected}`
    );
  }
});

// --------------------------------------------------------------------------
// no constant interest is injected — interestFit is surfaced as 0 (no signal),
// NOT a fake 0.5, even when the student DOES supply interests.
// --------------------------------------------------------------------------
test("interestFit is 0 (no signal) offline — never a constant 0.5", () => {
  // Without interests.
  const out = match(PROFILE_985, 20);
  for (const c of out.candidates) {
    assertEqual(c.interestFit, 0, `interestFit should be 0 offline (no signal), got ${c.interestFit} for ${c.name}`);
  }
  // WITH interests supplied — offline index has no major-level data, so the
  // interest signal is still null → surfaced as 0, never 0.5.
  const withInterests = match(
    { ...PROFILE_985, interests: ["计算机", "医学", "法学"] },
    20
  );
  for (const c of withInterests.candidates) {
    assertEqual(c.interestFit, 0, `interestFit should stay 0 with no index signal, got ${c.interestFit} for ${c.name}`);
    assert(c.interestFit !== 0.5, `interestFit must never be the dead constant 0.5 (${c.name})`);
  }
});

// --------------------------------------------------------------------------
// the absent interest term does NOT perturb ranking — two profiles that differ
// ONLY in the (signal-less) interest input produce byte-identical composites
// and ordering. This is the core anti-regression assertion for finding #3.
// --------------------------------------------------------------------------
test("absent interest signal does not perturb composite or ranking", () => {
  const without = match(PROFILE_985, 20);
  const withInterests = match(
    { ...PROFILE_985, interests: ["计算机", "金融", "建筑"] },
    20
  );

  assertEqual(
    withInterests.candidates.length,
    without.candidates.length,
    "candidate count must be unchanged by signal-less interests"
  );

  for (let i = 0; i < without.candidates.length; i++) {
    const a = without.candidates[i];
    const b = withInterests.candidates[i];
    assertEqual(b.schoolId, a.schoolId, `ranking order changed at #${i}: ${a.name} vs ${b.name}`);
    // Composite must be IDENTICAL — renormalization drops the absent interest
    // term so it contributes nothing. If a constant were injected at W_INTEREST,
    // these would diverge.
    assert(
      a.composite === b.composite,
      `composite perturbed by absent interest at #${i} (${a.name}): ${a.composite} vs ${b.composite}`
    );
  }
});

// --------------------------------------------------------------------------
// real interest-value path — NOT TESTABLE OFFLINE.
//
// interestFitScore() returns a real value in [0,1] only when a row carries
// `special_arr` (school-level 强势专业 keywords). The offline index ships ZERO
// rows with special_arr (verified: loadIndex().rows all lack it), so the
// real-signal branch and the four-weight (interest-present) composite cannot
// be exercised without network/major data not present offline. Per the task,
// this path is SKIPPED and noted; the assertions above instead lock the
// no-signal branch (interest dropped + renormalize), which is the actual
// offline behavior and the subject of finding #3.
// --------------------------------------------------------------------------
test("real interest path is not reachable offline (documented skip)", () => {
  // Sanity: supplying interests offline never produces a non-zero interestFit,
  // confirming the real-signal branch is genuinely unreachable here.
  const out = match({ ...PROFILE_985, interests: ["物理学", "数学"] }, 20);
  const anyNonZero = out.candidates.some((c) => c.interestFit !== 0);
  assertEqual(anyNonZero, false, "no offline row should yield a non-zero interestFit (no special_arr in index)");
});
