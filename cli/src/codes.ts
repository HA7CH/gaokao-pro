// Province codes used by static-data.gaokao.cn (GB/T 2260 prefix).
export const PROVINCES = {
  11: { name: "北京", pinyin: "beijing", reform: "3+3" },
  12: { name: "天津", pinyin: "tianjin", reform: "3+3" },
  13: { name: "河北", pinyin: "hebei", reform: "3+1+2" },
  14: { name: "山西", pinyin: "shanxi", reform: "3+1+2" },   // 批5: first new-gaokao exam 2025 (was 文/理 through 2024)
  15: { name: "内蒙古", pinyin: "neimenggu", reform: "3+1+2" }, // 批5: first new-gaokao exam 2025 (was 文/理 through 2024)
  21: { name: "辽宁", pinyin: "liaoning", reform: "3+1+2" },
  22: { name: "吉林", pinyin: "jilin", reform: "3+1+2" },
  23: { name: "黑龙江", pinyin: "heilongjiang", reform: "3+1+2" },
  31: { name: "上海", pinyin: "shanghai", reform: "3+3" },
  32: { name: "江苏", pinyin: "jiangsu", reform: "3+1+2" },
  33: { name: "浙江", pinyin: "zhejiang", reform: "3+3" },
  34: { name: "安徽", pinyin: "anhui", reform: "3+1+2" },
  35: { name: "福建", pinyin: "fujian", reform: "3+1+2" },
  36: { name: "江西", pinyin: "jiangxi", reform: "3+1+2" },
  37: { name: "山东", pinyin: "shandong", reform: "3+3" },
  41: { name: "河南", pinyin: "henan", reform: "3+1+2" },
  42: { name: "湖北", pinyin: "hubei", reform: "3+1+2" },
  43: { name: "湖南", pinyin: "hunan", reform: "3+1+2" },
  44: { name: "广东", pinyin: "guangdong", reform: "3+1+2" },
  45: { name: "广西", pinyin: "guangxi", reform: "3+1+2" },
  46: { name: "海南", pinyin: "hainan", reform: "3+3" },
  50: { name: "重庆", pinyin: "chongqing", reform: "3+1+2" },
  51: { name: "四川", pinyin: "sichuan", reform: "3+1+2" },
  52: { name: "贵州", pinyin: "guizhou", reform: "3+1+2" },
  53: { name: "云南", pinyin: "yunnan", reform: "3+1+2" },
  54: { name: "西藏", pinyin: "xizang", reform: "old" },
  61: { name: "陕西", pinyin: "shaanxi", reform: "3+1+2" },
  62: { name: "甘肃", pinyin: "gansu", reform: "3+1+2" },
  63: { name: "青海", pinyin: "qinghai", reform: "3+1+2" },
  64: { name: "宁夏", pinyin: "ningxia", reform: "3+1+2" },
  65: { name: "新疆", pinyin: "xinjiang", reform: "3+1+2" },
  // GB/T 2260 港澳台 — 不在普通高考体系内，走全国联招 / 居住证高考 / 港澳台高校通道
  // 注：港中大(深圳)、港科大(广州)、港大(深圳)是内地办学法人，归入广东 44，不归 81
  71: { name: "台湾", pinyin: "taiwan", reform: "special" },
  81: { name: "香港", pinyin: "xianggang", reform: "special" },
  82: { name: "澳门", pinyin: "aomen", reform: "special" }
} as const;

export type ProvinceId = keyof typeof PROVINCES;

// Subject-track codes seen in static-data.gaokao.cn `type` / `pro_type` fields.
export const TRACK_NAMES: Record<string, string> = {
  "1": "理工",
  "2": "文史",
  "3": "综合改革", // 3+3 provinces
  "2073": "物理类", // 3+1+2 物理首选
  "2074": "历史类"  // 3+1+2 历史首选
};

export function resolveProvince(input: string | number): ProvinceId | null {
  if (typeof input === "number") {
    return (input in PROVINCES) ? (input as ProvinceId) : null;
  }
  const trimmed = String(input).trim().toLowerCase();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric in PROVINCES) {
    return numeric as ProvinceId;
  }
  for (const [id, p] of Object.entries(PROVINCES)) {
    if (p.name === trimmed || p.pinyin === trimmed) {
      return Number(id) as ProvinceId;
    }
  }
  return null;
}

// Six 3+1+2 reselect subjects + the two first-choice tracks.
export type Subject = "物理" | "历史" | "化学" | "生物" | "政治" | "地理";
export const ALL_SUBJECTS: Subject[] = ["物理", "历史", "化学", "生物", "政治", "地理"];

// ---------------------------------------------------------------------------
// Score-input validation (finding #12)
// ---------------------------------------------------------------------------
// Provincial total-score caps. MUST stay in sync with chart-check.ts
// PROVINCE_MAX — that file is the canonical owner of the cap values; we
// duplicate the same numbers here only because chart-check.ts does not
// export them. 海南 uses a 900 标准分 scale, 上海 is 660, everyone else 750.
const PROVINCE_MAX_SCORE: Record<number, number> = {
  46: 900,   // 海南 标准分
  31: 660,   // 上海
  // everyone else defaults to 750
};

/** Max valid total score for a province (matches chart-check.ts maxScoreFor). */
export function maxScoreFor(id: ProvinceId): number {
  return PROVINCE_MAX_SCORE[id] ?? 750;
}

/**
 * Validate a user-supplied gaokao total score for a province.
 * Throws a clear, actionable error when the score is not finite, ≤ 0, or
 * above the provincial maximum. Used at the entry of recommend/match/top/
 * recommendMajor so absurd inputs never reach the scoring math (finding #12).
 */
export function validateScore(score: number, provinceId: ProvinceId): void {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error(`无效分数: ${score} (分数必须是有限数字)`);
  }
  if (score <= 0) {
    throw new Error(`无效分数: ${score} (分数必须大于 0)`);
  }
  const cap = maxScoreFor(provinceId);
  if (score > cap) {
    throw new Error(
      `无效分数: ${score} 超出 ${PROVINCES[provinceId].name} 满分 ${cap} (有效区间 (0, ${cap}])`
    );
  }
}
