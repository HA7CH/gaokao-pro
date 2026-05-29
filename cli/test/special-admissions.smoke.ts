// Smoke tests for special-admissions module — offline-only, exercises JSON loaders.
// Tests assume datasets are populated; partial coverage is OK (test asserts
// presence of key high-confidence records, not exhaustive coverage).

import {
  listArtFormulasForRegion,
  findSportsFormula,
  listQiangjiForRegion,
  listZongPingForRegion,
  findMinzuPolicy,
  findQATWChannel,
  listQATWForRegion,
  coverageReport
} from "../src/special-admissions.js";

async function expect(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    process.stdout.write(`  ok  ${name}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  FAIL ${name}: ${msg}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  process.stdout.write("gaokao-pro special-admissions smoke\n");

  // ── Coverage report ──
  await expect("coverage report runs without error", () => {
    const stats = coverageReport();
    if (stats.length !== 6 * 3) throw new Error(`expected 18 stats rows, got ${stats.length}`);
  });

  // ── Sports formula ──
  await expect("sports-tongzhao 湖北 2025 has 1.25 系数", () => {
    const r = findSportsFormula(42, 2025);
    if (!r) throw new Error("湖北 2025 sports record missing");
    if (r.kind !== "weighted") throw new Error(`expected weighted, got ${r.kind}`);
    const factor = (r.formula?.culture_pct ?? 0) + (r.formula?.pro_factor ?? 0) * (r.formula?.pro_pct ?? 0);
    // 0.5 + 1 × 0.75 = 1.25 总系数
    if (Math.abs(factor - 1.25) > 0.01) throw new Error(`expected total factor 1.25, got ${factor}`);
  });

  await expect("sports-tongzhao 湖南 2025 is additive", () => {
    const r = findSportsFormula(43, 2025);
    if (!r) throw new Error("湖南 2025 sports record missing");
    if (r.kind !== "additive") throw new Error(`expected additive, got ${r.kind}`);
  });

  await expect("sports-tongzhao 陕西 2025 is professional_first", () => {
    const r = findSportsFormula(61, 2025);
    if (!r) throw new Error("陕西 2025 sports record missing");
    if (r.kind !== "professional_first") throw new Error(`expected professional_first, got ${r.kind}`);
  });

  await expect("sports-tongzhao 海南 2025 is gaokao_only", () => {
    const r = findSportsFormula(46, 2025);
    if (!r) throw new Error("海南 2025 sports record missing");
    if (r.kind !== "gaokao_only") throw new Error(`expected gaokao_only, got ${r.kind}`);
  });

  await expect("sports-tongzhao 重庆 2025 is merged_specline", () => {
    const r = findSportsFormula(50, 2025);
    if (!r) throw new Error("重庆 2025 sports record missing");
    if (r.kind !== "merged_specline") throw new Error(`expected merged_specline, got ${r.kind}`);
  });

  // ── QATW channels ──
  await expect("qatw 香港 2025 全国联招 has 2025 暴涨 line", () => {
    const r = findQATWChannel(81, "全国联招", 2025);
    if (!r) throw new Error("香港 2025 全国联招 missing");
    const benke = r.control_lines?.find((cl) => cl.batch === "本科普通");
    if (!benke) throw new Error("本科普通 line missing");
    if (benke.wen !== 430 || benke.li !== 460) {
      throw new Error(`expected 2025 联招 本科普通 文 430 理 460, got ${benke.wen}/${benke.li}`);
    }
  });

  await expect("qatw 香港 2025 lists 4 channels", () => {
    const list = listQATWForRegion(81, 2025);
    if (list.length !== 4) throw new Error(`expected 4 HK channels, got ${list.length}`);
  });

  await expect("qatw 澳门 2025 includes 保送生", () => {
    const r = findQATWChannel(82, "保送生", 2025);
    if (!r) throw new Error("澳门 2025 保送生 missing");
  });

  await expect("qatw 台湾 2025 includes 学测申请陆校 with 451 schools", () => {
    const r = findQATWChannel(71, "学测申请陆校", 2025);
    if (!r) throw new Error("台湾 2025 学测 missing");
    // notes or schools[] should reference 451 大陆校
    const ns = (r.notes ?? "") + JSON.stringify(r.schools ?? []);
    if (!ns.includes("451")) throw new Error("expected 451 mainland universities reference");
  });

  await expect("qatw 台湾 2025 陆生申请台校 is suspended", () => {
    const r = findQATWChannel(71, "陆生申请台校", 2025);
    if (!r) throw new Error("台湾 2025 陆生申请台校 missing");
    if (r.status !== "suspended_since_2020") {
      throw new Error(`expected suspended_since_2020, got ${r.status}`);
    }
  });

  // ── Art formula (best-effort; may be empty until art-scribe agent completes) ──
  await expect("art-tongkao loaders return arrays (may be empty)", () => {
    const list = listArtFormulasForRegion(11, 2025);
    if (!Array.isArray(list)) throw new Error("expected array");
  });

  // ── Qiangji (best-effort) ──
  await expect("qiangji-line loaders return arrays (may be empty)", () => {
    const list = listQiangjiForRegion(11, 2025);
    if (!Array.isArray(list)) throw new Error("expected array");
  });

  // ── Zongping (best-effort) ──
  await expect("zonghe loaders return arrays (may be empty)", () => {
    const list = listZongPingForRegion(31, 2025);
    if (!Array.isArray(list)) throw new Error("expected array");
  });

  // ── Minzu (best-effort) ──
  await expect("minzu loader returns null or record without crashing", () => {
    findMinzuPolicy(54, 2025); // 西藏 known to have rich policy
  });

  process.stdout.write("\n");
  const cov = coverageReport();
  process.stdout.write("coverage:\n");
  for (const c of cov) {
    process.stdout.write(`  ${c.category} ${c.year}: ${c.record_count} records, ${c.region_coverage} regions\n`);
  }
}

main();
