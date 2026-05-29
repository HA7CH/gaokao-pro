# Special Admissions — 3 Year Coverage (2023/2024/2025/2026)

每个文件是一个省级行政区的 3 年特殊招生数据(艺术统考 / 体育统招 / 体育单招 / 强基 / 综评 / 民族 / 港澳台双向通道)。

**Status (iter 2)**: **34/34 written ✅**

## 34 Region Files

### 31 Mainland

| Code | Region | File | Status |
|---|---|---|---|
| 11 | 北京 | [`beijing.md`](./beijing.md) | ✅ |
| 12 | 天津 | [`tianjin.md`](./tianjin.md) | ✅ |
| 13 | 河北 | [`hebei.md`](./hebei.md) | ✅ |
| 14 | 山西 | [`shanxi.md`](./shanxi.md) | ✅ |
| 15 | 内蒙古 | [`neimenggu.md`](./neimenggu.md) | ✅ |
| 21 | 辽宁 | [`liaoning.md`](./liaoning.md) | ✅ |
| 22 | 吉林 | [`jilin.md`](./jilin.md) | ✅ |
| 23 | 黑龙江 | [`heilongjiang.md`](./heilongjiang.md) | ✅ |
| 31 | 上海 | [`shanghai.md`](./shanghai.md) | ✅ |
| 32 | 江苏 | [`jiangsu.md`](./jiangsu.md) | ✅ |
| 33 | 浙江 | [`zhejiang.md`](./zhejiang.md) | ✅ |
| 34 | 安徽 | [`anhui.md`](./anhui.md) | ✅ |
| 35 | 福建 | [`fujian.md`](./fujian.md) | ✅ |
| 36 | 江西 | [`jiangxi.md`](./jiangxi.md) | ✅ |
| 37 | 山东 | [`shandong.md`](./shandong.md) | ✅ |
| 41 | 河南 | [`henan.md`](./henan.md) | ✅ |
| 42 | 湖北 | [`hubei.md`](./hubei.md) | ✅ |
| 43 | 湖南 | [`hunan.md`](./hunan.md) | ✅ |
| 44 | 广东 | [`guangdong.md`](./guangdong.md) | ✅ |
| 45 | 广西 | [`guangxi.md`](./guangxi.md) | ✅ |
| 46 | 海南 | [`hainan.md`](./hainan.md) | ✅ |
| 50 | 重庆 | [`chongqing.md`](./chongqing.md) | ✅ |
| 51 | 四川 | [`sichuan.md`](./sichuan.md) | ✅ |
| 52 | 贵州 | [`guizhou.md`](./guizhou.md) | ✅ |
| 53 | 云南 | [`yunnan.md`](./yunnan.md) | ✅ |
| 54 | 西藏 | [`xizang.md`](./xizang.md) | ✅ |
| 61 | 陕西 | [`shaanxi.md`](./shaanxi.md) | ✅ |
| 62 | 甘肃 | [`gansu.md`](./gansu.md) | ✅ |
| 63 | 青海 | [`qinghai.md`](./qinghai.md) | ✅ |
| 64 | 宁夏 | [`ningxia.md`](./ningxia.md) | ✅ |
| 65 | 新疆 | [`xinjiang.md`](./xinjiang.md) | ✅ |

### 3 Special Regions

| Code | Region | File | Status |
|---|---|---|---|
| 71 | 台湾 | [`taiwan.md`](./taiwan.md) | ✅ |
| 81 | 香港 | [`hongkong.md`](./hongkong.md) | ✅ |
| 82 | 澳门 | [`macau.md`](./macau.md) | ✅ |

## File Structure (uniform 10-section template)

1. 高考改革节点(老/新高考时间线)
2. 艺术统考(6 大类公式 + 合格线 + 文化控制线 × 3 年)
3. 体育统招(公式 + 合格线 + 文化控制线 × 3 年)
4. 体育单招本省考点 + 招生校
5. 强基计划(39 校在本省 3 年 + 入围线)
6. 综评(本省综评校 + 公式 + 入围线 × 3 年)
7. 民族政策(加分梯度 + 民族班/预科,3 年趋势)
8. 数据源(URL list)
9. 数据稳定性(高/中/低)
10. 入库建议(JSON 文件名 + Schema)

港澳台特殊地区额外:
- 双向通道(联招 / 居住证 / 港校独立 / 学测 / DSE 互认)
- 政策时间线(尤其台湾方向 B 自 2020 暂停)
- 内地办学子集(港中大深圳/港科大广州/港大深圳 归入 44 广东)

## Cross-Cutting Findings (across 34 regions)

**新高考时间分布**:
- 2017 首届: 沪 31, 浙 33
- 2020 首届: 京 11, 津 12, 鲁 37, 琼 46(后者 + 900 制独有)
- 2021 首届: 苏 32, 粤 44, 闽 35, 鄂 42, 湘 43, 辽 21, 渝 50, 冀 13
- **2024 首届(8 省)**: 桂 45, 赣 36, 皖 34, 黔 52, 吉 22, 黑 23, 甘 62, 青 63, 宁 64(实为 9 省)
- **2025 首届(7 省)**: 晋 14, 川 51, 陕 61, 豫 41, 云 53, 黑 23(注: 黑 24/25 表述有歧义), 江西 36 也 2024 首届
- 2026 首届: 蒙 15
- 2027 首届: 新 65
- 仍 old + 双线: 藏 54

**艺术综合分公式聚类**:
- 50/50 全统一: 京、津、皖、闽、赣、苏(美书 6:4 异常)、新、青(播音例外)、宁、川、海、滇
- 6 类分多套: **河南 5 选 1**(全国最复杂) / **湖北 3 套**(独有 ×2 还原) / 辽宁(百分制再加权,独有口径)
- 2025 取消省线: **云南**(全国独有)

**体育统招公式聚类**:
- 直接相加: 湖南 / 青海(无加权)
- 按专业课投档: 陕西 / 甘肃(全国少数)
- 总系数 1.25: 湖北独有
- 按高考总分: 海南
- 本/专合一 73: 重庆 2025 新政

**综评活跃**(招生量排序):
1. 浙江 39 校三位一体(独有学考)
2. 江苏 23 校 A/B 类
3. 上海 11 校(85%+15%,2242 人)
4. 山东 11 校(85%+15% 省规)
5. 广东 11 校(2964 人)
6. 北京/福建 7 校(全外省)
7. 其他 24 省 0 本省校

**民族政策走势**:
- 全面取消: 河南(2024)、江西(2025)
- 退坡中: 宁夏 (24 大改)、贵州(一类区 24 取消)、甘肃(非两州五县 26-28 降,29 取消)、福建(26 取消)、辽宁(满蒙自治县 26 取消)
- 保留特色: 西藏(双联户 +10、进藏干部 +1/年)、新疆(单列类 +15)、甘肃(两州五县 +20 全国最高)、广西(三统一 +15)

## Sibling: see `../coverage-tracker-special-admissions.md` for overall progress (research/disk/schema/CLI four columns).
