#!/usr/bin/env tsx
// Bulk-pull 2026 vs 2025 分省分专业招生计划 for the 985/211/双一流 head schools,
// computing per (school × province) headcount deltas + per-major (spcode) changes.
//
// Source: 掌上高考 dynamic API (api.zjzw.cn) via the repo's own client
// (getAdmissionPlan). The old static-data.gaokao.cn schoolspecialplan objects were
// retired 2026-06 (OSS NoSuchKey for all years); see cli/src/gaokao-cn.ts.
// Resumable: appends one JSON line per school to a .jsonl checkpoint; a re-run
// skips schools already in the checkpoint and otherwise hits the client's disk cache.
// A source canary (北大×河南×2024) gates the run so a throttled/dead source can't
// stamp a phantom-empty dataset that would read as 缩招.
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
      return { total, putong, byMajor, byZslx, present: items.length > 0, errored: false };
    } catch {
      // A THROWN error means the SOURCE failed (network/timeout/relocated endpoint),
      // NOT "this school offers no plan here". Conflating the two lets a source
      // outage masquerade as 缩招/pending (the 出分季「数据没发全≠缩招」trap). Flag it
      // so main() can distinguish and abort instead of writing a phantom dataset.
      return { total: 0, putong: 0, byMajor: {} as Record<string, any>, byZslx: {} as Record<string, number>, present: false, errored: true as const };
    }
  };
  const y26 = await grab(2026);
  const y25 = await grab(2025);
  // A delta is only meaningful when BOTH years are present. An asymmetric cell —
  // one year empty, whether because 2026 isn't published yet or a throttle miss —
  // must NEVER be turned into a 缩招/扩招. Mark it incomparable; the delta is null.
  const comparable = y26.present && y25.present;
  // per-major diff — 普通类 only, and ONLY when comparable. If one year is absent,
  // every 2025 major would falsely register as 裁撤 (or every 2026 major as 新增) —
  // a phantom 缩招 in the per-province detail. Guard it the same way as delta_putong.
  let added = 0, cut = 0;
  let majorDeltas: Array<{ name: string; n26: number; n25: number; d: number }> = [];
  if (comparable) {
    const keys = new Set([...Object.keys(y26.byMajor), ...Object.keys(y25.byMajor)]);
    for (const k of keys) {
      const n26 = y26.byMajor[k]?.num ?? 0;
      const n25 = y25.byMajor[k]?.num ?? 0;
      if (n26 > 0 && n25 === 0) added += n26;
      if (n26 === 0 && n25 > 0) cut += n25;
      if (n26 !== n25) majorDeltas.push({ name: (y26.byMajor[k] || y25.byMajor[k]).name, n26, n25, d: n26 - n25 });
    }
    majorDeltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  }
  // 2026 special-batch (非普通类) not yet published when 2025 had it → flag. Requires
  // 2026 普通类 to be PRESENT — otherwise an all-empty 2026 (unpublished/throttled)
  // would be mislabeled "special pending" rather than "no 2026 data yet".
  const special_2026_pending = y26.present && (y25.total - y25.putong) > 0 && (y26.total - y26.putong) === 0;
  return {
    prov: provId, name: PROVINCES[provId],
    errored: y26.errored || y25.errored,
    comparable,
    putong_2026: y26.present ? y26.putong : null,
    putong_2025: y25.present ? y25.putong : null,
    delta_putong: comparable ? y26.putong - y25.putong : null,
    total_2026: y26.present ? y26.total : null,
    total_2025: y25.present ? y25.total : null,
    special_2026_pending,
    zslx_2026: y26.byZslx, zslx_2025: y25.byZslx,
    new_majors_seats: added, cut_majors_seats: cut,
    top_major_changes: majorDeltas.slice(0, 6),
  };
}

