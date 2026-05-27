// Unit tests locking in the correctness of the 选科 (subject-selection) matching
// logic — xuankeMatch + decodeXuanke. Offline only.
import { test, assert, assertEqual } from "./_harness.js";
import { xuankeMatch, decodeXuanke } from "../src/xuanke.js";

// Common student profiles (canonical subject names).
const PHYS_CHEM_BIO = ["物理", "化学", "生物"];
const HIST_POL_GEO = ["历史", "政治", "地理"];

// --------------------------------------------------------------------------
// 不限 forms
// --------------------------------------------------------------------------
test("不限 string → ok regardless of subjects", () => {
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, "不限").ok, true, "不限 with phys student");
  assertEqual(xuankeMatch(HIST_POL_GEO, "不限").ok, true, "不限 with hist student");
  assertEqual(xuankeMatch([], "不限").ok, true, "不限 with no subjects");
});

test("empty requirement string → ok (no requirement)", () => {
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, "").ok, true, "empty string");
  assertEqual(xuankeMatch([], "").ok, true, "empty string, no subjects");
});

test("empty array requirement → ok (no requirement)", () => {
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, []).ok, true, "empty array");
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, ["", "  "]).ok, true, "array of blanks");
});

test("numeric code 70008 (不限) → ok regardless of subjects", () => {
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, "70008").ok, true, "70008 phys");
  assertEqual(xuankeMatch(HIST_POL_GEO, "70008").ok, true, "70008 hist");
  assertEqual(xuankeMatch([], "70008").ok, true, "70008 no subjects");
});

// --------------------------------------------------------------------------
// single required subject
// --------------------------------------------------------------------------
test("single subject 物理 → ok iff student has 物理", () => {
  assertEqual(xuankeMatch(PHYS_CHEM_BIO, "物理").ok, true, "has 物理");
  const r = xuankeMatch(HIST_POL_GEO, "物理");
  assertEqual(r.ok, false, "lacks 物理");
  assert(r.reason.includes("物理"), `reason should name 物理: ${r.reason}`);
});

// --------------------------------------------------------------------------
// AND combinations across separators
// --------------------------------------------------------------------------
for (const sep of ["+", "、", "和", "与"]) {
  const req = `物理${sep}化学`;
  test(`AND "${req}" requires BOTH`, () => {
    assertEqual(
      xuankeMatch(["物理", "化学"], req).ok,
      true,
      `has both for ${req}`
    );
    // missing 化学
    const r = xuankeMatch(["物理", "生物"], req);
    assertEqual(r.ok, false, `missing 化学 for ${req}`);
    assert(r.reason.includes("化学"), `reason should name missing 化学: ${r.reason}`);
    assert(!r.reason.includes("物理 (") || r.reason.includes("化学"), "sanity");
    // missing 物理
    const r2 = xuankeMatch(["化学", "生物"], req);
    assertEqual(r2.ok, false, `missing 物理 for ${req}`);
    assert(r2.reason.includes("物理"), `reason should name missing 物理: ${r2.reason}`);
  });
}

// --------------------------------------------------------------------------
// OR combinations
// --------------------------------------------------------------------------
test("OR 物理或历史 → ok if at least one", () => {
  assertEqual(xuankeMatch(["物理", "化学"], "物理或历史").ok, true, "has 物理");
  assertEqual(xuankeMatch(["历史", "政治"], "物理或历史").ok, true, "has 历史");
  const r = xuankeMatch(["化学", "生物"], "物理或历史");
  assertEqual(r.ok, false, "has neither");
  assert(r.reason.includes("物理") && r.reason.includes("历史"), `reason names both options: ${r.reason}`);
});

test("OR 化学/生物 → ok if at least one", () => {
  assertEqual(xuankeMatch(["化学"], "化学/生物").ok, true, "has 化学");
  assertEqual(xuankeMatch(["生物"], "化学/生物").ok, true, "has 生物");
  assertEqual(xuankeMatch(["物理"], "化学/生物").ok, false, "has neither");
});

// --------------------------------------------------------------------------
// 任选N门 phrasing → at-least-N semantics
// --------------------------------------------------------------------------
test("任选1门 化学、生物任选1门 → at least one", () => {
  assertEqual(xuankeMatch(["化学"], "化学、生物任选1门").ok, true, "has 化学");
  assertEqual(xuankeMatch(["生物"], "化学、生物任选1门").ok, true, "has 生物");
  assertEqual(xuankeMatch(["化学", "生物"], "化学、生物任选1门").ok, true, "has both");
  const r = xuankeMatch(["物理"], "化学、生物任选1门");
  assertEqual(r.ok, false, "has neither");
  assert(r.reason.includes("化学") && r.reason.includes("生物"), `reason names options: ${r.reason}`);
});

test("任选2门 物理、化学、生物任选2门 → at least two", () => {
  assertEqual(xuankeMatch(["物理", "化学"], "物理、化学、生物任选2门").ok, true, "has two");
  assertEqual(xuankeMatch(["物理", "化学", "生物"], "物理、化学、生物任选2门").ok, true, "has three");
  const r = xuankeMatch(["物理", "历史"], "物理、化学、生物任选2门");
  assertEqual(r.ok, false, "only one of the three");
  assert(r.reason.includes("2"), `reason should mention needing 2: ${r.reason}`);
});

