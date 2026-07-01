// selftest — end-to-end smoke that confirms the whole stack works.
// Stage 1: static upstream works (school/31/info.json — the min-score corpus).
// Stage 2: dynamic upstream works (per-major 招生计划 — api.zjzw.cn). This is the
//          tier that broke in 2026-06 when the static schoolspecialplan objects were
//          retired; a dedicated stage means a future move surfaces here, not as
//          silently-empty query results.
// Stage 3: local school index loads and has expected shape.
// Stage 4: 一分一段 table loads and looks up correctly.
//
// Designed to be the single command a new install runs to know it's healthy.
import { getSchoolInfo, getAdmissionPlan } from "./gaokao-cn.js";
import { loadIndex } from "./index-loader.js";
import { loadRankTable, scoreToRank } from "./rank-table.js";

type Result = { stage: string; ok: boolean; ms?: number; reason?: string };

async function timed(stage: string, fn: () => Promise<void> | void): Promise<Result> {
  const t = Date.now();
  try {
    await fn();
    return { stage, ok: true, ms: Date.now() - t };
  } catch (e) {
    return { stage, ok: false, ms: Date.now() - t, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function runSelftest(): Promise<{ ok: boolean; results: Result[] }> {
  const results: Result[] = [];

  results.push(
    await timed("upstream gaokao.cn", async () => {
      const info = await getSchoolInfo(31);
      if (info.name !== "北京大学") throw new Error(`expected 北京大学, got ${info.name}`);
      if (!info.pro_type_min || Object.keys(info.pro_type_min).length === 0) {
        throw new Error("pro_type_min missing");
      }
    })
  );

  results.push(
    await timed("dynamic 招生计划 (api.zjzw.cn)", async () => {
      // 北大 × 河南 × 2024 reliably carries ~50 majors. Empty here means the plan
      // source is down/relocated or rate-limiting — the exact 2026-06 breakage.
      const plan = await getAdmissionPlan(31, 2024, 41);
      if (plan.length === 0) {
        throw new Error("empty plan (source down/relocated or rate-limited) — see gaokao-cn.ts DYNAMIC_BASE/PLAN_URI");
      }
      if (!plan.some((p) => /^\d{6}[A-Z]?$/.test(p.spcode))) {
        throw new Error("plan rows carry no valid 专业代码 — item shape may have changed");
      }
    })
  );

  results.push(
    await timed("local school index", () => {
      const idx = loadIndex();
      if (idx.rows.length < 2000) throw new Error(`only ${idx.rows.length} schools (expected ≥2000)`);
      if (!idx.rows[0]?.pro_type_min) throw new Error("rows[0].pro_type_min missing");
    })
  );

  results.push(
    await timed("一分一段 (beijing 2024 combined)", () => {
      const table = loadRankTable(11, 2024, "combined");
      if (!table) throw new Error("beijing 2024 combined not loaded");
      if (table.rows.length < 200) throw new Error(`only ${table.rows.length} rows`);
      const rank = scoreToRank(table, 650);
      if (!rank || rank <= 0) throw new Error(`scoreToRank(650) = ${rank}`);
    })
  );

  return { ok: results.every((r) => r.ok), results };
}
