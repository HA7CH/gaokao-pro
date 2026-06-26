# 一分一段表 ingest sources (per province × year)

URL manifest at `cli/data/datasets/yifenyiduan-manifest.json` (year-verified,
93 records incl. all 31 provinces × 2026). The full source URLs are listed below.

> **复查指引**：每个已入库省份的 JSON(`cli/data/yifenyiduan/<省>-<年>-<轨>.json`)的
> `source_url` 字段即真实表来源；下方 2026 清单把每省的官方源 + eol/学信网 转载 + 状态都列齐，
> 便于人工或 AI 技能回原网站核对。**未入库省份也给了官方复查入口**（图片版需 OCR / 待发布）。

## 2026 来源清单（出分季实时维护）

### 全国聚合页（持续更新，复查首选）

| 聚合页 | URL | 说明 |
|---|---|---|
| **学信网·阳光高考**（教育部官方） | <https://gaokao.chsi.com.cn/gkxx/ss/202606/20260624/2293845984.html> | 《2026年部分省市高考分数段统计汇总（一分一段）（陆续发布）》。各省发布后**陆续加入**，直链官方源或 chsi 自托管页。**复查首选**。 |
| 中国教育在线 eol.cn | <https://www.eol.cn/e_html/gk/gkfsd/index.shtml> | 各省 eol 转载入口。某省仅占位锚点（无 202606 链接）= 该省 2026 未发布。slug：陕西=`shan_xi_sheng`、山西=`shan_xi`。 |

### 各省状态与来源（27 省已入库；含 OCR/ZIP 攻坚。仅 3 省尚未发布全表）

✅ 已入库（程序化抓取 + running-sum 不变式 + 独立复核通过）：

| 省 | 轨 | 来源（source_url） | 格式 |
|---|---|---|---|
| 北京 | combined | bjeea.cn `/html/gkgz/tzgg/2026/0624/88238.html`（+官方 PDF 文本层） | pdf_textlayer |
| 天津 | combined | zhaokao.net `/gkck/doc/003/000/115/00300011511_809a8ff0.pdf` | pdf_textlayer |
| 山东 | combined | sdzk.cn `NewsInfo.aspx?NewsID=7258`（夏季文化）/ eol `shan_dong/...2749145` | html_table |
| 辽宁 | 物/历 | lnzsks.com `/lnzkbfiles/2026/lns2026gkcjtjb0624clhptll01.pdf`(物)`...lw02.pdf`(历) | pdf_textlayer |
| 吉林 | 物/历 | jleea.com.cn 官方 PDF `/u/cms/www/2026/06/25/...pdf` | pdf_textlayer |
| 安徽 | 物/历 | ahzsks.cn `/ggl/8996.htm` → PDF `/pic/file/20260625/...335.pdf` | pdf_textlayer |
| 广西 | 物/历 | gxeea.cn `/2026yfyd/yifenyidang/2026_yifenyidang_wuli_qg.html`(物)`...lishi_qg.html`(历) | html_table |
| 陕西 | 物/历 | eol `shan_xi_sheng/...2749139`(物)`...2749134`(历) | html_table |
| 宁夏 | 物/历 | eol `ning_xia/...2749206`(物)`...2749197`(历)（横向多块累计制） | html_table |
| 重庆 | 物/历 | eol `chong_qing/...2748895`(物)`...2748900`(历) / 官方 cqksy.cn `.../yfd/fdb.htm` | html_table |
| 河北 | 物/历 | eol `he_bei/...2748920`（物理/历史并排） | html_table |
| 黑龙江 | 物/历 | eol `hei_long_jiang/...2748724`(物)`...2748730`(历) | html_table |
| 河南 | 物/历 | hfplg.com `/yfyd/373103q377.html`(物)`/yfyd/37w3102313.html`(历) / 官方 haeea.cn | html_table |
| 内蒙古 | 物/历 | eol `nei_meng/...2748908`(物)`...2748907`(历) / 官方 nm.zsks.cn `/fzlm/26gktj/` | html_table |
| 青海 | 物/历 | eol `qing_hai/...2749055`(物)`...2749052`(历)（投档类型前缀列） | html_table |
| 上海 | combined | shmeea.edu.cn `/download/20260623/2/0.pdf`（高分段不公布） | pdf_textlayer |
| 湖南 | 物/历 | eol `hu_nan/...2749349`(物)`...2749350`(历)（**含全国性加分**口径） | html_table |
| 江西 | 物/历 | eol `jiang_xi/...2749328`(物)`...2749332`(历) | html_table |
| 山西 | 物/历 | eol `shan_xi/...2749364`(物)`...2749365`(历)（左右双块版式） | html_table |
| 海南 | combined | eol `news/...2749368` 转 ea.hainan.gov.cn（标准分 100-900，全体考生投档成绩） | html_table |
| 贵州 | 物/历 | 官方 eaagz.org.cn ZIP 附件（下载解压后 ingest，640/561 行至 0 分） | zip |
| 江苏 | 物/历 | jseea.cn 官方 JPG → **OCR**（仅到本科线 456/484，江苏只发本科线以上） | ocr |
| 福建 | 物/历 | eeafj.cn 官方 JPG → **Apple Vision OCR**（471/454 行，逐值核对官方图） | ocr |
| 湖北 | 物/历 | hbea.edu.cn 官方 PNG → **Apple Vision OCR**（3 竖块，553/526 行） | ocr |
| 广东 | 物/历 | eol `guang_dong/...2749371`(物)`...2749373`(历) 5列文本表，取 col2=累计本科 | html_table |
| 四川 | 物/历 | sceea.cn 官方 JPG → **OCR**（Vision 分数列 + tesseract 累计列，535/514 行） | ocr |
| 云南 | 物/历 | eol `yun_nan/...2749515` 官方单 PNG → **Vision OCR**（窄带分列，504/482 行） | ocr |

> 🔬 **OCR 入库的（江苏/福建/湖北/四川/云南）**：官方全网仅图片、无文本表。流程＝放大 + Apple Vision / tesseract 多引擎 OCR → 按坐标重建 [分数\|人数\|累计] → running-sum + 严格递减 + 累计单调不变式门 → 独立 verify agent **重下官方图逐值核对锚点**（福建 18+ 锚点吻合、湖北特控线 2025 映射精确吻合、四川本科 435→218562/455→77300 命中 hfplg、云南确认 2026 非旧表，均跨年 ±30% 内）。工具：`_ocr-pipeline/vision-ocr.swift`。

⏳ **仍未发布全表（最近核查仅出分数线，预计 7 月初）**——给官方复查入口：

| 省 | 官方复查入口 | eol 频道 | 备注 |
|---|---|---|---|
| 浙江 | zjzs.net `/col/col45/index.html`（复查 id>12449） | `zhe_jiang/dongtai/` | 总分分数段表多为 PDF |
| 甘肃 | ganseea.cn | `gan_su/dongtai/` | 2025 是 7/2 发 |
| 新疆 | xjzk.gov.cn `/gkgz/ptgk/tzgg/` | `xin_jiang/dongtai/` | 老高考文/理；随志愿填报发 |

> 西藏：官方不发布逐分一分一段表，仅发各批次最低控制分数线，`rank` 列保持"不支持"。

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
