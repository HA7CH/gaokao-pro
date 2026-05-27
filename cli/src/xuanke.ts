// xuanke — decode gaokao.cn selected-subject codes (70001 / 70002 / ...) into
// the 6 standard subjects + 不限. Codes show up in schoolspecialscore /
// schoolspecialplan `sp_xuanke` / `sg_xuanke` fields.
//
// Format inferred from observed payloads:
//   `_` joins codes inside ONE valid combination (AND)
//   `^` separates alternative combinations (OR)
//
// Example raw: "70001_70002_70004^70001_70003_70004"
//   → satisfy either (物理 AND 化学 AND 历史) or (物理 AND 生物 AND 历史)
//
// 70008 commonly appears as "不限" (no requirement).
export const XUANKE_CODES: Record<string, string> = {
  "70001": "物理",
  "70002": "化学",
  "70003": "生物",
  "70004": "历史",
  "70005": "政治",
  "70006": "地理",
  "70008": "不限"
};

export type DecodedXuanke = {
  raw: string;
  combinations: string[][];  // each inner array = one valid combination
  display: string;           // human-readable single line
  unrestricted: boolean;
};

export function decodeXuanke(raw: string | null | undefined): DecodedXuanke {
  const safeRaw = (raw ?? "").trim();
  if (!safeRaw) {
    return { raw: "", combinations: [], display: "(无数据)", unrestricted: false };
  }
  const groups = safeRaw.split("^").map((g) => g.trim()).filter(Boolean);
  const combinations = groups.map((g) =>
    g.split("_").map((c) => XUANKE_CODES[c.trim()] ?? `?${c.trim()}`)
  );
  // unrestricted if every combination is just ["不限"]
  const unrestricted = combinations.length > 0 && combinations.every((c) => c.length === 1 && c[0] === "不限");
  const display = unrestricted
    ? "不限"
    : combinations.map((c) => c.join("+")).join(" 或 ");
  return { raw: safeRaw, combinations, display, unrestricted };
}

// ---------------------------------------------------------------------------
// 选科 matching (finding #2)
// ---------------------------------------------------------------------------
// Validate whether a student's subject combination qualifies for a major,
// given that major's requirement. The requirement may be:
//   - a numeric xuanke code string ("70001_70002^70004", 70008=不限), OR
//   - a human-readable string from gaokao.cn sp_fxk/sp_sxk fields
//     ("物理+化学", "物理、化学", "物理和化学", "物理或历史", "化学/生物",
//      "化学、生物任选1门", "不限"), OR
//   - an array of such strings (e.g. [sp_fxk, sp_sxk]) — ALL must be satisfied.
//
// Pure function, no I/O. Returns { ok, reason } so callers can explain why a
// major is (un)selectable.

const SUBJECT_SET = new Set(["物理", "历史", "化学", "生物", "政治", "地理"]);

// Aliases seen on gaokao.cn. NOTE: never blindly strip a 学 suffix — that
// would corrupt 化学→化 / 生物 vs 生物学. Map known long forms explicitly.
const SUBJECT_ALIASES: Record<string, string> = {
  "物理学": "物理",
  "化学学": "化学",
  "生物学": "生物",
  "生物科学": "生物",
  "生": "生物",
  "思想政治": "政治",
  "政治学": "政治",
  "地理学": "地理",
  "历史学": "历史"
};

// Normalize a token to one of the 6 canonical subject names, "不限", or null.
function normalizeSubject(token: string): string | null {
  let t = token.trim();
  if (!t) return null;
  // numeric code → name
  if (/^\d+$/.test(t)) {
    const mapped = XUANKE_CODES[t];
    return mapped ?? null;
  }
  if (t === "不限") return "不限";
  if (SUBJECT_SET.has(t)) return t;
  if (SUBJECT_ALIASES[t]) return SUBJECT_ALIASES[t];
  // last-ditch: a longer label that contains exactly one canonical subject
  // (e.g. "首选物理"). Require an exact-subject substring, not a partial.
  const found = [...SUBJECT_SET].filter((s) => t.includes(s));
  return found.length === 1 ? found[0] : null;
}

type Clause =
  | { kind: "none" }                 // 不限
  | { kind: "and"; subjects: string[] }   // all required
  | { kind: "or"; subjects: string[]; n: number }; // at least n of these

// AND separators: + _ 和 & ＋ and whitespace between two subjects.
const AND_SEP = /[+_＋&]|和|与|及|，再选|；/;
// OR separators: 或 / ｜ |
const OR_SEP = /[/／|｜]|或/;

