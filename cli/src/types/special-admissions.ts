// Special admissions schema — 6 record types covering all 34 regions × 3 years.
//
// Designed iter 3 of Ralph Loop. Each record is keyed by (region_id, year).
// 31 mainland regions use ProvinceId from codes.ts (11..65);
// 3 special regions (71 台湾 / 81 香港 / 82 澳门) use the same numeric space.
//
// Data lives under `cli/data/datasets/special-admissions/` as one JSON per
// (category, year) — e.g. `art-formula-2025.json`, `qiangji-quota-2024.json`.
//
// Source markdowns at `docs/special-admissions-3year/{pinyin}.md`.
// Provenance + N/A handling follow `data_source[]` + `confidence` fields.

import type { ProvinceId } from "../codes.js";

/** 34 region codes — 31 mainland + 3 special (台湾 71 / 香港 81 / 澳门 82). */
export type RegionId = ProvinceId | 71 | 81 | 82;

export type Year = 2023 | 2024 | 2025 | 2026;

/** Reform mode the region operated under that year. */
export type ReformMode = "old" | "3+3" | "3+1+2" | "special";

/** Confidence in the data point — `low` typically means N/A or media-sourced. */
export type Confidence = "high" | "medium" | "low";

// ───────────────────────────────────────────────────────────────────────────
// 1. Art unified exam (艺术统考)
// ───────────────────────────────────────────────────────────────────────────

/** The 10 art categories used by post-2024 教育部艺考新政 (some sub-divided). */
export type ArtCategory =
  | "美术与设计"
  | "音乐表演-声乐"
  | "音乐表演-器乐"
  | "音乐教育-声乐"
  | "音乐教育-器乐"
  | "舞蹈"
  | "戏剧影视表演"
  | "戏剧影视导演"
  | "服装表演"
  | "播音与主持"
  | "书法"
  | "戏曲";

/**
 * Comprehensive-score formula.
 *
 * Standard form: 综合分 = 文化 × culture_pct + 专业 × pro_factor × pro_pct
 *
 * - `pro_factor` is the normalization multiplier (e.g. 2.5 when 文化 750 / 专业 300).
 * - `extras` captures province-specific deviations:
 *   - 河南 "5 选 1"(院校自选 5 公式)
 *   - 云南 2025 起 院校自选 3 公式(50/50, 70/30, 纯文化)
 *   - 湖北 "[文化%+专业%]×2 还原"
 *   - 辽宁 百分制再加权
 *   - 湖南/青海 文化+专业直接相加(无加权)
 *   - 海南 900 标准分制
 *   - 陕西/甘肃 按专业课成绩投档(无综合分)
 */
export interface ArtFormula {
  culture_pct: number;
  pro_factor: number;
  pro_pct: number;
  /**
   * Outer multiplier applied to the weighted sum: `(culture×p1 + pro×factor×p2) × multiplier`.
   * Default `1` (or undefined). Set `2` for 湖北/河南 "×2 还原到 750 制" 口径 — naive
   * consumers computing `culture×pct + pro×factor×pct` underweight these provinces by 50%.
   */
  multiplier?: number;
  /** Free-form note for province-specific variants. Empty when standard. */
  extras?: string;
}

