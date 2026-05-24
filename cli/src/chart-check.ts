// chart-check — sanity-check a student profile before sending it into
// recommend / match. Validates score range, subject combo, rank-score
// consistency (against 一分一段表 if ingested), 选科 vs 新高考 reform,
// and completeness.
//
// Output: { ok, score 0-100, errors, warnings }
import { PROVINCES, ALL_SUBJECTS, type ProvinceId, type Subject } from "./codes.js";
import { loadRankTable, scoreToRank, inferDefaultTrack } from "./rank-table.js";
import { inferTrack } from "./recommend.js";

export type ChartProfile = {
  score?: number;
  rank?: number;
  province?: string;            // numeric id, pinyin, or 中文 — caller resolves
  province_id?: ProvinceId;     // resolved variant
  subjects?: string[];
  year?: number;
};

export type Check = { check: string; message: string };
export type ChartCheckResult = {
  ok: boolean;
  health: number;            // 0-100
  errors: Check[];
  warnings: Check[];
};

// Provincial total-score max — extend as needed.
const PROVINCE_MAX: Record<number, number> = {
  46: 900,   // 海南 标准分
  31: 660,   // 上海
  // everyone else defaults to 750
};

function maxScoreFor(id: ProvinceId): number {
  return PROVINCE_MAX[id] ?? 750;
}

export function chartCheck(profile: ChartProfile): ChartCheckResult {
  const errors: Check[] = [];
  const warnings: Check[] = [];
  let health = 100;

  // 1. completeness
  if (!profile.province_id) {
    errors.push({ check: "completeness", message: "missing province_id (caller must resolve via resolveProvince)" });
  }
  if (profile.score === undefined) {
    errors.push({ check: "completeness", message: "missing score" });
  }
  if (!profile.subjects || profile.subjects.length === 0) {
    errors.push({ check: "completeness", message: "missing subjects" });
  }
  if (errors.length > 0) {
    return { ok: false, health: 0, errors, warnings };
  }

  const provinceId = profile.province_id as ProvinceId;
  const score = profile.score as number;
  const subjects = profile.subjects as string[];

  // 2. score-in-range
  const cap = maxScoreFor(provinceId);
  if (score < 0 || score > cap) {
    errors.push({ check: "score_range", message: `score ${score} out of ${PROVINCES[provinceId].name} range [0, ${cap}]` });
    health -= 25;
  } else if (score < 200) {
    warnings.push({ check: "score_range", message: `score ${score} 偏低, 可能信息有误` });
    health -= 5;
  }

  // 3. subjects validity
  for (const s of subjects) {
    if (!ALL_SUBJECTS.includes(s as Subject)) {
      errors.push({ check: "subjects", message: `unknown subject: ${s}` });
      health -= 10;
    }
  }
  const reform = PROVINCES[provinceId].reform;
  if (reform === "3+1+2") {
    if (!subjects.includes("物理") && !subjects.includes("历史")) {
      errors.push({ check: "subjects", message: "3+1+2 省份必须含 物理 或 历史 (首选科目)" });
      health -= 20;
    }
    if (subjects.includes("物理") && subjects.includes("历史")) {
      warnings.push({ check: "subjects", message: "首选只能在 物理/历史 二者择一" });
      health -= 5;
    }
    if (subjects.length !== 3) {
      warnings.push({ check: "subjects", message: `3+1+2 应有 3 门选考, 当前 ${subjects.length}` });
    }
  } else if (reform === "3+3") {
    if (subjects.length !== 3) {
      warnings.push({ check: "subjects", message: `3+3 应有 3 门选考, 当前 ${subjects.length}` });
    }
  }

  // 4. rank-score consistency (when 一分一段 exists)
  if (profile.rank !== undefined && profile.year !== undefined) {
    const track = subjects.length > 0
      ? inferTrack(provinceId, subjects as Subject[])
      : inferDefaultTrack(provinceId);
    const trackKey = track === "2073" ? "physics" : track === "2074" ? "history" : track === "3" ? "combined" : track === "1" ? "science" : track === "2" ? "liberal" : track;
    const table = loadRankTable(provinceId, profile.year, trackKey);
    if (table) {
      const inferredRank = scoreToRank(table, score);
      if (inferredRank && Math.abs(inferredRank - profile.rank) > Math.max(500, profile.rank * 0.1)) {
        warnings.push({
          check: "rank_score_consistency",
          message: `score ${score} 在 ${PROVINCES[provinceId].name} ${profile.year} ${trackKey} 一分一段 推断位次 ≈ ${inferredRank}, 但你给的是 ${profile.rank} — 差距偏大`
        });
        health -= 8;
      }
    }
  }

  return {
    ok: errors.length === 0,
    health: Math.max(0, health),
    errors,
    warnings
  };
}
