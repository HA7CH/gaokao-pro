# 一分一段表 ingest sources (per province × year)

Manifest collected by a 25-agent parallel scan on 2026-05-22. **Most data
is locked in image/PDF format** on the official 省考试院 sites — the
agents could not text-extract. We list every confirmed source URL so a
future OCR/manual pass can rip them in batch.

Format of the JSON files: see `cli/src/rank-table.ts` `RankTable` type.
Land them at `cli/data/yifenyiduan/{province-pinyin}-{year}-{track}.json`.

## Status

| Province | 2024 物理/理 | 2024 历史/文 | 2024 综合 | Notes |
|---|---|---|---|---|
| 北京 | — | — | ✅ 2023/24/25 | from `scottli139/beijing-gaokao-score-segments` |
| 湖南 | 🔴 image | ✅ **partial 600-654** | — | history data from bendibao mirror |
| 河南 | 🔴 PDF | 🔴 PDF | — | heao.com.cn 出 PDF; aggregate-only |
| 山东 | — | — | 🔴 Excel | sdzk.cn xls download required |
| 广东 | 🔴 image | 🔴 image | — | eea.gd.gov.cn ZIP of PDFs |
| 江苏 | 🔴 image | 🔴 image | — | jseea.cn JPG 多张 |
| 河北 | 🔴 site-down | 🔴 site-down | — | hebeea.edu.cn 连不通 |
| 四川 | 🔴 image | 🔴 image | — | sceea.cn PNG |
| 安徽 | 🔴 unknown | 🔴 unknown | — | ahzsks.cn 内部页 |
| 湖北 | 🔴 image | 🔴 image | — | hbea.edu.cn JPG x5 |
| 浙江 | — | — | 🔴 PDF | zjzs.net 总分表 PDF |
| 福建 | 🔴 image | 🔴 image | — | eeafj.cn PNG |
| 江西 | 🔴 partial | 🔴 partial | — | jxeea.cn 403; 聚合站只给汇总 |
| 辽宁 | 🔴 timeout | 🔴 timeout | — | lnzsks.com 抓不动 |
| 重庆 | 🔴 timeout | 🔴 timeout | — | cqksy.cn 抓不动 |
| 上海 | — | — | 🔴 PDF | shmeea.edu.cn 高分段不公布 |
| 天津 | — | — | 🔴 unknown | zhaokao.net 抓不动 |
| 陕西 | 🔴 403 | — | — | sneac.com 反爬 |
| 山西 | 🔴 timeout | 🔴 timeout | — | sxkszx.cn 抓不动 |
| 广西 | ✅ 2024 sparse | — | — | gxeea.cn 一分一档系统; eol.cn 镜像 ingested |
| 贵州 | 🔴 image | — | — | gaokao.eol.cn 镜像 |
| 云南 | 🔴 only aggregate | — | — | gk100/eol 只给汇总 |
| 海南 | — | — | 🔴 image | ea.hainan.gov.cn 嵌图 (900 标准分) |

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
