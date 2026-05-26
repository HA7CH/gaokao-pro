import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "../data/datasets/college-groups-2025.json");

type Major = { name: string | null; plan: number | null; min_score: number | null; min_rank: number | null };
type Group = {
  group_code: string;
  track: string | null;
  subject_require: string | null;
  category: string | null;
  majors_count: number;
  majors: Major[];
  group_min_score: number | null;
  group_min_rank: number | null;
};
type Province = { province: string; groups_count: number; majors_total: number; groups: Group[] };
type University = { university: string; code: number | null; year: number; provinces: Province[] };
type Dataset = { meta: any; universities: University[] };

let cache: Dataset | null = null;
function load(): Dataset {
  if (!cache) cache = JSON.parse(readFileSync(DATA, "utf-8"));
  return cache!;
}

export function findUniversity(name: string): University | null {
  const ds = load();
  return ds.universities.find(u => typeof u.university === "string" && u.university.includes(name)) || null;
}

export function listGroups(uniName: string, provinceName: string): Group[] {
  const u = findUniversity(uniName);
  if (!u) return [];
  const p = u.provinces.find(p => p.province === provinceName);
  return p ? p.groups : [];
}

/**
 * 调剂安全分 — given user's major preferences, compute risk per group.
 * Strategy:
 *   - must_have: 用户必须录到的专业（关键词）
 *   - acceptable: 可接受的专业（关键词）— 调剂落到这里也 OK
 *   - reject: 拒绝的专业（关键词）— 调剂落到这里 = 灾难
 *
 * safety_score = (matches in must_have ∪ acceptable) / total_in_group
 * verdict:
 *   - 🟢 >= 0.8 (safe to check 服从调剂)
 *   - 🟡 0.4-0.8 (moderate risk — review group composition)
 *   - 🔴 < 0.4 (high risk — do NOT check 服从调剂)
 */
export function safetyScore(group: Group, prefs: {
  must_have: string[];
  acceptable: string[];
  reject: string[];
}): { score: number; verdict: "safe" | "moderate" | "risky"; has_must: boolean; matched_majors: string[]; rejected_majors: string[] } {
  const matched: string[] = [];
  const rejected: string[] = [];
  let has_must = false;
  let acceptable_count = 0;
  for (const m of group.majors) {
    const name = m.name || "";
    if (prefs.must_have.some(kw => name.includes(kw))) {
      matched.push(name); acceptable_count++; has_must = true;
    } else if (prefs.acceptable.some(kw => name.includes(kw))) {
      matched.push(name); acceptable_count++;
    } else if (prefs.reject.some(kw => name.includes(kw))) {
      rejected.push(name);
    }
  }
  const total = group.majors.length || 1;
  const score = acceptable_count / total;
  const verdict = score >= 0.8 ? "safe" : score >= 0.4 ? "moderate" : "risky";
  return { score, verdict, has_must, matched_majors: matched, rejected_majors: rejected };
}

export function listAllUniversities(): string[] {
  return load().universities.map(u => u.university).filter(Boolean);
}

export function datasetStats() {
  const ds = load();
  let total_groups = 0, total_majors = 0;
  for (const u of ds.universities) {
    for (const p of u.provinces) {
      total_groups += p.groups_count;
      total_majors += p.majors_total;
    }
  }
  return {
    universities: ds.universities.length,
    total_groups,
    total_majors,
    provinces_scope: ds.meta?.provinces_scope || [],
    year: ds.meta?.year || 2025
  };
}
