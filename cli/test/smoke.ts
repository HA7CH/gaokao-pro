// Smoke test — hits the live static-data.gaokao.cn API.
// Fails fast if the upstream contract changes.
import { getSchoolInfo, getAdmissionPlan, extractHistoricalScores } from "../src/gaokao-cn.js";

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
}

main();
