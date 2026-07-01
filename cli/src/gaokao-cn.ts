// Client for static-data.gaokao.cn — the 中国教育在线 "掌上高考" static JSON tier.
// No auth, no sign, no rate limit observed. Treat it like a public CDN.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir, homedir } from "node:os";

const BASE = "https://static-data.gaokao.cn/www/2.0";
const UA = "gaokao-pro/0.0.1 (+https://github.com/HA7CH/gaokao-pro)";

// Per-request timeout (ms). Without this a stalled upstream can hang a fetch
// forever — at concurrency 25 in probe.ts one bad server blocks the whole run.
// Override via GAOKAO_CN_TIMEOUT_MS env var, or the opts.timeoutMs param.
const DEFAULT_TIMEOUT_MS = (() => {
  const env = Number(process.env.GAOKAO_CN_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : 15_000;
})();

// Bounded retry for transient failures (network errors / timeouts / 5xx).
// We deliberately do NOT retry clear 4xx — those won't fix themselves.
const DEFAULT_RETRIES = 2;
const RETRY_BACKOFF_MS = 300; // base; multiplied by attempt number + small jitter

// Distinct error type so callers / probe can tell a timeout apart from
// a genuine network or protocol error.
export class GaokaoTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`gaokao.cn request timed out after ${timeoutMs}ms for ${url}`);
    this.name = "GaokaoTimeoutError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Response cache. static-data.gaokao.cn serves immutable historical admission
// data (no auth, no rate limit) — the same path always returns the same bytes.
// The network round-trip (1-3s) dominates every school/plan/actual/scores call,
// so we cache responses by path: in-memory for the lifetime of a warm process
// (MCP / server / probe), and on disk so separate CLI invocations share hits.
// A planning session re-queries the same/related resources many times; with the
// cache the second+ hit is ~2ms instead of ~2s. TTL bounds staleness for the
// rare current-year in-season update; past-year data never changes.
//
//   GAOKAO_CN_NO_CACHE=1        disable entirely (probe + smoke set this)
//   GAOKAO_CN_CACHE_TTL_MS=0    same as disabling; >0 sets the TTL (default 24h)
//   GAOKAO_CN_CACHE_DIR=<path>  override the on-disk location
// Checked lazily (not a load-time const) so an entry point like probe.ts can set
// process.env.GAOKAO_CN_NO_CACHE before its first request and force a fresh fetch.
function cacheDisabled(): boolean {
  return process.env.GAOKAO_CN_NO_CACHE === "1" || process.env.GAOKAO_CN_CACHE_TTL_MS === "0";
}
const CACHE_TTL_MS = (() => {
  const env = Number(process.env.GAOKAO_CN_CACHE_TTL_MS);
  return Number.isFinite(env) && env > 0 ? env : 24 * 60 * 60 * 1000; // 24h
})();
export const CACHE_DIR = (() => {
  if (process.env.GAOKAO_CN_CACHE_DIR) return process.env.GAOKAO_CN_CACHE_DIR;
  const home = homedir();
  const base = process.env.XDG_CACHE_HOME || (home ? resolve(home, ".cache") : tmpdir());
  return resolve(base, "gaokao-pro", "http");
})();

const memCache = new Map<string, unknown>(); // path -> data, per-process

function cacheFileFor(path: string): string {
  return resolve(CACHE_DIR, `${createHash("sha1").update(path).digest("hex")}.json`);
}

function readCache(path: string): unknown | undefined {
  if (cacheDisabled()) return undefined;
  if (memCache.has(path)) return memCache.get(path);
  try {
    const entry = JSON.parse(readFileSync(cacheFileFor(path), "utf8")) as { ts: number; data: unknown };
    if (Date.now() - entry.ts > CACHE_TTL_MS) return undefined; // stale → refetch
    memCache.set(path, entry.data);
    return entry.data;
  } catch {
    return undefined; // miss / unreadable / corrupt — just refetch
  }
}

function writeCache(path: string, data: unknown): void {
  memCache.set(path, data); // memory cache is useful even when disk is disabled
  if (cacheDisabled()) return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const file = cacheFileFor(path);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ url: `${BASE}${path}`, ts: Date.now(), data }));
    // Atomic rename so a concurrent reader (probe runs 25-wide) never sees a half-written file.
    renameSync(tmp, file);
  } catch {
    /* cache is best-effort; a write failure must never break a real request */
  }
}