// Liveness/anti-throttle probe. 北大(31)×河南(41)×2024 reliably has ~50 majors;
// an empty or errored canary means the source is down or rate-limiting, so no
// "empty" result this run can be trusted. Returns true iff the source looks alive.
// MUST bypass the cache ({ noCache: true }) — otherwise a probe can be answered
// from a 24h disk entry or the memCache seeded by an earlier probe and report
// "alive" while the source is actually dark.
async function sourceCanary(when: string): Promise<boolean> {
  try {
    const items = await getAdmissionPlan(31, 2024, 41, { noCache: true });
    if (items.length > 0) { console.error(`source canary ${when}: OK (${items.length} 专业)`); return true; }
    console.error(`ABORT: source canary ${when} EMPTY (北大×河南×2024 returned 0 专业). The gaokao.cn plan source is down or rate-limiting — not pulling. Retry later, or raise GAOKAO_CN_DYNAMIC_GAP_MS to throttle harder.`);
    return false;
  } catch (e) {
    console.error(`ABORT: source canary ${when} FAILED (${e instanceof Error ? e.message : String(e)}). Not pulling.`);
    return false;
  }
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

  // Refuse to pull against a dead/throttled source. 北大(31)×河南(41)×2024 has ~50
  // majors every year; if the canary comes back empty or errors, the source is down
  // or rate-limiting (the dynamic host silently degrades to EMPTY results under
  // load) — so every "empty" this run would be an untrustworthy phantom that reads
  // as 缩招. Better to abort loudly than to stamp a misleading dataset.
  if (!(await sourceCanary("before run"))) process.exit(1);

  // Batch-quarantine: buffer records and commit a batch to the checkpoint ONLY
  // after a fresh live canary confirms the source stayed up across it. Because the
  // dynamic host degrades to non-throwing empties under load, a canary is our only
  // reliable throttle signal. Bracketing each batch catches SUSTAINED throttling
  // (a discarded batch re-pulls on resume; empties are never cached — see
  // gaokao-cn.ts — so the re-pull is fresh). NOTE: a TRANSIENT throttle that hits a
  // single cell and clears before the boundary canary won't be caught — that cell
  // just becomes an incomparable/absent province (surfaced via provinces_incomparable,
  // never a phantom delta), which the pending-gate + a fresh daily re-run reconcile.
  // The cardinal rule (no phantom 缩招) holds regardless; only coverage can dip.
  const BATCH = 10;
  let completed = 0;
  let buffer: any[] = [];
  const flushBuffer = () => {
    for (const r of buffer) appendFileSync(CKPT, JSON.stringify(r) + "\n");
    buffer = [];
  };
  const commitBatch = async (when: string) => {
    if (buffer.length === 0) return;
    if (!(await sourceCanary(when))) {
      console.error(`Discarding ${buffer.length} un-committed schools (source degraded) — they re-pull on resume.`);
      process.exit(1);
    }
    flushBuffer();
  };

  for (let i = 0; i < todo.length; i++) {
    const school = todo[i];
    const provs = await pool(PROV_IDS, CONCURRENCY, (pid) => pullProvince(Number(school.id), pid));
    const provincesErrored = provs.filter((p: any) => p.errored).length;
    // A school with ANY source-errored (thrown) province is NOT recorded — a resume
    // retries it rather than freezing phantom-empty numbers. (Silent-empty cells are
    // handled separately: they can't fabricate a delta, and the batch canary catches
    // wholesale throttling.)
    if (provincesErrored > 0) {
      console.error(`[${++completed}/${todo.length}] ${school.name}: SKIP — ${provincesErrored} 省 source-errored, retry on resume`);
      continue;
    }
    const sum = (k: string) => provs.reduce((s, p: any) => s + (p[k] ?? 0), 0);
    const putong_2026 = sum("putong_2026"), putong_2025 = sum("putong_2025");
    const total_2026 = sum("total_2026"), total_2025 = sum("total_2025");
    const provinces_special_pending = provs.filter((p: any) => p.special_2026_pending).length;
    // Headline delta sums ONLY comparable (both-years-present) provinces — an
    // asymmetric cell (2026 unpublished or throttle-missed) is excluded so it can
    // never fabricate 缩招; it's surfaced via provinces_incomparable instead.
    const delta_putong = provs.reduce((s, p: any) => s + (p.comparable ? p.putong_2026 - p.putong_2025 : 0), 0);
    const provinces_incomparable = provs.filter((p: any) => (p.putong_2026 != null) !== (p.putong_2025 != null)).length;
    buffer.push({
      ...school,
      putong_2026, putong_2025, delta_putong,
      total_2026, total_2025, delta_total: total_2026 - total_2025,
      provinces_special_pending, provinces_incomparable,
      by_province: provs.filter((p: any) => p.putong_2026 != null || p.putong_2025 != null),
    });
    console.error(`[${++completed}/${todo.length}] ${school.name}: 普通类Δ(可比)=${delta_putong} (2026=${putong_2026} 2025=${putong_2025})${provinces_incomparable ? ` 不可比${provinces_incomparable}省` : ""}${provinces_special_pending ? ` 特殊待发${provinces_special_pending}省` : ""}`);

    if (buffer.length >= BATCH) await commitBatch(`after ${completed} schools`);
  }
  // Commit whatever's left (also re-probes liveness), incl. the last partial batch.
  await commitBatch("final");

  // assemble final dataset from checkpoint
  const schools = readFileSync(CKPT, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const pendingSchools = schools.filter((s) => s.provinces_special_pending > 0).length;
  const incomparableSchools = schools.filter((s) => (s.provinces_incomparable ?? 0) > 0).length;
  const out = {
    _meta: {
      description: "2026 vs 2025 分省分专业招生计划（985/211/双一流 头部院校）— 来源 掌上高考 动态 API(api.zjzw.cn)。",
      source: "api.zjzw.cn/web/api/?uri=apidata/api/gkv3/plan/school (static-data.gaokao.cn 的 schoolspecialplan 静态对象已于 2026-06 退役)",
      school_universe: "985 ∪ 211 ∪ 双一流（school-index.json.gz 过滤）",
      year_pair: [2026, 2025],
      school_count: schools.length,
      headline_metric: "delta_putong = 普通类计划人数 2026-2025，仅统计【两年都已发布】的可比省份（apples-to-apples）；单年缺失的省份计入 provinces_incomparable，不进 delta（避免把未发布/限流缺数误判为缩招）。",
      caveat: `出分季(6/26)抓取：gaokao.cn 2026 普通类计划已发布，但 提前批/综合评价/国家公费师范生/高校专项/国家专项/中外合作 等特殊类型 2026 计划多数尚未上线。故 total_2026 偏低、delta_total 仅供参考（不代表真实缩招）；以 delta_putong 为准。${pendingSchools} 所院校在 ≥1 省检测到 2026 特殊类型待发；${incomparableSchools} 所院校在 ≥1 省普通类单年缺数(未发布或限流)、已排除出 delta。`,
      generated_note: "stamp generated_at after run",
    },
    schools: schools.sort((a, b) => (b.delta_putong ?? 0) - (a.delta_putong ?? 0)),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.error(`WROTE ${OUT} (${schools.length} schools)`);
}
main();