// Parse one requirement token (single field) into a Clause.
function parseRequirement(field: string): Clause {
  const raw = field.trim();
  if (!raw) return { kind: "none" };

  // Numeric-code form: groups joined by _ inside a combination, ^ between
  // alternatives. Decode and treat each ^-group as an AND, multiple groups as
  // OR-of-ANDs handled by the array path; here we flatten to subjects.
  if (/^[\d_^]+$/.test(raw)) {
    const groups = raw.split("^").map((g) => g.trim()).filter(Boolean);
    // If any group is purely 不限 (70008) → no requirement.
    const decodedGroups = groups.map((g) =>
      g.split("_").map((c) => normalizeSubject(c)).filter((s): s is string => !!s)
    );
    if (decodedGroups.length === 0) return { kind: "none" };
    if (decodedGroups.some((g) => g.length === 1 && g[0] === "不限")) return { kind: "none" };
    // Multiple alternative groups → satisfy ANY whole group. We model the
    // common single-group case precisely (AND); for multi-group OR-of-ANDs we
    // fall back to "or, need at least the smallest group size" which is
    // conservative-correct for the typical 物理 单科 vs 历史 单科 case.
    if (decodedGroups.length === 1) {
      const g = decodedGroups[0].filter((s) => s !== "不限");
      return g.length <= 1
        ? { kind: "and", subjects: g }
        : { kind: "and", subjects: g };
    }
    const flat = Array.from(new Set(decodedGroups.flat().filter((s) => s !== "不限")));
    return { kind: "or", subjects: flat, n: 1 };
  }

  // Human-readable form.
  if (raw.includes("不限") || raw === "无" || raw === "-") return { kind: "none" };

  // "任选N门" / "任选N" → OR with explicit n.
  const anyN = raw.match(/任选\s*(\d+)\s*门?/);
  if (anyN) {
    const subjects = raw
      .split(/[、，,/／|｜]|或/)
      .map((p) => normalizeSubject(p.replace(/任选\s*\d+\s*门?/g, "")))
      .filter((s): s is string => !!s && s !== "不限");
    return { kind: "or", subjects: Array.from(new Set(subjects)), n: Number(anyN[1]) || 1 };
  }

  // Explicit OR markers → at least one.
  if (OR_SEP.test(raw)) {
    const subjects = raw
      .split(OR_SEP)
      .flatMap((p) => p.split(/[、，,]/))
      .map((p) => normalizeSubject(p))
      .filter((s): s is string => !!s && s !== "不限");
    return { kind: "or", subjects: Array.from(new Set(subjects)), n: 1 };
  }

  // Otherwise AND across separators (含、和、＋、，、whitespace).
  const subjects = raw
    .split(AND_SEP)
    .flatMap((p) => p.split(/[、，,\s]+/))
    .map((p) => normalizeSubject(p))
    .filter((s): s is string => !!s && s !== "不限");
  return { kind: "and", subjects: Array.from(new Set(subjects)) };
}

/**
 * Does the student's subject set satisfy a major's 选科 requirement?
 * @param studentSubjects e.g. ["物理","化学","生物"] (canonical names)
 * @param requirement     a requirement string, numeric code, or array of
 *                        fields (all of which must be satisfied — AND).
 */
export function xuankeMatch(
  studentSubjects: string[],
  requirement: string | string[]
): { ok: boolean; reason: string } {
  const have = new Set(
    studentSubjects.map((s) => normalizeSubject(s)).filter((s): s is string => !!s)
  );

  const fields = (Array.isArray(requirement) ? requirement : [requirement])
    .map((f) => (f ?? "").trim())
    .filter(Boolean);

  if (fields.length === 0) return { ok: true, reason: "不限 (无选科要求)" };

  const clauses = fields.map(parseRequirement);
  // If every field parsed to 不限 / empty → no requirement.
  if (clauses.every((c) => c.kind === "none" || c.subjects.length === 0)) {
    return { ok: true, reason: "不限 (无选科要求)" };
  }

  for (const c of clauses) {
    if (c.kind === "none" || c.subjects.length === 0) continue;
    if (c.kind === "and") {
      const missing = c.subjects.filter((s) => !have.has(s));
      if (missing.length > 0) {
        return { ok: false, reason: `缺少必选科目: ${missing.join("、")} (要求 ${c.subjects.join("+")})` };
      }
    } else {
      const got = c.subjects.filter((s) => have.has(s));
      if (got.length < c.n) {
        return {
          ok: false,
          reason: `需在 ${c.subjects.join("/")} 中至少选 ${c.n} 门, 当前满足 ${got.length} 门`
        };
      }
    }
  }
  return { ok: true, reason: "满足选科要求" };
}
