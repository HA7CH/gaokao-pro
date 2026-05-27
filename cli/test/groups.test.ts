// Unit tests locking in the correctness of the college-groups loader
// (src/groups.ts). Offline only — data is local JSON under data/college-groups/.
//
// Context for these assertions: a fix made the loader tolerant of the wildly
// inconsistent source JSON schemas, which (a) recovered 79 universities (up
// from 68 — the 11 schools bjut/bsu/bucm/chd/henu/hfut/shutcm/sustech/usst/
// whut/ysu were previously dropped because their key/shape variants weren't
// understood) and (b) removed a hardcoded year so the loader now falls back to
// the newest year present on disk. The fix must NEVER fabricate data: a group
// with no per-major breakdown stays empty, missing values stay null, and a
// university name that only exists as a pinyin slug must still resolve to its
// real (Chinese) name rather than being invented or surfaced as the slug.
import { test, assert, assertEqual } from "./_harness.js";
import {
  datasetStats,
  findUniversity,
  listAllUniversities,
  listGroups,
  loadDataset,
  safetyScore,
} from "../src/groups.js";

// --------------------------------------------------------------------------
// datasetStats — recovered counts + surfaced year metadata
// --------------------------------------------------------------------------
test("datasetStats reports 79 recovered universities", () => {
  const s = datasetStats();
  // 79 is the current truth (recovered from 68). Asserted precisely: a drop
  // back toward 68 means the tolerant loader regressed and silently lost
  // schools again. A jump above 79 means new data files were added — also
  // worth a deliberate look, so we pin the exact number.
  assertEqual(s.universities, 79, "recovered university count");
});

test("datasetStats surfaces non-zero group/major totals", () => {
  const s = datasetStats();
  assert(s.total_groups > 0, `total_groups should be > 0, got ${s.total_groups}`);
  assert(s.total_majors > 0, `total_majors should be > 0, got ${s.total_majors}`);
});

test("datasetStats surfaces resolved year and available_years", () => {
  const s = datasetStats();
  assert(typeof s.year === "number" && s.year > 0, `year should be a positive number, got ${JSON.stringify(s.year)}`);
  assert(Array.isArray(s.available_years), "available_years should be an array");
  assert(s.available_years.length > 0, "available_years should be non-empty");
  assert(s.available_years.includes(s.year), `resolved year ${s.year} should be among available_years ${JSON.stringify(s.available_years)}`);
  // 2025 is the year currently on disk.
  assert(s.available_years.includes(2025), `available_years should include 2025, got ${JSON.stringify(s.available_years)}`);
});

// --------------------------------------------------------------------------
// Year resolution — explicit year honored, future/absent year falls back to
// newest available (no hardcoded year, no crash).
// --------------------------------------------------------------------------
test("loadDataset(2025) returns the requested year", () => {
  const { year, dataset } = loadDataset(2025);
  assertEqual(year, 2025, "requested existing year is honored");
  assert(dataset.universities.length > 0, "2025 dataset is populated");
});

test("loadDataset(2099) falls back to newest available year, not a crash", () => {
  const { year, dataset } = loadDataset(2099);
  // Newest (and only) year on disk is 2025 — the fallback must land there
  // rather than throwing or returning an empty 2099 dataset.
  assertEqual(year, 2025, "absent future year falls back to newest available");
  assert(dataset.universities.length > 0, "fallback dataset is populated");
});

test("loadDataset() with no year defaults to newest available", () => {
  const { year } = loadDataset();
  assertEqual(year, 2025, "default resolves to newest available year");
});

// --------------------------------------------------------------------------
// The 11 previously-dropped universities are now present. We assert by the
// resolved (Chinese) name the loader exposes — the slugs bjut/bsu/... map to
// these names. Lookup is substring-based (findUniversity uses .includes).
// --------------------------------------------------------------------------
const RECOVERED = [
  { slug: "bjut", name: "北京工业大学" },
  { slug: "bsu", name: "北京体育大学" },
  { slug: "bucm", name: "北京中医药大学" },
  { slug: "chd", name: "长安大学" },
  { slug: "henu", name: "河南大学" },
  { slug: "hfut", name: "合肥工业大学" },
  { slug: "shutcm", name: "上海中医药大学" },
  { slug: "sustech", name: "南方科技大学" },
  { slug: "usst", name: "上海理工大学" },
  { slug: "whut", name: "武汉理工大学" },
  { slug: "ysu", name: "燕山大学" },
];

for (const { slug, name } of RECOVERED) {
  test(`previously-dropped university recovered: ${slug} (${name})`, () => {
    const u = findUniversity(name);
    assert(u !== null, `findUniversity should locate ${name} (slug ${slug})`);
    assert(typeof u!.university === "string" && u!.university.includes(name), `resolved name should contain ${name}, got ${JSON.stringify(u!.university)}`);
  });
}

// --------------------------------------------------------------------------
// NO-FABRICATION invariant
// --------------------------------------------------------------------------
test("no university name is empty/null", () => {
  const names = listAllUniversities();
  assertEqual(names.length, 79, "all 79 schools have a name surfaced");
  for (const n of names) {
    assert(typeof n === "string" && n.length > 0, `university name must be a non-empty string, got ${JSON.stringify(n)}`);
  }
});

