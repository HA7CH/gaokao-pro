// reform-track.test.ts — locks in the gaokao reform-year + track-inference
// logic that was just rebuilt (新疆 reform-year fix; old-reform 文/理 handling).
// OFFLINE only: uses the local school index (cli/data/school-index.json.gz) and
// the static PROVINCES table — no network. Run via `npx tsx test/run.ts`.
//
// ── Ground truth for reform years ──────────────────────────────────────────
// The ingested 一分一段 dataset under cli/data/yifenyiduan/ is the source of
// truth (cross-checked against docs/yifenyiduan-sources.md and the batch list
// documented in recommend.ts). A province's first 新高考 year is the year its
// physics/history files first replace the old science/liberal files:
//   批4 (first new exam 2024): files exist as `{prov}-2024-physics/history`.
//     安徽 江西 广西 贵州 甘肃 黑龙江 吉林
//   批5 (first new exam 2025): `{prov}-2024-science/liberal` (still old) +
//     `{prov}-2025-physics/history` (new). 河南 山西 内蒙古 四川 云南 陕西 青海 宁夏
//   新疆: `xinjiang-2024-science/liberal` AND `xinjiang-2025-science` — STILL
//     文/理 through 2025 (rollout delayed). It must NOT be flagged as a 2025
//     new-reform province (this was the bug being locked down).
//   批1–3 (上海/浙江 2017, 京津鲁琼 2020, 冀辽苏闽鄂湘粤渝 2021): reformed years
//     ago; intentionally NOT flagged — their pre-2024 histories are stable and
//     the warning is only about "don't extrapolate across the reform boundary"
//     within our 2024+ dataset window.
//
// NEW_REFORM_FIRST_YEAR is a module-local const (not exported), so we exercise
// it through its only consumer: recommend().query.reform_warning, whose string
// embeds the inferred first-reform year ("…在 <year> 年首次进入新高考…"). A
// flagged province yields that string; a non-flagged one yields no warning.

import { test, assert, assertEqual } from "./_harness.js";
import { recommend, inferTrack } from "../src/recommend.js";
import { PROVINCES, type ProvinceId } from "../src/codes.js";
import { inferDefaultTrack } from "../src/rank-table.js";

// Pull the first-reform year a province is flagged with (or null when the
// recommend() output carries no reform_warning). Subjects must satisfy
// inferTrack: 3+1+2 provinces require 物理 or 历史, so we always pass 物理 —
// it's valid for every reform regime here.
function flaggedReformYear(id: number): number | null {
  const out = recommend({
    score: 500,
    provinceId: id as ProvinceId,
    subjects: ["物理"],
    limit: 1
  });
  const w = out.query.reform_warning;
  if (!w) return null;
  const m = w.match(/在\s*(\d{4})\s*年/);
  assert(m !== null, `reform_warning present but year not parseable: ${w}`);
  return Number(m![1]);
}

// ── 新疆 (Xinjiang) — the headline regression ───────────────────────────────
// 新疆 is listed as 3+1+2 in PROVINCES but its 一分一段 data is still 文/理 in
// 2025, so it must NOT be treated as a 2025 new-reform province.
test("新疆 is NOT flagged as a 2025 new-reform province (rollout delayed)", () => {
  assertEqual(flaggedReformYear(65), null,
    "新疆(65) must carry no reform_warning — its data stays 文/理 through 2025");
});

// ── 批4 provinces: first new exam 2024 ──────────────────────────────────────
test("批4 provinces have first-reform-year 2024", () => {
  const batch4: Array<[number, string]> = [
    [34, "安徽"], [36, "江西"], [45, "广西"], [52, "贵州"],
    [62, "甘肃"], [23, "黑龙江"], [22, "吉林"]
  ];
  for (const [id, name] of batch4) {
    assertEqual(flaggedReformYear(id), 2024, `${name}(${id}) first-reform year`);
  }
});

