#!/usr/bin/env tsx
// Bulk-pull 2026 vs 2025 分省分专业招生计划 for the 985/211/双一流 head schools,
// computing per (school × province) headcount deltas + per-major (spcode) changes.
//
// Source: static-data.gaokao.cn via the repo's own client (getAdmissionPlan).
// Resumable: appends one JSON line per school to a .jsonl checkpoint; a re-run
// skips schools already in the checkpoint and otherwise hits the client's disk cache.
//
// Usage:
//   tsx scripts/pull-zhaosheng-jihua-2026.ts --limit 3                 # pilot
//   tsx scripts/pull-zhaosheng-jihua-2026.ts --all --out data/datasets/zhaosheng-jihua-2026.json
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { loadIndex } from "../src/index-loader.ts";
import { getAdmissionPlan } from "../src/gaokao-cn.ts";

const PROVINCES: Record<number, string> = {
  11: "北京", 12: "天津", 13: "河北", 14: "山西", 15: "内蒙古",
  21: "辽宁", 22: "吉林", 23: "黑龙江",
  31: "上海", 32: "江苏", 33: "浙江", 34: "安徽", 35: "福建", 36: "江西", 37: "山东",
  41: "河南", 42: "湖北", 43: "湖南", 44: "广东", 45: "广西", 46: "海南",
  50: "重庆", 51: "四川", 52: "贵州", 53: "云南", 54: "西藏",
  61: "陕西", 62: "甘肃", 63: "青海", 64: "宁夏", 65: "新疆",
};
const PROV_IDS = Object.keys(PROVINCES).map(Number);

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "/private/tmp/zhaosheng-jihua-2026.json";
const CKPT = OUT.replace(/\.json$/, "") + ".jsonl";
const CONCURRENCY = 8;

const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// per (school, province): pull both years, return totals + per-spcode num maps.
async function pullProvince(schoolId: number, provId: number) {
  const isPutong = (it: any) => (it.zslx_name || "").trim() === "普通类" || (it.zslx_name || "") === "" || it.zslx === "-";
  const grab = async (year: number) => {
    try {
      const items = await getAdmissionPlan(schoolId, year, provId);
      // byMajor restricted to 普通类 (the only batch comparable across years right now)
      const byMajor: Record<string, { name: string; num: number }> = {};
      const byZslx: Record<string, number> = {};
      let total = 0, putong = 0;
      for (const it of items as any[]) {
        const c = num(it.num);
        total += c;
        const z = (it.zslx_name || it.zslx || "其他").trim() || "其他";
        byZslx[z] = (byZslx[z] || 0) + c;
        if (isPutong(it)) {
          putong += c;
          // stable major identity (spcode, else name); NOT special_group (reassigned yearly)
          const key = it.spcode || it.sp_name || it.spname || "?";
          if (!byMajor[key]) byMajor[key] = { name: it.sp_name || it.spname || it.spcode || "?", num: 0 };
          byMajor[key].num += c;
        }
      }
      return { total, putong, byMajor, byZslx, present: items.length > 0 };
    } catch {
      return { total: 0, putong: 0, byMajor: {} as Record<string, any>, byZslx: {} as Record<string, number>, present: false, error: true as const };
    }
  };
  const y26 = await grab(2026);
  const y25 = await grab(2025);
  // per-major diff — 普通类 only (apples-to-apples; special types are 2026-incomplete)
  const keys = new Set([...Object.keys(y26.byMajor), ...Object.keys(y25.byMajor)]);
  let added = 0, cut = 0;
  const majorDeltas: Array<{ name: string; n26: number; n25: number; d: number }> = [];
  for (const k of keys) {
    const n26 = y26.byMajor[k]?.num ?? 0;
    const n25 = y25.byMajor[k]?.num ?? 0;
    if (n26 > 0 && n25 === 0) added += n26;
    if (n26 === 0 && n25 > 0) cut += n25;
    if (n26 !== n25) majorDeltas.push({ name: (y26.byMajor[k] || y25.byMajor[k]).name, n26, n25, d: n26 - n25 });
  }
  majorDeltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  // 2026 special-batch (非普通类) not yet published when 2025 had it → flag
  const special_2026_pending = (y25.total - y25.putong) > 0 && (y26.total - y26.putong) === 0;
  return {
    prov: provId, name: PROVINCES[provId],
    putong_2026: y26.present ? y26.putong : null,
    putong_2025: y25.present ? y25.putong : null,
    delta_putong: (y26.present || y25.present) ? y26.putong - y25.putong : null,
    total_2026: y26.present ? y26.total : null,
    total_2025: y25.present ? y25.total : null,
    special_2026_pending,
    zslx_2026: y26.byZslx, zslx_2025: y25.byZslx,
    new_majors_seats: added, cut_majors_seats: cut,
    top_major_changes: majorDeltas.slice(0, 6),
  };
}

