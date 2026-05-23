// Smoke test — hits the live static-data.gaokao.cn API + exercises the local index.
// Fails fast if the upstream contract changes or the index goes stale.
import { getSchoolInfo, getAdmissionPlan, getAdmissionScores, extractHistoricalScores } from "../src/gaokao-cn.js";
import { recommend } from "../src/recommend.js";
import { top } from "../src/top.js";
import { loadIndex } from "../src/index-loader.js";
import { formatRecommend } from "../src/format.js";
import { listRankTables, loadRankTable, scoreToRank, rankToScore } from "../src/rank-table.js";

async function expect(name: string, fn: () => Promise<void>) {
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
  process.stdout.write("gaokao-pro smoke\n");

  await expect("school 31 (北大) info loads", async () => {
    const info = await getSchoolInfo(31);
    if (info.name !== "北京大学") throw new Error(`expected 北京大学, got ${info.name}`);
    if (info.zs_code !== "10001") throw new Error(`expected zs_code 10001, got ${info.zs_code}`);
    if (info.f985 !== "1" || info.f211 !== "1") throw new Error("expected 985/211");
  });

  await expect("school 31 historical scores include 河南 (41)", async () => {
    const info = await getSchoolInfo(31);
    const series = extractHistoricalScores(info, 41);
    if (series.length === 0) throw new Error("no 河南 scores returned");
    const years = new Set(series.map((s) => s.year));
    if (!years.has(2024)) throw new Error("missing 2024 datapoint");
  });

  await expect("plan 31 / 2024 / 河南 returns ≥1 spcode", async () => {
    const items = await getAdmissionPlan(31, 2024, 41);
    if (items.length === 0) throw new Error("empty plan");
    const hasSpcode = items.some((it) => /^\d{6}[A-Z]?$/.test(it.spcode));
    if (!hasSpcode) throw new Error("no valid 专业代码 found");
  });

  await expect("local index loads with ≥1000 schools", async () => {
    const idx = loadIndex();
    if (idx.rows.length < 1000) {
      throw new Error(`expected ≥1000 schools in index, got ${idx.rows.length}`);
    }
  });

  await expect("recommend 660 / 河南 / 物化生 / 985 buckets non-empty", async () => {
    const out = recommend({
      score: 660,
      provinceId: 41,
      subjects: ["物理", "化学", "生物"],
      filter: { f985: true }
    });
    const total = out.buckets["冲"].length + out.buckets["稳"].length + out.buckets["保"].length;
    if (total === 0) throw new Error("expected at least one school across 冲/稳/保");
    if (out.query.track !== "2073") throw new Error(`expected track 2073, got ${out.query.track}`);
  });

  await expect("top 650 / 河南 / 物理 / 985 yields ≥5 schools", async () => {
    const out = top({
      score: 650,
      provinceId: 41,
      subjects: ["物理"],
      limit: 10,
      filter: { f985: true }
    });
    if (out.rows.length < 5) throw new Error(`expected ≥5 rows, got ${out.rows.length}`);
    // Ranked descending by baseline.
    for (let i = 1; i < out.rows.length; i++) {
      if (out.rows[i].baselineMinScore > out.rows[i - 1].baselineMinScore) {
        throw new Error("rows not sorted by baseline desc");
      }
    }
  });

  await expect("formatRecommend renders 冲/稳/保 sections", async () => {
    const out = recommend({
      score: 660,
      provinceId: 41,
      subjects: ["物理", "化学", "生物"],
      filter: { f985: true },
      limit: 3
    });
    const txt = formatRecommend(out);
    if (!txt.includes("REACH") || !txt.includes("MATCH") || !txt.includes("SAFETY")) {
      throw new Error("missing bucket headers");
    }
  });

  await expect("actual 31 / 2024 / 广东 returns min_section for 新高考 entries", async () => {
    const items = await getAdmissionScores(31, 2024, 44);
    if (items.length === 0) throw new Error("empty actual");
    const hasRank = items.some((it) => it.min_section && it.min_section !== "-");
    if (!hasRank) throw new Error("no min_section/位次 found");
  });

  await expect("rank-tables ingested includes beijing 2024", () => {
    const tables = listRankTables();
    const has = tables.some((t) => t.province === "beijing" && t.year === 2024);
    if (!has) throw new Error(`beijing 2024 missing from rank-tables (have: ${JSON.stringify(tables)})`);
  });

  await expect("beijing 2024 一分一段: 650 → rank ~3176", () => {
    const table = loadRankTable(11, 2024, "combined");
    if (!table) throw new Error("beijing 2024 table missing");
    const rank = scoreToRank(table, 650);
    if (!rank || rank < 2000 || rank > 5000) {
      throw new Error(`expected rank in [2000, 5000] for score 650, got ${rank}`);
    }
    const score = rankToScore(table, 10000);
    if (!score || score < 580 || score > 630) {
      throw new Error(`expected score in [580, 630] for rank 10000, got ${score}`);
    }
  });
}

main();
