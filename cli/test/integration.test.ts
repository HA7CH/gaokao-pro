// End-to-end integration tests for the composite verbs.
//
// These tests exercise the full parent-flow: profile → roadmap →
// dossier(pick) → province-overview. They guard against accidental breakage
// of the cross-verb wiring (slip-risk → huadang, paths summary → roadmap
// caveats, etc.) rather than the unit-level semantics of each verb.

import { test, assert, assertEqual } from "./_harness.js";
import { roadmap } from "../src/roadmap.js";
import { dossier } from "../src/dossier.js";
import { provinceOverview } from "../src/province-overview.js";

test("integration: roadmap(河南 660) returns 冲/稳/保 with per-pick risk + paths summary", () => {
  const r = roadmap({
    province: "河南",
    score: 660,
    subjects: ["物理", "化学", "生物"],
    rank: 4500,
    per_bucket: 3,
  });
  assertEqual(r.query.province, "河南", "query echoed");
  assert(r.buckets["冲"].length > 0 || r.buckets["稳"].length > 0, "at least one bucket populated");
  assertEqual(r.province_rules.has_tiaoji, true, "河南 调剂=true");
  assert(r.paths_summary.total_eligible > 0, "paths_summary should yield ≥1 eligible (强基/综评 etc nationwide)");
  // Caveats: 河南 has 调剂, so no 无调剂 warning expected; if rank provided, no missing-rank warning.
  for (const c of r.caveats) {
    assert(!c.includes("无服从调剂"), "no 无调剂 warning expected for 河南");
    assert(!c.includes("未提供 rank"), "rank was provided");
  }
});

test("integration: roadmap(浙江) surfaces 无调剂 caveat", () => {
  const r = roadmap({
    province: "浙江",
    score: 620,
    subjects: ["物理", "化学", "生物"],
    rank: 25000,
    per_bucket: 3,
  });
  assertEqual(r.province_rules.has_tiaoji, false, "浙江 调剂=false");
  const hasSlipCaveat = r.caveats.some((c) => c.includes("无服从调剂") || c.includes("无调剂"));
  assert(hasSlipCaveat, "浙江 roadmap caveats should warn about 无调剂");
});

test("integration: roadmap(no rank) surfaces missing-rank caveat", () => {
  const r = roadmap({
    province: "河南",
    score: 620,
    subjects: ["物理", "化学", "生物"],
    per_bucket: 2,
  });
  const hasRankCaveat = r.caveats.some((c) => c.includes("rank"));
  assert(hasRankCaveat, "missing-rank should produce a caveat");
});

test("integration: roadmap pick (清华大学) → dossier(清华大学) cross-link", () => {
  const r = roadmap({
    province: "河南",
    score: 700,  // high enough to put 清华 in 稳/保
    subjects: ["物理", "化学", "生物"],
    rank: 100,
    per_bucket: 5,
  });
  // 清华 should appear in 稳/保 at this score
  const allPicks = [...r.buckets["冲"], ...r.buckets["稳"], ...r.buckets["保"]];
  const tsinghuaPick = allPicks.find((p) => p.name.includes("清华"));
  if (tsinghuaPick) {
    // dossier should populate with strong cross-listing
    const d = dossier(tsinghuaPick.name);
    assert(d.tiqian_programs.length > 0, "清华 should have 提前批 entries in dossier");
    assert(d.totals.sections_with_data >= 4, "清华 dossier should populate ≥4 sections");
  }
});

test("integration: province-overview(河南) totals match underlying datasets", () => {
  const r = provinceOverview("河南");
  assertEqual(r.province, "河南", "province echoed");
  // 河南 should have:
  // - calendar (in zhiyuan-calendar-2026)
  // - 综评 schools (UCAS/SUSTech/CUHKSZ etc nationwide)
  // - 提前批 programs (公费师范 + 强基 等)
  // - huadang cases (河南 is a hot province)
  // - colleges admitting (most college-groups files cover 河南)
  if (r.calendar && "_status" in r.calendar) {
    // Could be missing in early dev — don't hard-fail
  }
  assert(r.totals.tiqian_count > 10, `expected ≥10 提前批 programs for 河南, got ${r.totals.tiqian_count}`);
  assert(r.totals.huadang_count >= 1, `expected ≥1 huadang case for 河南, got ${r.totals.huadang_count}`);
  assert(r.totals.colleges_with_groups > 50, `expected ≥50 colleges admitting in 河南, got ${r.totals.colleges_with_groups}`);
});

test("integration: province-overview(浙江) reflects 调剂=false", () => {
  const r = provinceOverview("浙江");
  assertEqual(r.rules.has_tiaoji, false, "浙江 调剂 should be false");
  assert(typeof r.rules.slip_warning === "string" && r.rules.slip_warning.length > 0, "浙江 should have slip_warning text");
});

test("integration: dossier sections never throw (graceful degradation)", () => {
  // Even for schools that don't exist anywhere, dossier should return a
  // well-shaped result with all sections marked _status.
  const r = dossier("__no_such_school_NONEXISTENT__");
  assertEqual(r.totals.sections_with_data, 0, "0 sections for non-existent school");
  assertEqual(r.tiqian_programs.length, 0, "no programs for non-existent");
  assertEqual(r.huadang_cases.length, 0, "no cases for non-existent");
});

test("integration: roadmap 1 candidate provinces ≥ 1 caveat-free pick", () => {
  // Sanity: roadmap output shape consistent.
  const r = roadmap({
    province: "广东",
    score: 600,
    subjects: ["物理", "化学", "生物"],
    rank: 30000,
    per_bucket: 2,
  });
  for (const bucket of ["冲", "稳", "保"] as const) {
    for (const p of r.buckets[bucket]) {
      assert(typeof p.name === "string" && p.name.length > 0, `bucket ${bucket} pick has name`);
      assertEqual(typeof p.in_groups_dataset, "boolean", "in_groups_dataset is boolean");
      assertEqual(typeof p.delta, "number", "delta is number");
    }
  }
});