// --------------------------------------------------------------------------
// numeric codes 70001-70006 single
// --------------------------------------------------------------------------
const CODE_TO_SUBJECT: Record<string, string> = {
  "70001": "物理",
  "70002": "化学",
  "70003": "生物",
  "70004": "历史",
  "70005": "政治",
  "70006": "地理"
};
for (const [code, subject] of Object.entries(CODE_TO_SUBJECT)) {
  test(`numeric code ${code} → requires ${subject}`, () => {
    assertEqual(xuankeMatch([subject], code).ok, true, `has ${subject} for ${code}`);
    const others = ["物理", "化学", "生物", "历史", "政治", "地理"].filter((s) => s !== subject);
    const r = xuankeMatch(others, code);
    assertEqual(r.ok, false, `lacks ${subject} for ${code}`);
    assert(r.reason.includes(subject), `reason should name ${subject}: ${r.reason}`);
  });
}

test("numeric AND code 70001_70002 → requires 物理 AND 化学", () => {
  assertEqual(xuankeMatch(["物理", "化学"], "70001_70002").ok, true, "has both");
  const r = xuankeMatch(["物理", "生物"], "70001_70002");
  assertEqual(r.ok, false, "missing 化学");
  assert(r.reason.includes("化学"), `reason names 化学: ${r.reason}`);
});

test("numeric OR-of-ANDs code 70001_70004^70004_70005 → at least one of involved subjects", () => {
  // Impl flattens multi-group ^-form to OR(n=1) over the union of subjects.
  // (物理 AND 历史) OR (历史 AND 政治) — union = {物理,历史,政治}.
  assertEqual(xuankeMatch(["物理"], "70001_70004^70004_70005").ok, true, "has 物理 (in union)");
  assertEqual(xuankeMatch(["历史"], "70001_70004^70004_70005").ok, true, "has 历史 (in union)");
  const r = xuankeMatch(["化学", "生物"], "70001_70004^70004_70005");
  assertEqual(r.ok, false, "has none of the union");
});

test("numeric code with 70008 group → 不限", () => {
  assertEqual(xuankeMatch(["历史"], "70001^70008").ok, true, "70008 alternative → 不限");
});

// --------------------------------------------------------------------------
// array requirement (fxk + sxk both present) → ALL required
// --------------------------------------------------------------------------
test("array requirement [物理, 化学] → both fields must be satisfied", () => {
  assertEqual(xuankeMatch(["物理", "化学"], ["物理", "化学"]).ok, true, "has both");
  const r = xuankeMatch(["物理", "生物"], ["物理", "化学"]);
  assertEqual(r.ok, false, "missing 化学 field");
  assert(r.reason.includes("化学"), `reason names 化学: ${r.reason}`);
});

test("array requirement with one 不限 field → only other field matters", () => {
  assertEqual(xuankeMatch(["物理"], ["物理", "不限"]).ok, true, "satisfies 物理, 不限 free");
  assertEqual(xuankeMatch(["历史"], ["物理", "不限"]).ok, false, "fails 物理 field");
});

// --------------------------------------------------------------------------
// 化学 normalization edge case — multi-char names must not be mangled
// --------------------------------------------------------------------------
test("化学 requirement matches 化学 holder, not by single chars", () => {
  // student with 化学 matches
  assertEqual(xuankeMatch(["化学"], "化学").ok, true, "化学 holder matches 化学");
  // student WITHOUT 化学 does not match (even though names share chars elsewhere)
  assertEqual(xuankeMatch(["物理", "生物"], "化学").ok, false, "no 化学 → fail");
  // 化学 must NOT be satisfied by a student who only has e.g. 物理 (contains 学? no)
  assertEqual(xuankeMatch(["地理"], "化学").ok, false, "地理 does not satisfy 化学");
});

for (const subj of ["政治", "地理", "生物", "历史"]) {
  test(`multi-char subject ${subj} matched exactly, not corrupted`, () => {
    assertEqual(xuankeMatch([subj], subj).ok, true, `${subj} holder matches ${subj}`);
    const others = ["物理", "化学", "生物", "历史", "政治", "地理"].filter((s) => s !== subj);
    assertEqual(xuankeMatch(others, subj).ok, false, `non-${subj} holders fail ${subj}`);
  });
}

// --------------------------------------------------------------------------
// decodeXuanke
// --------------------------------------------------------------------------
test("decodeXuanke AND combination", () => {
  const d = decodeXuanke("70001_70002");
  assertEqual(d.display, "物理+化学", "AND display");
  assertEqual(d.unrestricted, false, "not unrestricted");
  assertEqual(d.combinations.length, 1, "one combination");
});

test("decodeXuanke OR-of-ANDs combination", () => {
  const d = decodeXuanke("70001_70002^70001_70003");
  assertEqual(d.display, "物理+化学 或 物理+生物", "OR-of-ANDs display");
  assertEqual(d.combinations.length, 2, "two combinations");
});

test("decodeXuanke 不限 (70008)", () => {
  const d = decodeXuanke("70008");
  assertEqual(d.unrestricted, true, "70008 unrestricted");
  assertEqual(d.display, "不限", "display 不限");
});

test("decodeXuanke empty → 无数据", () => {
  const d = decodeXuanke("");
  assertEqual(d.display, "(无数据)", "empty display");
  assertEqual(d.unrestricted, false, "empty not unrestricted");
});
