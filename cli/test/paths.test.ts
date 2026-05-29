// Unit tests for `paths` (cli/src/paths.ts) — the composite "what programs
// can my kid apply for?" verb.
//
// We exercise five canonical regimes against the curated datasets:
//   (a) plain query (no flags) — returns 综评 + 提前批 default-eligible items
//   (b) minority=true — opens 民族班/预科班 paths
//   (c) rural=true — opens 国家/高校 专项 paths
//   (d) serve=true — opens 公费师范 + 优师 paths
//   (e) sport_tier + sport_name=游泳 — opens 高水平运动队 swim entries
//
// All assertions are bound to invariants that don't break when more programs
// are added to the catalog (lower-bound counts, presence checks, caveat
// content), rather than fragile exact numbers.

import { test, assert, assertEqual } from "./_harness.js";
import { paths, type ProfileLite } from "../src/paths.js";

function baseProfile(province: string): ProfileLite {
  return {
    province,
    score: null,
    rank: null,
    is_minority: false,
    is_rural_county: false,
    agree_to_serve: false,
    sport_tier: null,
    sport_name: null,
    small_language: null,
  };
}

test("paths(广东) returns a province snapshot with 综评 + 提前批 buckets", () => {
  const r = paths(baseProfile("广东"));
  assertEqual(r.province, "广东");
  assert(r.pathways.length > 0, "pathways should be non-empty for 广东");
  // Verify both categories show up.
  const cats = new Set(r.pathways.map((p) => p.category));
  assert(cats.has("提前批"), "expected 提前批 category present");
  assert(cats.has("综评"), "expected 综评 category present");
  // 广东 has 调剂 — surface in province_rules.
  assertEqual(r.province_rules.has_tiaoji, true, "广东 should have 调剂=true");
});

test("paths: serve=false closes 公费师范生 (ineligible + caveat)", () => {
  const r = paths(baseProfile("广东"));
  const fees = r.pathways.filter((p) => p.program_type === "公费师范生");
  assert(fees.length > 0, "expected at least one 公费师范生 entry");
  for (const f of fees) {
    assertEqual(f.eligible, false, `${f.school} 公费师范 should be ineligible without serve=true`);
    assert(typeof f.caveat === "string" && f.caveat.includes("服务期"), `${f.school} caveat should mention 服务期`);
  }
});

test("paths: serve=true opens 公费师范生", () => {
  const p = baseProfile("广东");
  p.agree_to_serve = true;
  const r = paths(p);
  const fees = r.pathways.filter((p) => p.program_type === "公费师范生");
  assert(fees.length > 0, "expected 公费师范生 entries");
  assert(fees.some((f) => f.eligible), "expected at least one 公费师范生 to be eligible when serve=true");
});

test("paths: rural=true opens 高校专项", () => {
  const p = baseProfile("广东");
  p.is_rural_county = true;
  const r = paths(p);
  const zhuanxiang = r.pathways.filter((p) => p.program_type === "高校专项");
  assert(zhuanxiang.length > 0, "expected 高校专项 entries");
  assert(zhuanxiang.some((z) => z.eligible), "expected at least one 高校专项 eligible when rural=true");
});

test("paths: minority=true opens 民族班", () => {
  const p = baseProfile("广东");
  p.is_minority = true;
  const r = paths(p);
  const minzu = r.pathways.filter((p) => p.program_type === "民族班");
  assert(minzu.length > 0, "expected 民族班 entries");
  assert(minzu.some((m) => m.eligible), "expected at least one 民族班 eligible when minority=true");
});

test("paths: sport_tier + sport_name=游泳 surfaces swim recruiters", () => {
  const p = baseProfile("广东");
  p.sport_tier = "一级运动员";
  p.sport_name = "游泳";
  const r = paths(p);
  const swim = r.pathways.filter((p) => p.category === "高水平运动队");
  assert(swim.length > 0, "expected 高水平运动队 swim entries");
  // gaoshui-yundongdui-2025 covers 11+ swim schools; require ≥ 3 to pass
  assert(swim.length >= 3, `expected ≥ 3 swim recruiters, got ${swim.length}`);
});

test("paths: zhejiang 无调剂 surfaced in province_rules", () => {
  const r = paths(baseProfile("浙江"));
  assertEqual(r.province_rules.has_tiaoji, false, "浙江 应当 调剂=false");
  assert(typeof r.province_rules.slip_warning === "string" && r.province_rules.slip_warning.length > 0, "浙江 should have slip_warning text");
});

test("paths: summary_by_category aggregates totals", () => {
  const p = baseProfile("广东");
  p.is_minority = true;
  p.agree_to_serve = true;
  const r = paths(p);
  // Sum of all eligible across categories should equal total_eligible.
  let sum = 0;
  for (const v of Object.values(r.summary_by_category)) sum += v.eligible;
  assertEqual(sum, r.total_eligible, "summary_by_category eligible sum should equal total_eligible");
});
