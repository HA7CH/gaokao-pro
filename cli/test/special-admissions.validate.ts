// Strict schema validator for all 18 special-admissions JSON files.
// Catches agent-introduced bugs: invalid region_ids, missing required fields,
// wrong enum values, year mismatch, etc.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVINCES } from "../src/codes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, "..", "data", "datasets", "special-admissions");

const VALID_REGION_IDS = new Set(Object.keys(PROVINCES).map((k) => Number(k)));

const VALID_ART_CATEGORIES = new Set([
  "美术与设计",
  "音乐表演-声乐",
  "音乐表演-器乐",
  "音乐教育-声乐",
  "音乐教育-器乐",
  "舞蹈",
  "戏剧影视表演",
  "戏剧影视导演",
  "服装表演",
  "播音与主持",
  "书法",
  "戏曲"
]);

const VALID_SPORTS_KINDS = new Set([
  "weighted",
  "additive",
  "professional_first",
  "gaokao_only",
  "merged_specline"
]);

const VALID_QATW_CHANNELS = new Set([
  "全国联招",
  "居住证高考",
  "保送生",
  "DSE互认",
  "港校招内地生",
  "澳校招内地生",
  "学测申请陆校",
  "陆生申请台校"
]);

const VALID_REFORM = new Set(["old", "3+3", "3+1+2", "special"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

interface Issue {
  file: string;
  index: number;
  field: string;
  problem: string;
}

const issues: Issue[] = [];

function report(file: string, index: number, field: string, problem: string) {
  issues.push({ file, index, field, problem });
}

function validateCommon(
  file: string,
  index: number,
  r: Record<string, unknown>,
  expectedYear: number
) {
  if (!VALID_REGION_IDS.has(Number(r.region_id))) {
    report(file, index, "region_id", `${r.region_id} not in 34 regions`);
  }
  if (Number(r.year) !== expectedYear) {
    report(file, index, "year", `record year ${r.year} ≠ filename year ${expectedYear}`);
  }
  if (!Array.isArray(r.data_source)) {
    report(file, index, "data_source", `not array (${typeof r.data_source})`);
  }
  if (!VALID_CONFIDENCE.has(r.confidence as string)) {
    report(file, index, "confidence", `'${r.confidence}' not in high/medium/low`);
  }
}

function validateArt(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    validateCommon(file, i, r, year);
    if (!VALID_ART_CATEGORIES.has(r.category as string)) {
      report(file, i, "category", `'${r.category}' not in 12-enum`);
    }
    if (r.reform !== undefined && !VALID_REFORM.has(r.reform as string)) {
      report(file, i, "reform", `'${r.reform}' invalid`);
    }
    if (r.formula !== null && r.formula !== undefined) {
      const f = r.formula as Record<string, unknown>;
      if (typeof f.culture_pct !== "number") report(file, i, "formula.culture_pct", "not number");
      if (typeof f.pro_factor !== "number") report(file, i, "formula.pro_factor", "not number");
      if (typeof f.pro_pct !== "number") report(file, i, "formula.pro_pct", "not number");
    }
  });
}

function validateSports(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    validateCommon(file, i, r, year);
    if (!VALID_SPORTS_KINDS.has(r.kind as string)) {
      report(file, i, "kind", `'${r.kind}' not in 5-enum`);
    }
    if (r.kind === "weighted" && (r.formula === null || r.formula === undefined)) {
      report(file, i, "formula", "weighted kind requires formula");
    }
    // 港澳台 (71/81/82) should not appear
    const rid = Number(r.region_id);
    if (rid === 71 || rid === 81 || rid === 82) {
      report(file, i, "region_id", `${rid} 港澳台 should be skipped for sports`);
    }
  });
}

function validateQiangji(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    if (!r.school || typeof r.school !== "object") {
      report(file, i, "school", "missing/not object");
      return;
    }
    validateCommon(file, i, r, year);
    const rid = Number(r.region_id);
    if (rid === 71 || rid === 81 || rid === 82) {
      report(file, i, "region_id", `${rid} 港澳台 not applicable`);
    }
    if (r.ruwei_ratio !== undefined && r.ruwei_ratio !== "all" && typeof r.ruwei_ratio !== "number") {
      report(file, i, "ruwei_ratio", `'${r.ruwei_ratio}' must be number or 'all'`);
    }
    if (r.west_75pct_threshold === true) {
      if (![62, 63, 64, 65].includes(rid)) {
        report(file, i, "west_75pct_threshold", `true but region ${rid} not in 甘青宁新`);
      }
    }
  });
}

function validateZongPing(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    if (!r.school || typeof r.school !== "object") {
      report(file, i, "school", "missing/not object");
      return;
    }
    validateCommon(file, i, r, year);
    const school = r.school as Record<string, unknown>;
    if (typeof school.is_local !== "boolean") {
      report(file, i, "school.is_local", "must be boolean");
    }
  });
}