/** Clear the on-disk + in-memory response cache. Returns files removed + bytes freed. */
export function clearHttpCache(): { files: number; bytes: number } {
  memCache.clear();
  let files = 0;
  let bytes = 0;
  try {
    for (const name of readdirSync(CACHE_DIR)) {
      if (!name.endsWith(".json")) continue;
      const p = resolve(CACHE_DIR, name);
      try {
        bytes += statSync(p).size;
        rmSync(p);
        files++;
      } catch {
        /* skip files we can't stat/remove */
      }
    }
  } catch {
    /* cache dir may not exist yet — nothing to clear */
  }
  return { files, bytes };
}

/** Inspect the on-disk cache without mutating it. */
export function httpCacheInfo(): { dir: string; files: number; bytes: number; disabled: boolean; ttlMs: number } {
  let files = 0;
  let bytes = 0;
  try {
    for (const name of readdirSync(CACHE_DIR)) {
      if (!name.endsWith(".json")) continue;
      try {
        bytes += statSync(resolve(CACHE_DIR, name)).size;
        files++;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no dir yet */
  }
  return { dir: CACHE_DIR, files, bytes, disabled: cacheDisabled(), ttlMs: CACHE_TTL_MS };
}

type FetchJsonOpts = { timeoutMs?: number; retries?: number };

async function fetchJson<T>(path: string, opts: FetchJsonOpts = {}): Promise<T> {
  const hit = readCache(path);
  if (hit !== undefined) return hit as T;

  const url = `${BASE}${path}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Fresh AbortController per attempt — a controller can't be reused once aborted.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: controller.signal
      });

      // 4xx are not retried — they're deterministic for a given url.
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`gaokao.cn ${res.status} ${res.statusText} for ${url}`);
      }
      // 5xx / other non-ok: throw so the retry loop below can have another go.
      if (!res.ok) {
        throw new RetryableError(`gaokao.cn ${res.status} ${res.statusText} for ${url}`);
      }

      // Guard against HTML error/throttle/maintenance pages served with 200.
      // res.json() on HTML throws a cryptic SyntaxError; detect it up front.
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (!ct.includes("json") && !looksLikeJson(text)) {
        const prefix = text.slice(0, 200).replace(/\s+/g, " ").trim();
        throw new RetryableError(
          `gaokao.cn returned non-JSON (status ${res.status}, content-type ${ct || "<none>"}) for ${url}: ${prefix}`
        );
      }

      let body: { code?: string; message?: string; data?: T };
      try {
        body = JSON.parse(text);
      } catch {
        const prefix = text.slice(0, 200).replace(/\s+/g, " ").trim();
        throw new RetryableError(
          `gaokao.cn returned unparseable body (status ${res.status}, content-type ${ct || "<none>"}) for ${url}: ${prefix}`
        );
      }

      if (body.code !== "0000") {
        // Application-level error code — deterministic, don't retry.
        throw new Error(`gaokao.cn returned code=${body.code} message=${body.message} for ${url}`);
      }
      // Validate expected shape: `data` must be present, otherwise downstream
      // (.flatMap / .pro_type_min) crashes with an opaque undefined error.
      if (body.data == null) {
        throw new Error(`gaokao.cn response missing 'data' (code=${body.code}) for ${url}`);
      }
      writeCache(path, body.data);
      return body.data;
    } catch (err) {
      // AbortError → our timeout fired.
      if (err instanceof Error && err.name === "AbortError") {
        timedOut = true;
        lastErr = new GaokaoTimeoutError(url, timeoutMs);
      } else {
        lastErr = err;
      }

      // Non-retryable: plain Error that isn't a timeout (e.g. 4xx, bad code, missing data).
      const retryable = timedOut || lastErr instanceof RetryableError || isTransientNetworkError(err);
      if (!retryable || attempt === retries) {
        throw lastErr;
      }
      // Short backoff with jitter before the next attempt.
      await sleep(RETRY_BACKOFF_MS * (attempt + 1) + Math.floor(Math.random() * 100));
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies types.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Marker class for failures we're willing to retry (5xx, non-JSON bodies).
class RetryableError extends Error {}

// Heuristic: does the body start like a JSON document? Used as a fallback when
// the upstream omits/mislabels content-type but still returns valid JSON.
function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

// Treat low-level fetch/network errors (DNS, ECONNRESET, socket hang up) as transient.
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // undici surfaces these as TypeError("fetch failed") with a .cause.
  return err.name === "TypeError" && /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(
    `${err.message} ${(err as { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${(err as { cause?: { message?: string } }).cause?.message ?? ""}`
  );
}

// ---- Schema (a representative subset — many fields omitted for clarity) ----

export type SchoolInfo = {
  school_id: string;
  name: string;
  zs_code: string;             // 教育部 5-digit standard code (e.g. "10001")
  belong: string;              // 隶属 e.g. "教育部"
  province_name: string;
  city_name: string;
  town_name: string;
  level_name: string;          // 本科 / 专科
  type_name: string;           // 综合类 / 理工类 / ...
  nature_name: string;         // 公办 / 民办 / 中外合作办学
  dual_class_name: string;     // 双一流 / -
  f985: string; f211: string;  // "1" if yes, "2" if no
  rank: Record<string, string>;
  xueke_rank: Record<string, string>; // 第四轮学科评估 e.g. {"A+":"21","A":"11",...}
  xueke_pinggu?: Record<string, string>;
  pro_type_min: Record<string, Array<{ year: number; type: Record<string, string> }>>;
  // ^^ This is the gold field. Keyed by province_id; each entry has historical min scores per track.
  province_score_year: string;
  content: string;             // school intro snippet
  site: string;
  phone: string;
  address: string;
};

export type AdmissionPlanItem = {
  school_id: string;
  special_id: string;
  province: string;            // province id as string
  year?: string;
  type: string;                // track code (see TRACK_NAMES)
  zslx: string;                // 招生类型 (普通类/中外合作办学/...)
  zslx_name: string;
  batch: string;
  local_batch_name: string;    // 本科一批 / 本科批 / 提前批 / ...
  num: number;                 // 计划人数
  length: string;              // 学制 (四年/五年/...)
  tuition: string;             // 学费 (元/年)
  spcode: string;              // 6-digit 专业代码 (e.g. "080901")
  spname: string;              // full 专业名 (may include 备注 like "(智能信息处理方向)")
  sp_name: string;             // short 专业名
  info: string;                // 备注 e.g. "(国政、外交学、国际政经)"
  remark: string;
  level1_name: string;         // 本科(普通)
  level2_name: string;         // 学科门类 e.g. "工学"
  level3_name: string;         // 专业类 e.g. "计算机类"
  special_group: string;       // "0" if no group; otherwise group id (新高考 院校专业组)
  // Selected-subject requirement fields. Old-gaokao provinces leave these blank.
  sp_xuanke: string;           // single-major selected-subject requirement (raw)
  sp_fxk: string;              // 首选科目 (物理/历史 in 3+1+2)
  sp_sxk: string;              // 再选科目要求 (e.g. 化学;生物 任选1)
  sp_info: string;
  sg_xuanke: string;           // group-level variants of the same fields
  sg_fxk: string;
  sg_sxk: string;
  sg_info: string;
  sg_name: string;
  first_km: string;
};

export type AdmissionPlanResponse = {
  // The top-level keys look like "<level1>_<batch>_<other>" e.g. "2_7_0".
  // Each bucket has { numFound, item: AdmissionPlanItem[] }.
  [bucket: string]: {
    numFound: number;
    item: AdmissionPlanItem[];
  };
};

// Backward-looking actual admission outcomes (per-major).
// Distinct from AdmissionPlanItem (forward-looking — what's being offered).
export type AdmissionScoreItem = {
  school_id: string;
  special_id: string;
  province: string;
  type: string;                // track code
  zslx: string;
  zslx_name: string;
  batch: string;
  local_batch_name: string;
  spcode?: string;             // 6-digit 专业代码 (may be omitted/blank for 大类招生)
  spname: string;
  sp_name: string;
  info: string;
  remark: string;
  level1_name: string;
  level2_name: string;
  level3_name: string;
  special_group: string;
  // Outcome fields:
  max: number;                 // 最高分
  min: number;                 // 最低分
  average: number;             // 平均分
  lq_num: string;              // 实际录取人数
  min_section: string;         // 最低位次 (sometimes "-" for old-gaokao years)
  min_range: string;           // 分数段范围
  min_rank_range: string;      // 位次段范围
  range_max_rank: string;
  is_score_range: string;
  diff: number;                // 分差 (vs batch line)
  // Same xuanke / sg_* fields as plan items
  first_km: string;
  sp_type: string;
  sp_fxk: string;
  sp_sxk: string;
  sp_info: string;
  sp_xuanke: string;
  sg_fxk: string;
  sg_sxk: string;
  sg_type: string;
  sg_name: string;
  sg_info: string;
  sg_xuanke: string;
};

export type AdmissionScoreResponse = {
  // Bucket keys here look like "<type>_<batch>_<groupId>" e.g. "2074_14_156551".
  [bucket: string]: {
    numFound: number;
    item: AdmissionScoreItem[];
  };
};

// ---------------------------------------------------------------------------
// Dynamic API tier — api.zjzw.cn (掌上高考's app/web backend).
//
// WHY THIS EXISTS: as of 2026-06 the free static tier retired the per-school
// admission-plan and admission-score objects. Every
//   static-data.gaokao.cn/www/2.0/schoolspecialplan/{id}/{year}/{prov}.json
//   static-data.gaokao.cn/www/2.0/schoolspecialscore/{id}/{year}/{prov}.json
// now 404s at the OSS layer ("NoSuchKey"), for ALL years — not just 2026. Only
// /school/{id}/info.json survived (so the min-score corpus in school-index.json.gz,
// and therefore recommend/top/paiming, are unaffected). The granular per-major
// plan & score data moved to the dynamic host below, which:
//   • is UNSIGNED for GET (no signsafe/md5 needed — a version param actually breaks it),
//   • is keyed by local_province_id (the STUDENT's province), NOT the school's,
//   • paginates via size/page and reports the total in data.numFound,
//   • rate-limits aggressively → we serialize requests through a min-gap throttle.
//
// The item shapes come back field-compatible with the old static ones, modulo a
// few renames (score uses sp_scode not spcode; no top-level track `type`; num is
// a string) which mapPlanItem/mapScoreItem below normalize back to our types.
const DYNAMIC_BASE = "https://api.zjzw.cn/web/api/";
const DYNAMIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const PLAN_URI = "apidata/api/gkv3/plan/school";
const SCORE_URI = "apidata/api/gk/score/special";
const DYNAMIC_PAGE_SIZE = 50;
// Cap on pages fetched per (school, year, province) — a backstop against a
// runaway numFound. 50 pages × 50 = 2500 majors, far above any real school.
const DYNAMIC_MAX_PAGES = 50;
// Minimum gap between dynamic requests (ms). The host returns empty bodies under
// load (a silent rate-limit), which would masquerade as "school has no plan" —
// exactly the kind of silent miss we must never ship. Override via env.
const DYNAMIC_MIN_GAP_MS = (() => {
  const env = Number(process.env.GAOKAO_CN_DYNAMIC_GAP_MS);
  return Number.isFinite(env) && env >= 0 ? env : 250;
})();

// Raised when the dynamic host answers with a non-success application code
// (e.g. 1064 "接口请求版本不存在" = the endpoint moved again). Distinct type so
// callers/health-checks can tell "the API changed" apart from "no data".
export class GaokaoDynamicError extends Error {
  constructor(public uri: string, public apiCode: string, public apiMessage: string) {
    super(
      `gaokao.cn dynamic endpoint '${uri}' returned code=${apiCode} (${apiMessage}). ` +
        `The upstream API path likely changed again — update DYNAMIC_BASE/PLAN_URI/SCORE_URI in gaokao-cn.ts.`
    );
    this.name = "GaokaoDynamicError";
  }
}

// Global serializing throttle. Every dynamic request awaits the previous one plus
// a min gap, so a fan-out (the bulk pull runs concurrency 8) can't stampede the host.
let dynamicChain: Promise<void> = Promise.resolve();
let lastDynamicAt = 0;
function throttleDynamic(): Promise<void> {
  dynamicChain = dynamicChain.then(async () => {
    const wait = lastDynamicAt + DYNAMIC_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastDynamicAt = Date.now();
  });
  return dynamicChain;
}

// Fetch one page of a dynamic list endpoint. Returns { item, numFound }.
// `data: []` (as opposed to `{ item, numFound }`) is the host's shape for an
// empty result — mapped to numFound 0.
async function fetchDynamicPage(
  uri: string,
  params: Record<string, string | number>,
  opts: FetchJsonOpts = {}
): Promise<{ item: Array<Record<string, unknown>>; numFound: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("uri", uri);
  const url = `${DYNAMIC_BASE}?${qs.toString()}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttleDynamic();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": DYNAMIC_UA, Referer: "https://www.gaokao.cn/" },
        signal: controller.signal
      });
      if (!res.ok) throw new RetryableError(`gaokao.cn dynamic ${res.status} ${res.statusText} for ${url}`);
      const text = await res.text();
      let body: { code?: string; message?: string; data?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        throw new RetryableError(`gaokao.cn dynamic returned non-JSON for ${url}: ${text.slice(0, 160)}`);
      }
      if (body.code !== "0000") {
        // Application-level error — deterministic for this uri, don't retry.
        throw new GaokaoDynamicError(uri, body.code ?? "?", body.message ?? "");
      }
      const data = body.data;
      if (Array.isArray(data)) return { item: [], numFound: 0 };
      const item = Array.isArray((data as { item?: unknown })?.item)
        ? ((data as { item: Array<Record<string, unknown>> }).item)
        : [];
      const numFound = Number((data as { numFound?: unknown })?.numFound) || item.length;
      return { item, numFound };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        timedOut = true;
        lastErr = new GaokaoTimeoutError(url, timeoutMs);
      } else {
        lastErr = err;
      }
      const retryable = timedOut || lastErr instanceof RetryableError || isTransientNetworkError(err);
      if (!retryable || attempt === retries) throw lastErr;
      await sleep(RETRY_BACKOFF_MS * (attempt + 1) + Math.floor(Math.random() * 100));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Fetch every page of a dynamic list endpoint and concatenate the raw items.
async function fetchDynamicAll(
  uri: string,
  params: Record<string, string | number>
): Promise<Array<Record<string, unknown>>> {
  const first = await fetchDynamicPage(uri, { ...params, size: DYNAMIC_PAGE_SIZE, page: 1 });
  const out = first.item.slice();
  const total = first.numFound;
  const pages = Math.min(DYNAMIC_MAX_PAGES, Math.ceil(total / DYNAMIC_PAGE_SIZE));
  for (let page = 2; page <= pages && out.length < total; page++) {
    const next = await fetchDynamicPage(uri, { ...params, size: DYNAMIC_PAGE_SIZE, page });
    if (next.item.length === 0) {
      // An empty page WHILE items are still missing is the host's silent
      // rate-limit truncation, NOT a clean end-of-list. Surfacing it as an error
      // (rather than returning a short list) stops an undercounted result from
      // being cached/shipped as if the school simply had fewer majors.
      throw new GaokaoDynamicError(
        uri,
        "EMPTY_MID_PAGE",
        `page ${page} came back empty while only ${out.length}/${total} items fetched — suspected rate-limit truncation`
      );
    }
    out.push(...next.item);
  }
  return out;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 掌上高考's dynamic items carry local_type_name ("文科"/"物理"/…) rather than the
// numeric track `type` code the static tier used. Map it back so TRACK_NAMES lookups
// (and any track-based filtering) keep working.
const TRACK_CODE_BY_NAME: Record<string, string> = {
  理工: "1", 理科: "1",
  文史: "2", 文科: "2",
  综合改革: "3", 综合: "3", 不分文理: "3",
  物理类: "2073", 物理: "2073",
  历史类: "2074", 历史: "2074"
};
function trackCodeFromName(name: unknown): string {
  return TRACK_CODE_BY_NAME[str(name).trim()] ?? str(name);
}

// The dynamic tier writes "-" (and occasionally "") for 普通类/无特殊招生类型, whereas
// the old static tier returned the literal "普通类". Normalize it for DISPLAY so
// consumers don't surface a bare "-" (e.g. the pull's byZslx map keying 普通类 under
// "-"). The raw classification field (`zslx`) keeps "-" so isPutong() still matches.
function normZslxName(raw: unknown): string {
  const s = str(raw).trim();
  return s === "" || s === "-" ? "普通类" : s;
}

// provinceId is the query key (the student's 生源省) — the dynamic payload carries
// only local_province_name, no numeric id, so we thread the queried id in to keep
// the item's `province` field populated the way the static tier's was.
function mapPlanItem(r: Record<string, unknown>, provinceId: number | string): AdmissionPlanItem {
  const rawZslx = str(r.zslx ?? r.zslx_name);
  return {
    school_id: str(r.school_id),
    special_id: str(r.special_id),
    province: str(provinceId),
    year: r.year != null ? str(r.year) : undefined,
    type: trackCodeFromName(r.local_type_name ?? r.type),
    // Keep the raw "-" in zslx (the zhaosheng pull's isPutong() keys off zslx === "-");
    // expose a human label in zslx_name.
    zslx: rawZslx,
    zslx_name: normZslxName(r.zslx_name ?? rawZslx),
    batch: str(r.local_batch_id ?? r.batch),
    local_batch_name: str(r.local_batch_name),
    num: int(r.num),
    length: str(r.length),
    tuition: str(r.tuition),
    spcode: str(r.spcode ?? r.sp_scode),
    spname: str(r.spname),
    sp_name: str(r.sp_name),
    info: str(r.info),
    remark: str(r.remark),
    level1_name: str(r.level1_name),
    level2_name: str(r.level2_name),
    level3_name: str(r.level3_name),
    // API returns a NUMBER (0 or a group id). Old code compares `!== "0"`, so a raw
    // numeric 0 would be mis-read as a real group — always stringify.
    special_group: str(r.special_group ?? "0"),
    sp_xuanke: str(r.sp_xuanke),
    sp_fxk: str(r.sp_fxk),
    sp_sxk: str(r.sp_sxk),
    sp_info: str(r.sp_info),
    sg_xuanke: str(r.sg_xuanke),
    sg_fxk: str(r.sg_fxk),
    sg_sxk: str(r.sg_sxk),
    sg_info: str(r.sg_info),
    sg_name: str(r.sg_name),
    first_km: str(r.first_km)
  };
}

function mapScoreItem(r: Record<string, unknown>, provinceId: number | string): AdmissionScoreItem {
  const min = int(r.min);
  const proscore = Number(r.proscore); // 批次控制线; used to derive 分差 (the old `diff`)
  const rawZslx = str(r.zslx ?? r.zslx_name);
  return {
    school_id: str(r.school_id),
    special_id: str(r.special_id),
    province: str(provinceId),
    type: trackCodeFromName(r.local_type_name ?? r.type),
    zslx: rawZslx,
    zslx_name: normZslxName(r.zslx_name ?? rawZslx),
    batch: str(r.local_batch_id ?? r.batch),
    local_batch_name: str(r.local_batch_name),
    // dynamic score tier names it sp_scode, not spcode.
    spcode: r.sp_scode != null ? str(r.sp_scode) : r.spcode != null ? str(r.spcode) : undefined,
    spname: str(r.spname),
    sp_name: str(r.sp_name),
    info: str(r.info),
    remark: str(r.remark),
    level1_name: str(r.level1_name),
    level2_name: str(r.level2_name),
    level3_name: str(r.level3_name),
    special_group: str(r.special_group ?? "0"),
    max: int(r.max),
    min,
    average: int(r.average),
    lq_num: str(r.lq_num), // 录取人数 — not exposed by the dynamic tier; blank → downstream treats as 0
    min_section: str(r.min_section ?? "-"),
    min_range: str(r.min_range),
    min_rank_range: str(r.min_rank_range),
    range_max_rank: str(r.range_max_rank),
    is_score_range: str(r.is_score_range),
    diff: Number.isFinite(proscore) && proscore > 0 ? min - proscore : int(r.diff),
    first_km: str(r.first_km),
    sp_type: str(r.sp_type),
    sp_fxk: str(r.sp_fxk),
    sp_sxk: str(r.sp_sxk),
    sp_info: str(r.sp_info),
    sp_xuanke: str(r.sp_xuanke),
    sg_fxk: str(r.sg_fxk),
    sg_sxk: str(r.sg_sxk),
    sg_type: str(r.sg_type),
    sg_name: str(r.sg_name),
    sg_info: str(r.sg_info),
    sg_xuanke: str(r.sg_xuanke)
  };
}

// ---- Client ----

export async function getSchoolInfo(schoolId: number | string): Promise<SchoolInfo> {
  return fetchJson<SchoolInfo>(`/school/${schoolId}/info.json`);
}

// Options for the plan/score fetchers.
//   noCache — bypass BOTH the read and the write cache. Liveness probes (the
//   zhaosheng pull's canary) MUST set this: otherwise the probe can be answered
//   from a 24h-old disk entry (or the in-process memCache seeded by an earlier
//   probe) and reports "source alive" while the source is actually dark.
export type FetchListOpts = { noCache?: boolean };

// NOTE ON EMPTY RESULTS: the dynamic host silently degrades to an empty result
// (`code:0000, data:[]`) under rate-limiting, indistinguishable from a genuine
// "this school has no plan here". We therefore NEVER write an empty array to the
// cache — freezing a throttle-induced empty for 24h would durably poison the data
// (and read as 缩招). A real empty is rare and cheap to re-fetch.

// Per-school × per-year × per-province admission plan. Sourced from the dynamic
// tier (see the block above); non-empty results are cached under a synthetic key
// so the on-disk response cache still shares hits across CLI invocations.
export async function getAdmissionPlan(
  schoolId: number | string,
  year: number,
  provinceId: number | string,
  opts: FetchListOpts = {}
): Promise<AdmissionPlanItem[]> {
  const cacheKey = `dyn/plan/${schoolId}/${year}/${provinceId}`;
  if (!opts.noCache) {
    const hit = readCache(cacheKey);
    if (hit !== undefined) return hit as AdmissionPlanItem[];
  }
  const raw = await fetchDynamicAll(PLAN_URI, {
    school_id: schoolId,
    year,
    local_province_id: provinceId
  });
  const items = raw.map((r) => mapPlanItem(r, provinceId));
  if (!opts.noCache && items.length > 0) writeCache(cacheKey, items);
  return items;
}

export async function getAdmissionScores(
  schoolId: number | string,
  year: number,
  provinceId: number | string,
  opts: FetchListOpts = {}
): Promise<AdmissionScoreItem[]> {
  const cacheKey = `dyn/score/${schoolId}/${year}/${provinceId}`;
  if (!opts.noCache) {
    const hit = readCache(cacheKey);
    if (hit !== undefined) return hit as AdmissionScoreItem[];
  }
  const raw = await fetchDynamicAll(SCORE_URI, {
    school_id: schoolId,
    year,
    local_province_id: provinceId
  });
  const items = raw.map((r) => mapScoreItem(r, provinceId));
  if (!opts.noCache && items.length > 0) writeCache(cacheKey, items);
  return items;
}

// End-to-end source health probe. Verifies the surviving static endpoint AND the
// two dynamic endpoints we now depend on, so a future upstream move is caught by a
// single command rather than by silently-empty query results.
export async function checkSourceHealth(): Promise<{
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  try {
    const info = await getSchoolInfo(31);
    const ok = info.name === "北京大学" && !!info.pro_type_min;
    checks.push({ name: "static school/info.json (min-score corpus)", ok, detail: info.name });
  } catch (e) {
    checks.push({ name: "static school/info.json (min-score corpus)", ok: false, detail: errMsg(e) });
  }

  try {
    const plan = await getAdmissionPlan(31, 2024, 41); // 北大 × 河南 × 2024 — must be non-empty
    checks.push({ name: `dynamic 招生计划 (${PLAN_URI})`, ok: plan.length > 0, detail: `${plan.length} 专业` });
  } catch (e) {
    checks.push({ name: `dynamic 招生计划 (${PLAN_URI})`, ok: false, detail: errMsg(e) });
  }

  try {
    const scores = await getAdmissionScores(31, 2024, 41); // 北大 × 河南 × 2024 — must be non-empty
    checks.push({ name: `dynamic 录取分 (${SCORE_URI})`, ok: scores.length > 0, detail: `${scores.length} 专业分` });
  } catch (e) {
    checks.push({ name: `dynamic 录取分 (${SCORE_URI})`, ok: false, detail: errMsg(e) });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

// Convenience: historical min-score series for a given (school, province).
// Returns [{ year, track, minScore }] sorted by year descending.
export function extractHistoricalScores(
  info: SchoolInfo,
  provinceId: number | string
): Array<{ year: number; track: string; trackName: string; minScore: number }> {
  const entries = info.pro_type_min?.[String(provinceId)] ?? [];
  const out: Array<{ year: number; track: string; trackName: string; minScore: number }> = [];
  for (const e of entries) {
    for (const [track, score] of Object.entries(e.type ?? {})) {
      const min = Number(score);
      if (Number.isFinite(min) && min > 0) {
        out.push({
          year: e.year,
          track,
          trackName: track,
          minScore: min
        });
      }
    }
  }
  return out.sort((a, b) => b.year - a.year || a.track.localeCompare(b.track));
}
