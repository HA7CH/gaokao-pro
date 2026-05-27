# 一分一段表 ingest sources (per province × year)

URL manifest at `cli/data/datasets/yifenyiduan-manifest.json` (year-verified,
62 records). The full source URLs are still listed below for the OCR backlog.

## Ingest pipeline (built 2026-05-26)

`_ocr-pipeline/ingest-html.py` fetches an official HTML 一分一段表, parses the
分数/人数/累计人数 table, and **only writes if it passes three hard gates**:
(1) ≥20 rows, (2) running-sum integrity — Σ人数 == 累计人数 at every row (makes
fabrication mechanically impossible), (3) track-identity — the page `<title>`
must name the expected track. A published "N人超X分" figure is cross-checked as
a soft confirmation. `ingest-html.py --trust-cumulative` handles "cumulative-only" tables (2-col
分数/累计人数) and top-suppressed tables: it takes the canonical `cumulative`
(位次) verbatim and derives `count` from it. `_ocr-pipeline/normalize-counts.py`
likewise recomputes the (unused, provenance-only) `count` column from
`cumulative` for legacy OCR files, never touching the served 位次 values.

Every shipped file is guarded by `cli/test/yifenyiduan-integrity.test.ts`
(running-sum + strictly-descending scores + monotonic cumulative on all 108
files). The product serves only the `cumulative` column (= 位次), via
`scoreToRank`/`rankToScore`.

## Status (updated 2026-05-26)

**64 of 108 files are FULL per-score tables (≥100 rows); the rest are
integrity-clean coarse tables** (10-pt steps / partial) kept as fallback.
Full-table coverage now includes: 北京, 安徽, 重庆, 福建, 湖北, 湖南, 河南(2025),
陕西, 河北(2024), 内蒙古(2024 + 2025), 山西(2025), 山东, 广东, 浙江(2025),
上海(2025), 天津(2025), 辽宁(2025), 黑龙江(2025), 江苏(2025 物理), 江西(2025 物理),
云南(2025), 贵州(2025 物理), 海南(2025), 广西(2024 + 2025, via --trust-cumulative),
甘肃(2024), 四川(2024 理 / 2025 物理) …

**Still needs OCR (image/PDF-only sources, served coarse for now):** most
老高考 2024 文/理 tables (河南/宁夏/青海/山西/四川文/新疆/云南/甘肃史), several
2024 3+1+2 history pages published as images (辽宁/江西/江苏/广东史), 吉林 2024
(official format is a tens×ones cross-tab grid, not a per-row table), 贵州 2024
(image), 海南 2024 (900 标准分, 嵌图), and assorted 2025 history/pdf pages
(河北/湖北史/吉林史/宁夏史/青海/四川史). The 河南 2024 文/理 PDF is a scanned
image (no text layer) with a 3-column-pair layout — needs per-column OCR
segmentation + digit correction, validated through the running-sum gate.

## Verified source URLs

### 河南 2024
- 物理类: <https://gaokao.eol.cn/he_nan/dongtai/202406/t20240625_2619064.shtml>
- 历史类: <https://www.haeea.cn/attach/file/20240625/20240625065630_6245_ee332a1d.pdf>

### 山东 2024 (3+3 综合)
- xls 下载: <https://www.sdzk.cn/NewsInfo.aspx?NewsID=6577>

### 广东 2024
- 物理类: <https://gaokao.eol.cn/guang_dong/dongtai/202406/t20240626_2619547.shtml>
- 历史类: <https://gaokao.eol.cn/guang_dong/dongtai/202406/t20240626_2619545.shtml>
- 官方 ZIP (2025): <https://eea.gd.gov.cn/attachment/0/583/583759/4734345.zip>

### 江苏 2024
- 全省总分逐分段: <https://www.jseea.cn/webfile/index/index_zkxx/2024-06-24/7210960924591525888.html>

### 河北 2024
- 历史类 (聚合): <https://gaokao.eol.cn/he_bei/dongtai/202406/t20240625_2619073.shtml>
- 官网: <http://www.hebeea.edu.cn/>

### 四川 2024
- 理科: <https://www.sceea.cn/Html/202406/Newsdetail_3742.html>
- 文科: <https://www.sceea.cn/Html/202406/Newsdetail_3743.html>

### 湖北 2024
- 首选物理: <https://www.hbea.edu.cn/html/2024-06/14293.html>
- 首选历史: <http://www.hbea.edu.cn/html/2024-06/14291.html>

### 湖南 2024
- 物理类: <https://gaokao.eol.cn/hu_nan/dongtai/202406/t20240625_2619096.shtml>
- 历史类: ✅ ingested (see `cli/data/yifenyiduan/hunan-2024-history.json`) — source <https://m.cs.bendibao.com/edu/121234.shtm>

### 浙江 2024
- 总分分数段: <https://www.zjzs.net/art/2024/6/26/art_45_9753.html>

### 福建 2024
- 物理类: <https://www.eeafj.cn/gkptgkgsgg/20240625/13485.html>
- 历史类: <https://www.eeafj.cn/gkptgkgsgg/20240625/13486.html>

### 江西 2024
- 物理类 (聚合): <https://gaokao.eol.cn/jiang_xi/dongtai/202406/t20240626_2619468.shtml>
- 历史类 (聚合): <https://gaokao.eol.cn/jiang_xi/dongtai/202406/t20240626_2619467.shtml>

### 辽宁 2024
- <https://www.lnzsks.com/newsinfo/IMS_20240624_44046_Zy6XwhnIQA.htm>

### 重庆 2024
- <https://www.cqksy.cn/>

### 上海 2024 (3+3 综合)
- 成绩分布表: <https://www.shmeea.edu.cn/page/02200/20240623/18612.html>

### 天津 2024 (3+3 综合)
- <http://www.zhaokao.net/>

### 陕西 2024
- 理科一分段: <https://www.sneac.com/info/1019/17786.htm>

### 山西 2024
- 文科: <http://www.sxkszx.cn/news/2024624/n3849122419.html>
- 理科: <http://www.sxkszx.cn/news/2024624/n3013122420.html>

### 广西 2024
- 一分一档系统: <https://www.gxeea.cn/2024yfyd/index.html>

### 贵州 2024
- <https://gaokao.eol.cn/gui_zhou/dongtai/202406/t20240625_2619419.shtml>

### 云南 2024
- 聚合: <https://www.gk100.com/read_5255371.htm>

### 海南 2024 (3+3 综合, 900 标准分)
- <https://ea.hainan.gov.cn/ywdt/ptgkyjszsb/202406/t20240625_3686145.html>

## Ingest pipeline (recommended)

For each province above the simplest path is:

```bash
# 1. Download
curl -O "<source-url>"

# 2. If PDF/image: tabula-py or pdftotext + manual cleanup
pdftotext -layout in.pdf out.txt

# 3. If Excel: pandas
python -c "import pandas as pd; df=pd.read_excel('in.xls'); print(df.to_json(orient='records'))"

# 4. Normalize to RankTable schema and drop at:
#    cli/data/yifenyiduan/{province-pinyin}-{year}-{track-key}.json
```

Track keys: `physics` / `history` / `combined` / `science` / `liberal`.