async function main() {
  const idx = loadIndex();
  const targets = idx.rows
    .filter((r: any) => r.f985 || r.f211 || String(r.dual_class || "").includes("双一流"))
    .map((r: any) => ({ id: r.gaokao_cn_id, name: r.name, zs_code: r.zs_code, f985: !!r.f985, f211: !!r.f211, dual_class: r.dual_class }))
    .filter((s: any) => s.id != null)
    .sort((a: any, b: any) => (b.f985 ? 1 : 0) - (a.f985 ? 1 : 0)); // 985 first

  const done = new Set<number>();
  if (existsSync(CKPT)) {
    for (const line of readFileSync(CKPT, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).id); } catch {}
    }
  }
  const todo = targets.filter((s: any) => !done.has(s.id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.error(`targets=${targets.length} done=${done.size} todo=${todo.length} provinces=${PROV_IDS.length}`);

  let completed = 0;
  for (const school of todo) {
    const provs = await pool(PROV_IDS, CONCURRENCY, (pid) => pullProvince(Number(school.id), pid));
    const sum = (k: string) => provs.reduce((s, p: any) => s + (p[k] ?? 0), 0);
    const putong_2026 = sum("putong_2026"), putong_2025 = sum("putong_2025");
    const total_2026 = sum("total_2026"), total_2025 = sum("total_2025");
    const provinces_special_pending = provs.filter((p: any) => p.special_2026_pending).length;
    const rec = {
      ...school,
      putong_2026, putong_2025, delta_putong: putong_2026 - putong_2025,
      total_2026, total_2025, delta_total: total_2026 - total_2025,
      provinces_special_pending,
      by_province: provs.filter((p: any) => p.putong_2026 != null || p.putong_2025 != null),
    };
    appendFileSync(CKPT, JSON.stringify(rec) + "\n");
    completed++;
    console.error(`[${completed}/${todo.length}] ${school.name}: 普通类 2026=${putong_2026} 2025=${putong_2025} Δ=${putong_2026 - putong_2025} | total Δ=${total_2026 - total_2025}${provinces_special_pending ? ` (特殊类型2026待发:${provinces_special_pending}省)` : ""}`);
  }

  // assemble final dataset from checkpoint
  const schools = readFileSync(CKPT, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const pendingSchools = schools.filter((s) => s.provinces_special_pending > 0).length;
  const out = {
    _meta: {
      description: "2026 vs 2025 分省分专业招生计划（985/211/双一流 头部院校）— 来源 static-data.gaokao.cn(掌上高考)。",
      source: "static-data.gaokao.cn /schoolspecialplan/{schoolId}/{year}/{provinceId}.json",
      school_universe: "985 ∪ 211 ∪ 双一流（school-index.json.gz 过滤）",
      year_pair: [2026, 2025],
      school_count: schools.length,
      headline_metric: "delta_putong = 普通类计划人数 2026-2025（apples-to-apples，两年都已发布）",
      caveat: `出分季(6/26)抓取：gaokao.cn 2026 普通类计划已发布，但 提前批/综合评价/国家公费师范生/高校专项/国家专项/中外合作 等特殊类型 2026 计划多数尚未上线。故 total_2026 偏低、delta_total 仅供参考（不代表真实缩招）；以 delta_putong 为准。${pendingSchools} 所院校在 ≥1 省检测到 2026 特殊类型待发。`,
      generated_note: "stamp generated_at after run",
    },
    schools: schools.sort((a, b) => (b.delta_putong ?? 0) - (a.delta_putong ?? 0)),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.error(`WROTE ${OUT} (${schools.length} schools)`);
}
main();