function validateMinzu(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    validateCommon(file, i, r, year);
    if (!Array.isArray(r.bonus_tiers)) {
      report(file, i, "bonus_tiers", "not array");
      return;
    }
    (r.bonus_tiers as unknown[]).forEach((t, ti) => {
      const tier = t as Record<string, unknown>;
      if (typeof tier.scope !== "string") {
        report(file, i, `bonus_tiers[${ti}].scope`, "missing/wrong");
      }
      if (tier.bonus !== null && typeof tier.bonus !== "number") {
        report(file, i, `bonus_tiers[${ti}].bonus`, `not number or null: ${typeof tier.bonus}`);
      }
    });
  });
}

function validateQATW(file: string, year: number, records: unknown[]) {
  records.forEach((rec, i) => {
    const r = rec as Record<string, unknown>;
    validateCommon(file, i, r, year);
    const rid = Number(r.region_id);
    if (rid !== 71 && rid !== 81 && rid !== 82) {
      report(file, i, "region_id", `${rid} qatw only supports 71/81/82`);
    }
    if (!VALID_QATW_CHANNELS.has(r.channel as string)) {
      report(file, i, "channel", `'${r.channel}' not in 8-enum`);
    }
    // 台湾居住证 should not exist
    if (rid === 71 && r.channel === "居住证高考") {
      report(file, i, "channel", "台胞居住证不能凭单独参加普通高考 — should be removed");
    }
    // DSE only HK
    if (r.channel === "DSE互认" && rid !== 81) {
      report(file, i, "channel", `DSE互认 only applies to HK 81, got region ${rid}`);
    }
    // 保送生 only Macau
    if (r.channel === "保送生" && rid !== 82) {
      report(file, i, "channel", `保送生 only applies to Macau 82, got region ${rid}`);
    }
    // 学测/陆生 only Taiwan
    if ((r.channel === "学测申请陆校" || r.channel === "陆生申请台校") && rid !== 71) {
      report(file, i, "channel", `${r.channel} only applies to Taiwan 71, got region ${rid}`);
    }
  });
}

function validateFile(category: string, year: number) {
  const path = resolve(DATA_DIR, `${category}-${year}.json`);
  if (!existsSync(path)) {
    console.log(`  MISSING: ${category}-${year}.json`);
    return;
  }
  const raw = readFileSync(path, "utf8");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    report(path, -1, "parse", String(e));
    return;
  }
  if (parsed.year !== year) report(path, -1, "top.year", `${parsed.year} ≠ ${year}`);
  if (parsed.category !== category)
    report(path, -1, "top.category", `${parsed.category} ≠ ${category}`);
  if (!Array.isArray(parsed.records))
    report(path, -1, "records", `not array (${typeof parsed.records})`);

  const records = parsed.records ?? [];
  const fileName = `${category}-${year}.json`;
  switch (category) {
    case "art-formula":
      validateArt(fileName, year, records);
      break;
    case "sports-formula":
      validateSports(fileName, year, records);
      break;
    case "qiangji-quota":
      validateQiangji(fileName, year, records);
      break;
    case "zongping":
      validateZongPing(fileName, year, records);
      break;
    case "minzu-policy":
      validateMinzu(fileName, year, records);
      break;
    case "qatw-channel":
      validateQATW(fileName, year, records);
      break;
  }
  console.log(`  ${fileName}: ${records.length} records`);
}

function main() {
  console.log("special-admissions schema validator");
  console.log(`  Looking in: ${DATA_DIR}\n`);

  if (!existsSync(DATA_DIR)) {
    console.error(`FATAL: dataset directory missing: ${DATA_DIR}`);
    process.exit(2);
  }

  const present = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
  console.log(`  Found ${present.length} JSON files\n`);

  const categories = [
    "art-formula",
    "sports-formula",
    "qiangji-quota",
    "zongping",
    "minzu-policy",
    "qatw-channel"
  ];
  for (const c of categories) {
    for (const y of [2023, 2024, 2025]) {
      validateFile(c, y);
    }
  }

  console.log(`\n${issues.length === 0 ? "✅ ALL FILES VALID" : `❌ ${issues.length} ISSUES`}`);

  if (issues.length > 0) {
    // Group by file
    const byFile: Record<string, Issue[]> = {};
    for (const i of issues) {
      (byFile[i.file] ??= []).push(i);
    }
    for (const [file, list] of Object.entries(byFile)) {
      console.log(`\n${file}: ${list.length} issues`);
      const sample = list.slice(0, 5);
      for (const i of sample) {
        console.log(`  [${i.index}] ${i.field}: ${i.problem}`);
      }
      if (list.length > 5) console.log(`  ... and ${list.length - 5} more`);
    }
    process.exit(1);
  }
}

main();
