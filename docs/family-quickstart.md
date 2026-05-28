# 家庭使用指南 — 特殊招生(v0.2.0)

为艺术 / 体育 / 强基 / 综评 / 港澳台 / 民族班家庭准备的快速上手。

## 装

```bash
npx gaokao-pro@latest help
```

或全局:
```bash
npm install -g gaokao-pro
```

## 5 个最常见的家庭场景

### 场景 1:艺术生(美术/音乐/舞蹈/书法/播音/表导演)

**Q: 我是河南考生,想读美术专业,2025 综合分怎么算?**

```bash
gaokao-pro art-tongkao --province 河南 --category 美术与设计 --year 2025
```

返回 5 种公式选择(河南 5 选 1,默认⑤:文化 × 50% + 专业 × 1.25)+ 合格线 + 文化控线。

**Q: 我是天津美术生,2023 和 2024 公式变化了吗?**

```bash
gaokao-pro art-tongkao --province 天津 --category 美术与设计 --year 2023
gaokao-pro art-tongkao --province 天津 --category 美术与设计 --year 2024
```

会显示 2024 是天津艺考"大改革"分水岭(从 40/60 → 50/50)。

### 场景 2:体育生

**Q: 我在湖南想报体育,投档分怎么算?**

```bash
gaokao-pro sports-tongzhao --province 湖南 --year 2025
```

返回 `kind: "additive"` — 湖南独特"直接相加"口径(文化 + 专业 = 1050,不加权)。

**Q: 不同省体育公式差别大吗?**

| 省份 | kind | 特点 |
|---|---|---|
| 多数省 | weighted | 综合 = 文化 × p1 + 专业 × factor × p2 |
| 湖南 / 青海 | additive | 文化 + 专业 直接相加 |
| 陕西 / 甘肃 | professional_first | 按专业课成绩投档 |
| 海南 | gaokao_only | 双线达标后按高考总分 |
| 重庆 2025 | merged_specline | 本/专专业线合一 73 |
| 湖北 | weighted | 1.25 系数 全国独有 |

### 场景 3:强基计划

**Q: 清华 2025 在北京招几人?**

```bash
gaokao-pro qiangji-line --school 清华大学 --province 北京 --year 2025
```

返回招生量 + 入围线 + 入围倍数。

**Q: 我在甘肃,强基有没有特殊门槛?**

```bash
gaokao-pro qiangji-line --province 甘肃 --year 2025
```

会标注 `west_75pct_threshold: true` — 甘青宁新四省考生文化分门槛是 75%(其他省 80%)。

**Q: "报名即入围"是哪些校?**

返回 `ruwei_ratio: "all"` 的就是 — 通常包括复旦/上交/南大/浙大/中科大/西交/同济/厦大/北航/兰大/人大/东大 等 12 校(高考出分前校测)。

### 场景 4:综合评价

**Q: 浙江三位一体 vs 普通综评有什么区别?**

```bash
gaokao-pro zonghe --province 浙江 --year 2025
```

返回 `is_sanweiyiti: true` 的所有 39 校 — 浙江独有"含学考维度"(占 10-20%)。

**Q: 上海 11 校综评公式一致吗?**

```bash
gaokao-pro zonghe --province 上海 --year 2025
```

会显示 11 校统一 `gaokao_pct: 85` + `xiaoce_pct: 15`(上海/山东省规)+ 各校 3 年入围线。

### 场景 5:港澳台 / 民族班

**Q: 港籍学生 2025 联招分数线?**

```bash
gaokao-pro qatw 香港 --channel 全国联招 --year 2025
```

返回 2025 暴涨线(本科普通 文 430/理 460,+65/+70 vs 2024)+ 港籍报名数 9805(+15%)。

**Q: 我是广西壮族,2025 加多少分?**

```bash
gaokao-pro minzu --province 广西 --year 2025
```

返回多档梯度:
- 10 世居少民 + 5 市城区以外:+15(三统一)
- 28 自治县/边境县少民:+15
- 22 山区县少民:+7
- 其他区内少民:+5
- 5 市城区少民:+3

## 配合 Claude / Codex / Cursor 使用

把这段 prompt 粘进 Claude Code:

```
跑 `npx gaokao-pro@latest help` 摸清命令,然后帮我规划 2026 高考志愿。

先问我:身份(普通类/艺术类/体育类/强基/综评/港澳台/民族班)、分数、省份、
选科组合、目标专业方向、偏好(城市/985/学费)。

对应通道:
- 普通类:用 recommend/top/find/match
- 艺术类:用 art-tongkao 查公式,actual 查录取分
- 体育类:用 sports-tongzhao 查公式
- 强基:用 qiangji-line 查招生量 + 入围线
- 综评:用 zonghe 查校单 + 公式
- 港澳台:用 qatw 查通道
- 民族班:用 minzu 查加分

每条推荐用 CLI 拉真实数据支撑。
```

## 数据来源

- 31 mainland 省考试院官方文件 + 阳光高考(gaokao.chsi.com.cn)
- 港澳:港府 EDB / 澳门高教局 + 各港校/澳校官方招生网
- 台湾:海峡两岸招生服务中心 / 教育部学生服务中心

源 markdown 在 `docs/special-admissions-3year/{pinyin}.md`,每条 record 标 `data_source[]` + `confidence`(high/medium/low)。

## 覆盖度

```bash
gaokao-pro special-coverage
```

显示 18 个 dataset 各自的 record 数 + 覆盖 region 数。当前(v0.2.0)总计 **1,497 records**,覆盖 34 regions × 6 categories × 3 years。

## 已知 N/A 缺口

- 青海 2025 艺术 6 类合格线(省考试院 PDF 未文本化)
- 天津 2023-2025 强基分校精确名额(只有总盘)
- 江苏 B 类综评录取分(11 校中仅 4 校公开)
- 福建厦大 2025 强基新增 24 人(数据源不一致,简章口径以阳光高考为准)

详见 `docs/coverage-tracker-special-admissions.md` P4 章节。