export interface ArtFormulaRecord {
  region_id: RegionId;
  year: Year;
  reform: ReformMode;
  category: ArtCategory;
  /** Some provinces (e.g. 陕西, 海南 体育) don't use a weighted formula. */
  formula: ArtFormula | null;
  /** 专业合格线 (校考资格线 / 统考合格线). */
  qualifying_score: {
    benke?: number; // 本科
    zhuanke?: number; // 专科
  };
  /** 文化录取控制线 — split by track (物/史 in 3+1+2; 文/理 in old; 单一 in 3+3). */
  culture_control_line?: {
    historical?: number;
    physical?: number;
    arts_wen?: number;
    arts_li?: number;
    unified?: number;
  };
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Sports unified admission (体育统招)
// ───────────────────────────────────────────────────────────────────────────

/** Comprehensive-score formula for sports — varies more than art. */
export type SportsFormulaKind =
  | "weighted" //  e.g. 综合 = 文化×p1 + 专业×factor×p2
  | "additive" // 湖南/青海 — 文化 + 专业 直接相加
  | "professional_first" // 陕西/甘肃 — 按专业课成绩投档
  | "gaokao_only" // 海南 — 双线达标后按高考总分
  | "merged_specline"; // 重庆 2025 — 本/专合一 73

export interface SportsFormulaRecord {
  region_id: RegionId;
  year: Year;
  reform: ReformMode;
  kind: SportsFormulaKind;
  formula?: ArtFormula; // populated when kind === "weighted"
  /** 专业(术科)合格线. */
  professional_qualifying: {
    benke?: number;
    zhuanke?: number;
  };
  culture_control_line?: {
    historical?: number;
    physical?: number;
    wen?: number;
    li?: number;
    unified?: number;
    benke?: number;
    zhuanke?: number;
  };
  /** 术科测试项目清单. */
  test_items?: string[];
  /** 全国独有公式或政策的备注. */
  notes?: string;
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Qiangji (强基计划)
// ───────────────────────────────────────────────────────────────────────────

/** 39 强基校 — keyed by gaokao.cn zs_code. */
export interface QiangjiSchool {
  zs_code: string; // e.g. "10003" for 清华大学
  name_zh: string;
}

export interface QiangjiQuotaRecord {
  school: QiangjiSchool;
  region_id: RegionId;
  year: Year;
  /** 当年在本省总名额(可分专业另列). */
  quota?: number;
  /** 入围线 — 各省按物理/历史 or 文/理 拆分. */
  ruwei_line?: {
    physical?: number;
    historical?: number;
    wen?: number;
    li?: number;
  };
  /**
   * 入围倍数(各校各专业不同):
   * - 5 = 计划数 5 倍
   * - "all" = "报名即入围"(复旦/上交/南大/浙大/中科大/西交/同济/厦大/北航/兰大/人大/东大 等出分前校测的校)
   */
  ruwei_ratio?: number | "all";
  /** 综合成绩公式权重(高考 + 校测). */
  composite_formula?: {
    gaokao_pct: number; // 通常 85
    xiaoce_pct: number; // 通常 15
  };
  /** 本省西部 75% 文化门槛(甘青宁新). */
  west_75pct_threshold?: boolean;
  /** 该校在该省该年是否新增/退出. */
  status?: "added" | "removed" | "unchanged";
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Zongping (综合评价)
// ───────────────────────────────────────────────────────────────────────────

export interface ZongPingSchool {
  zs_code?: string;
  name_zh: string;
  is_local: boolean; // 是否本省校
}

export interface ZongPingRecord {
  school: ZongPingSchool;
  region_id: RegionId;
  year: Year;
  /** 当年在本省总录取数. */
  enrolled?: number;
  /**
   * 综合成绩公式:多数采用 631 (高考60+校测30+学考10) 或 85+15。
   * 浙江三位一体含学考维度(独有);上海/山东硬性 85+15。
   */
  composite_formula?: {
    gaokao_pct?: number;
    xiaoce_pct?: number;
    xueke_pct?: number;
    /** 自由文本备注(各省 B 类校或港澳合办校公式差异). */
    extras?: string;
  };
  /** 入围线/资格线(按专业组拆). */
  ruwei_lines?: Array<{
    program_group?: string;
    score?: number;
  }>;
  /** 入围比例 — e.g. 1:6 山大 / 1:1.5 上海. */
  ruwei_ratio?: string;
  /** Track for 三位一体 (浙江独有,含学考维度). */
  is_sanweiyiti?: boolean;
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Minzu policy (民族政策)
// ───────────────────────────────────────────────────────────────────────────

/** Score-bonus tier — 一个省可能有多个梯度. */
export interface MinzuBonusTier {
  /** 适用人群描述 (e.g. "两州五县少民"、"边疆少民"、"内地世居 19 民族"). */
  scope: string;
  /** 加分值 (0 = 取消, null = N/A). */
  bonus: number | null;
  /** "三统一" 等先决条件描述. */
  requirements?: string;
  /** 仅省属高校用 / 全国通用. */
  scope_universities?: "all" | "provincial_only";
  /** 该梯度退坡时间表 — e.g. {2026: 5, 2027: 0}. */
  rollback_schedule?: Record<number, number>;
}

export interface MinzuPolicyRecord {
  region_id: RegionId;
  year: Year;
  /** 多个加分梯度. */
  bonus_tiers: MinzuBonusTier[];
  /** 民族班降分 (e.g. -40). */
  minzu_ban_discount?: number;
  /** 民族预科降分 (e.g. -80). */
  minzu_yuke_discount?: number;
  /** 主要承接校 (国家民委直属 + 省内民族高校). */
  host_schools?: string[];
  /** 民族语种试卷 (新疆 4 种,内蒙 蒙古语加试). */
  language_tracks?: string[];
  /** 特殊计划:内高班/南疆单列/对口援疆/双联户/进藏干部. */
  special_programs?: string[];
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 6. QATW channels (港澳台双向通道)
// ───────────────────────────────────────────────────────────────────────────

/** 7 通道覆盖港澳台全部进出路径. */
export type QATWChannelType =
  | "全国联招" // 港澳台华侨联招,广州考点
  | "居住证高考" // 港澳居民居住证 (台胞居住证不能凭单独参加普通高考)
  | "保送生" // 澳门特有(本澳中学综合排名前 40% 推荐)
  | "DSE互认" // 香港特有,140+ 内地承认院校
  | "港校招内地生" // 港大/港中大/港科大/港城/港理工/港浸/岭南/教大/都大
  | "澳校招内地生" // 澳大/澳科大/澳理工/旅游大/澳城大/镜湖
  | "学测申请陆校" // 台湾特有,2025/2026 已覆盖 451 内地校
  | "陆生申请台校"; // 2020/04/09 起暂停,2024-2026 未恢复

export interface QATWChannelRecord {
  region_id: 71 | 81 | 82;
  year: Year;
  channel: QATWChannelType;
  /** 报名总数. */
  applicants?: number;
  /** 录取总数. */
  admitted?: number;
  /** 录取率. */
  admission_rate?: number;
  /** 控制线 (按批次或科类). */
  control_lines?: Array<{
    batch: string;
    wen?: number;
    li?: number;
    wenke?: number;
    like?: number;
    unified?: number;
  }>;
  /** 涉及校单 (港校/澳校独立招生,或大陆 320+ 校接收台生). */
  schools?: Array<{
    name_zh: string;
    zs_code?: string;
    quota?: number;
    min_score?: number;
    notes?: string;
  }>;
  /** 数据可信度 — 台湾方向 B 自 2020 实际 ≈0 但简章存续. */
  status?: "active" | "suspended_since_2020" | "experimental";
  /** 政策事件备注. */
  notes?: string;
  data_source: string[];
  confidence: Confidence;
}

// ───────────────────────────────────────────────────────────────────────────
// 7. Combined dataset shape (one JSON per (category, year))
// ───────────────────────────────────────────────────────────────────────────

export interface SpecialAdmissionsDataset {
  /** Semver string. Loaders should accept any "X.Y.Z" for forward-compat. */
  schema_version: string;
  category:
    | "art-formula"
    | "sports-formula"
    | "qiangji-quota"
    | "zongping"
    | "minzu-policy"
    | "qatw-channel";
  year: Year;
  generated_at: string; // ISO 8601
  source_markdown_dir: "docs/special-admissions-3year";
  records:
    | ArtFormulaRecord[]
    | SportsFormulaRecord[]
    | QiangjiQuotaRecord[]
    | ZongPingRecord[]
    | MinzuPolicyRecord[]
    | QATWChannelRecord[];
}
