// Province-bureau fallback adapters. Each module exports a stable interface
// for fetching that province's 一分一段表 from the official 考试院 source
// (or local extracted JSON, when no API exists upstream).
//
// Roadmap (verdicts from docs/data-sources.md):
//   🟢 广东 (eea.gd.gov.cn)        — ZIP+PDF, this round.
//   🟢 北京 (bjeea.cn)             — open-source CSV from ZE3kr/bjeea-bulk-query.
//   🟢 河北 (hebeea.edu.cn)        — Excel direct download.
//   🟢 江苏 (jseea.cn)             — PDF, clean format.
//   🟢 广西 (gxeea.cn)             — fully public HTML.
//   🟢 黑龙江 (lzk.hl.cn)          — no auth, HTML tables.
//   🟢 西藏 (zsks.edu.xizang.gov.cn)
//   🟡 + 22 more provinces — login or PDF-only.
//
// Only `guangdong` has a written adapter today; the rest are documented
// pointers in docs/data-sources.md.
export * as guangdong from "./guangdong.js";