// ── 批5 provinces: first new exam 2025 ──────────────────────────────────────
test("批5 provinces have first-reform-year 2025", () => {
  const batch5: Array<[number, string]> = [
    [41, "河南"], [51, "四川"], [61, "陕西"], [14, "山西"],
    [15, "内蒙古"], [53, "云南"], [63, "青海"], [64, "宁夏"]
  ];
  for (const [id, name] of batch5) {
    assertEqual(flaggedReformYear(id), 2025, `${name}(${id}) first-reform year`);
  }
});

// ── 批1–3 provinces: reformed long ago, intentionally NOT flagged ───────────
// (北京/山东/海南 = 2020 batch; 上海/浙江 = 2017; the 2021 batch likewise.)
test("long-reformed provinces (批1–3) carry no reform_warning", () => {
  const notFlagged: Array<[number, string]> = [
    [11, "北京"], [31, "上海"], [37, "山东"], [46, "海南"], [33, "浙江"], // 批1/2
    [13, "河北"], [21, "辽宁"], [43, "湖南"], [44, "广东"], [35, "福建"],
    [42, "湖北"], [32, "江苏"], [50, "重庆"]                              // 批3 (2021)
  ];
  for (const [id, name] of notFlagged) {
    assertEqual(flaggedReformYear(id), null, `${name}(${id}) must NOT be flagged`);
  }
});

// ── 西藏 (Tibet): modelled as old-reform 文/理, not misclassified ────────────
test("西藏 is modelled as old-reform (reform === 'old')", () => {
  assertEqual(PROVINCES[54].reform, "old", "西藏(54) reform regime");
});

test("西藏 carries no reform_warning (老高考, not a 2024/2025 new-reform province)", () => {
  assertEqual(flaggedReformYear(54), null, "西藏(54) must not be flagged as new-reform");
});

// ── inferTrack: 3+3 (综合改革) ──────────────────────────────────────────────
test("inferTrack returns '3' (综合改革) for 3+3 provinces regardless of subjects", () => {
  assertEqual(inferTrack(11 as ProvinceId, ["物理", "化学", "生物"]), "3", "北京 3+3");
  assertEqual(inferTrack(37 as ProvinceId, ["历史", "政治", "地理"]), "3", "山东 3+3");
  assertEqual(inferTrack(31 as ProvinceId, []), "3", "上海 3+3 (no subjects still 综合)");
});

// ── inferTrack: 3+1+2 (物理类 / 历史类) ──────────────────────────────────────
test("inferTrack returns 物理类/历史类 codes for 3+1+2 provinces", () => {
  // 物理 first-choice → 2073 物理类; 历史 first-choice → 2074 历史类.
  assertEqual(inferTrack(43 as ProvinceId, ["物理", "化学", "生物"]), "2073", "湖南 物理类");
  assertEqual(inferTrack(43 as ProvinceId, ["历史", "政治", "地理"]), "2074", "湖南 历史类");
  assertEqual(inferTrack(13 as ProvinceId, ["物理", "化学", "政治"]), "2073", "河北 物理类");
  assertEqual(inferTrack(13 as ProvinceId, ["历史", "地理", "生物"]), "2074", "河北 历史类");
});

test("inferTrack throws for 3+1+2 when neither 物理 nor 历史 is chosen", () => {
  let threw = false;
  try {
    inferTrack(43 as ProvinceId, ["化学", "生物", "政治"]);
  } catch {
    threw = true;
  }
  assert(threw, "3+1+2 with no first-choice subject must throw");
});

// ── inferTrack: old-reform 文/理 (西藏) ──────────────────────────────────────
// A 老高考 candidate sits 文综 OR 理综 as a fixed bundle: 物理 ⇒ 理科 ("1"),
// 历史 ⇒ 文科 ("2"). With neither present it falls back to a sci/lib majority.
test("inferTrack maps old-reform 物理 → 理工 '1' and 历史 → 文史 '2'", () => {
  assertEqual(inferTrack(54 as ProvinceId, ["物理", "化学", "生物"]), "1", "西藏 理科");
  assertEqual(inferTrack(54 as ProvinceId, ["历史", "政治", "地理"]), "2", "西藏 文科");
});