test("no university name is a pinyin/ASCII slug — Chinese names resolved", () => {
  // The fix resolved pinyin-only names (e.g. ccnu/csu) to their Chinese names.
  // A surviving ASCII-only name (like "ccnu") would mean a slug leaked through
  // instead of the real name. Every school name must contain CJK characters.
  const names = listAllUniversities();
  const HAS_CJK = /[一-鿿]/;
  for (const n of names) {
    assert(HAS_CJK.test(n), `name should be a Chinese name, not a pinyin slug: ${JSON.stringify(n)}`);
  }
  // Spot-check the two schools the fix specifically rescued from pinyin-only.
  assert(findUniversity("华中师范大学") !== null, "ccnu resolves to 华中师范大学");
  assert(findUniversity("中南大学") !== null, "csu resolves to 中南大学");
});

test("groups with no major breakdown expose an empty majors array, not invented majors", () => {
  // The report notes 516 groups legitimately have no per-major breakdown. Such
  // a group must expose majors: [] — the loader must NOT fabricate placeholder
  // majors to fill the gap. We scan for a real empty group and assert it.
  const { dataset } = loadDataset(2025);
  let checked = 0;
  for (const u of dataset.universities) {
    for (const p of u.provinces) {
      for (const g of p.groups) {
        if (g.majors.length === 0) {
          assertEqual(g.majors.length, 0, `empty group should have 0 majors (${u.university} / ${p.province} / ${g.group_code})`);
          assertEqual(g.majors_count, 0, "majors_count should mirror the empty majors array");
          checked++;
        }
      }
    }
  }
  assert(checked > 0, "expected at least one group with an empty majors array to exist");
});

test("every present major name is real (non-empty) or honestly null — never an empty string", () => {
  // Missing values stay missing: a major name is either a non-empty string or
  // null. The loader must not invent "" or placeholder text to look complete.
  const { dataset } = loadDataset(2025);
  for (const u of dataset.universities) {
    for (const p of u.provinces) {
      for (const g of p.groups) {
        for (const m of g.majors) {
          assert(m.name === null || (typeof m.name === "string" && m.name.length > 0), `major name must be null or non-empty string, got ${JSON.stringify(m.name)} in ${u.university}`);
        }
      }
    }
  }
});

// --------------------------------------------------------------------------
// safetyScore — sane structured result on a known group.
// --------------------------------------------------------------------------
test("safetyScore returns a sane structured result for a known group", () => {
  // Find a real group with several named majors to exercise the scoring.
  const { dataset } = loadDataset(2025);
  let target: { majors: { name: string | null }[] } | null = null;
  let sampleName = "";
  outer: for (const u of dataset.universities) {
    for (const p of u.provinces) {
      for (const g of p.groups) {
        const named = g.majors.filter((m) => typeof m.name === "string" && m.name!.length > 0);
        if (named.length >= 2) {
          target = g;
          sampleName = named[0].name!;
          break outer;
        }
      }
    }
  }
  assert(target !== null, "expected to find a group with named majors");

  const res = safetyScore(target as any, {
    must_have: [sampleName],
    acceptable: [],
    reject: ["__no_such_major__"],
  });

  // Structured shape sanity.
  assert(typeof res.score === "number" && res.score >= 0 && res.score <= 1, `score should be within [0,1], got ${res.score}`);
  assert(["safe", "moderate", "risky"].includes(res.verdict), `verdict should be one of safe/moderate/risky, got ${res.verdict}`);
  assertEqual(res.has_must, true, "must_have keyword present in the group → has_must true");
  assert(Array.isArray(res.matched_majors) && res.matched_majors.length > 0, "matched_majors should contain the matched major");
  assert(Array.isArray(res.rejected_majors), "rejected_majors should be an array");
});

test("safetyScore is risky when nothing matches and rejects are present", () => {
  const { dataset } = loadDataset(2025);
  let target: any = null;
  let rejectName = "";
  outer: for (const u of dataset.universities) {
    for (const p of u.provinces) {
      for (const g of p.groups) {
        const named = g.majors.filter((m: any) => typeof m.name === "string" && m.name.length > 0);
        if (named.length >= 1) {
          target = g;
          rejectName = named[0].name;
          break outer;
        }
      }
    }
  }
  assert(target !== null, "expected a group with at least one named major");
  const res = safetyScore(target, { must_have: ["__none__"], acceptable: [], reject: [rejectName] });
  assertEqual(res.has_must, false, "no must_have keyword matched");
  assert(res.rejected_majors.length > 0, "the named major should be flagged rejected");
});

// --------------------------------------------------------------------------
// listGroups — wired through findUniversity + province lookup.
// --------------------------------------------------------------------------
test("listGroups returns groups for a known university/province pair", () => {
  const { dataset } = loadDataset(2025);
  // Pick a real (university, province) pair that actually has groups.
  let uniName = "", provName = "";
  outer: for (const u of dataset.universities) {
    for (const p of u.provinces) {
      if (p.groups.length > 0 && p.province) {
        uniName = u.university;
        provName = p.province;
        break outer;
      }
    }
  }
  assert(uniName !== "" && provName !== "", "expected a populated university/province pair");
  const groups = listGroups(uniName, provName);
  assert(groups.length > 0, `listGroups(${uniName}, ${provName}) should return groups`);
  // Unknown province → empty, never fabricated.
  assertEqual(listGroups(uniName, "__no_such_province__").length, 0, "unknown province yields no groups");
});
