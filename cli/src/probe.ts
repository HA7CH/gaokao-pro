// Probe static-data.gaokao.cn to map gaokao.cn school_id → 教育部 zs_code (5-digit).
// Walks ids in a range and writes a JSON index to docs/school-index.json.
// Run with: pnpm probe -- --start 1 --end 100
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchoolInfo } from "./gaokao-cn.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");

function parseRange(): { start: number; end: number; concurrency: number } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? Number(args[idx + 1]) : fallback;
  };
  return {
    start: get("--start", 1),
    end: get("--end", 50),
    concurrency: get("--concurrency", 5)
  };
}

type IndexRow = {
  gaokao_cn_id: number;
  zs_code: string;
  name: string;
  province: string;
  city: string;
  level: string;
  f985: boolean;
  f211: boolean;
  dual_class: string;
};

async function probeOne(id: number): Promise<IndexRow | null> {
  try {
    const info = await getSchoolInfo(id);
    return {
      gaokao_cn_id: Number(info.school_id),
      zs_code: info.zs_code,
      name: info.name,
      province: info.province_name,
      city: info.city_name,
      level: info.level_name,
      f985: info.f985 === "1",
      f211: info.f211 === "1",
      dual_class: info.dual_class_name
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  const { start, end, concurrency } = parseRange();
  process.stderr.write(`probing school_ids [${start}..${end}] with concurrency ${concurrency}\n`);

  const rows: IndexRow[] = [];
  let cursor = start;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor <= end) {
      const id = cursor++;
      const row = await probeOne(id);
      if (row) {
        rows.push(row);
        process.stderr.write(`  ${id.toString().padStart(5)} → ${row.zs_code} ${row.name}\n`);
      }
    }
  });
  await Promise.all(workers);

  rows.sort((a, b) => a.gaokao_cn_id - b.gaokao_cn_id);
  const outPath = resolve(REPO_ROOT, "docs", "school-index.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));
  process.stderr.write(`\nwrote ${rows.length} schools → ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