test("inferTrack old-reform fallback uses sci/lib majority when no 物理/历史", () => {
  assertEqual(inferTrack(54 as ProvinceId, ["化学", "生物"]), "1", "sci majority → 理");
  assertEqual(inferTrack(54 as ProvinceId, ["政治", "地理"]), "2", "lib majority → 文");
  // tie (sciCount === libCount) resolves to 文 ("2") per `sciCount >= libCount ? "1" : "2"`
  assertEqual(inferTrack(54 as ProvinceId, ["化学", "政治"]), "1", "tie → 理 ('1', sci>=lib)");
});

// ── inferDefaultTrack (rank-table.ts): file-name track keys ─────────────────
// Distinct vocabulary from inferTrack: rank-table file keys are words, not the
// gaokao.cn numeric codes. 3+3 → "combined", 3+1+2 → "physics", old → "science".
test("inferDefaultTrack returns rank-table file keys per reform regime", () => {
  assertEqual(inferDefaultTrack(11 as ProvinceId), "combined", "北京 3+3 → combined");
  assertEqual(inferDefaultTrack(43 as ProvinceId), "physics", "湖南 3+1+2 → physics");
  assertEqual(inferDefaultTrack(54 as ProvinceId), "science", "西藏 老高考 → science");
});

// ── Track-string vocabulary consistency ─────────────────────────────────────
// inferTrack must only ever emit the gaokao.cn numeric/code vocabulary
// (1/2/3/2073/2074) and never mix in the rank-table word vocabulary
// (combined/physics/science) — those live exclusively in inferDefaultTrack.
test("inferTrack emits only the numeric code vocabulary across all regimes", () => {
  const numericCodes = new Set(["1", "2", "3", "2073", "2074"]);
  const wordKeys = new Set(["combined", "physics", "history", "science", "liberal"]);
  // one representative subject set per province (skips 3+1+2 throw case)
  for (const idStr of Object.keys(PROVINCES)) {
    const id = Number(idStr) as ProvinceId;
    // 港澳台 (71/81/82) — reform="special", throws by design (用 qatw verb 走特殊招生通道)
    if (PROVINCES[id].reform === "special") continue;
    const subjects = PROVINCES[id].reform === "3+1+2"
      ? (["物理", "化学", "生物"] as const)
      : (["物理", "化学", "生物"] as const);
    const t = inferTrack(id, [...subjects]);
    assert(numericCodes.has(t), `${PROVINCES[id].name}: inferTrack returned non-code "${t}"`);
    assert(!wordKeys.has(t), `${PROVINCES[id].name}: inferTrack leaked rank-table word "${t}"`);
  }
});

test("inferTrack throws for 港澳台 (71/81/82) special-region provinces", () => {
  for (const id of [71, 81, 82] as const) {
    let threw = false;
    try {
      inferTrack(id, ["物理", "化学", "生物"]);
    } catch (e) {
      threw = true;
      const msg = e instanceof Error ? e.message : String(e);
      assert(msg.includes("qatw"), `port-au-tai throw must mention qatw verb, got: ${msg}`);
    }
    assert(threw, `inferTrack(${id}) should throw for 港澳台 special region`);
  }
});

test("inferDefaultTrack emits only the word vocabulary, never numeric codes", () => {
  const wordKeys = new Set(["combined", "physics", "science"]);
  for (const idStr of Object.keys(PROVINCES)) {
    const id = Number(idStr) as ProvinceId;
    // 港澳台 special — inferDefaultTrack should return a sensible default ("combined")
    // since 港澳台 联招 uses 文科/理科 split similar to 老高考
    if (PROVINCES[id].reform === "special") continue;
    const t = inferDefaultTrack(id);
    assert(wordKeys.has(t), `${PROVINCES[id].name}: inferDefaultTrack returned "${t}"`);
  }
});
