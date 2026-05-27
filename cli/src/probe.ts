// Probe static-data.gaokao.cn to map gaokao.cn school_id → 教育部 zs_code (5-digit).
// Walks ids in a range and writes a JSON index to docs/school-index.json.
// Run with: pnpm probe -- --start 1 --end 100
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchoolInfo, GaokaoTimeoutError } from "./gaokao-cn.js";

const __filename = fileURLToPath(import.meta.url);
// cli/src/probe.ts → repo root is two levels up, cli/data is one level up.
const CLI_ROOT = resolve(dirname(__filename), "..");

function parseRange(): { start: number; end: number; concurrency: number } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? Number(args[idx + 1]) : fallback;
  };
  return {
    start: get("--start", 1),
    end: get("--end", 3000),
    concurrency: get("--concurrency", 25)
  };
}

type IndexRow = {
  gaokao_cn_id: number;
  zs_code: string;
  name: string;
  province: string;
  city: string;
  level: string;
  type: string;          // 综合类 / 理工类 / 师范类 / ...
  nature: string;        // 公办 / 民办 / 中外合作办学
  belong: string;        // 教育部 / 工信部 / 省属 / ...
  f985: boolean;
  f211: boolean;
  dual_class: string;
  // Score corpus — `pro_type_min` from info.json verbatim. Keyed by
  // province_id; entries are { year, type: { trackCode: minScore } }.
  // Letting recommend read this without re-hitting the network.
  pro_type_min: Record<string, Array<{ year: number; type: Record<string, string> }>>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `row` = found; `null` = deterministic miss (e.g. 404, no such id);
// transient:true = timeout / network blip → signal to back off.
type ProbeResult = { row: IndexRow | null; transient: boolean };

async function probeOne(id: number): Promise<ProbeResult> {
  try {
    const info = await getSchoolInfo(id);
    return {
      transient: false,
      row: {
        gaokao_cn_id: Number(info.school_id),
        zs_code: info.zs_code,
        name: info.name,
        province: info.province_name,
        city: info.city_name,
        level: info.level_name,
        type: info.type_name,
        nature: info.nature_name,
        belong: info.belong,
        f985: info.f985 === "1",
        f211: info.f211 === "1",
        dual_class: info.dual_class_name,
        pro_type_min: info.pro_type_min ?? {}
      }
    };
  } catch (e) {
    // A 404 (or other deterministic miss) is normal when walking an id range —
    // don't treat it as a rate-limit signal. Only timeouts / network errors do.
    const transient =
      e instanceof GaokaoTimeoutError ||
      (e instanceof Error && !/\b4\d\d\b/.test(e.message));
    return { row: null, transient };
  }
}

async function main() {
  const { start, end, concurrency } = parseRange();
  process.stderr.write(`probing school_ids [${start}..${end}] with concurrency ${concurrency}\n`);

  const rows: IndexRow[] = [];
  let cursor = start;
  // Shared adaptive cooldown: when requests start failing (likely upstream
  // rate-limiting), every worker waits a bit before its next id so we back off
  // instead of hammering. Stays at 0 on a healthy run, so the default path is fast.
  let cooldownMs = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    // Light per-worker startup jitter so 25 workers don't fire in lockstep.
    await sleep(Math.floor(Math.random() * 100));
    while (cursor <= end) {
      const id = cursor++;
      if (cooldownMs > 0) {
        // Backoff + jitter so workers don't resynchronize after a stall.
        await sleep(cooldownMs + Math.floor(Math.random() * 100));
      }
      const { row, transient } = await probeOne(id);
      if (row) {
        // Success: relax the cooldown back toward zero.
        cooldownMs = Math.max(0, cooldownMs - 100);
        rows.push(row);
        process.stderr.write(`  ${id.toString().padStart(5)} → ${row.zs_code} ${row.name}\n`);
      } else if (transient) {
        // Timeout / network blip (possible rate-limiting): ramp cooldown, cap 2s.
        cooldownMs = Math.min(2000, cooldownMs + 200);
      }
      // Plain 404 miss: leave cooldown untouched (a sparse range stays fast).
    }
  });
  await Promise.all(workers);

  rows.sort((a, b) => a.gaokao_cn_id - b.gaokao_cn_id);
  const payload = JSON.stringify({ generated_at: new Date().toISOString(), rows });
  const outPath = resolve(CLI_ROOT, "data", "school-index.json.gz");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, gzipSync(Buffer.from(payload, "utf8")));
  process.stderr.write(`\nwrote ${rows.length} schools → ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
