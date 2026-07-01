# Changelog

## 1.0.2 — 2026-06-30（数据源迁移：招生计划/录取分）

`static-data.gaokao.cn` 退役了 `schoolspecialplan`/`schoolspecialscore` 静态对象（所有年份 OSS `NoSuchKey`）。

- **fix**：`getAdmissionPlan`/`getAdmissionScores` 改走掌上高考动态 API `api.zjzw.cn`（免签 GET，按 `local_province_id` 键控：plan=`gkv3/plan/school`、score=`gk/score/special`），含分页 + 节流 + 字段映射回原类型。`school/info.json`（→ `pro_type_min` → recommend/top/paiming）不受影响。
- **hardening**：动态源限流时降级成 `code:0000 data:[]`（与"真无数据"无法区分）→ 空结果不进缓存、分页中途空页抛错；`selftest` 加动态源健康 stage。
- **⚠️ 已知限制**：该动态源会屏蔽数据中心 IP（CI / 云端返回空）；家用宽带 IP 正常。

## 0.3.17 — 2026-06-10（出分季生产体检）

高考结束当天的全面体检：数据、协议、输入容错三层校正（多智能体审查 + 程序化数据验证）。

### data — 39 张一分一段表逐分全量化

每张均程序化解析 + 不变式断言 + 官方锚点交叉验证（零手抄）：

- **2025 年表（2026 届核心参照）全部转全量**：河北物理 3→554 行/历史 14→533（此前查 550 分误差可达数万位次）；四川物理整表重提取 543 行（修 OCR 整行漏 16 个分数 + 519/506 两处十位数字误读，55zs 独立镜像核实）；四川历史 8→515；广东历史 42→573（gk100+本地宝双源逐行零差异）；湖北历史 28→650（并修旧 checkpoint benke_442 本身错误，官方 442→50955）；江苏/辽宁/吉林/甘肃/宁夏/贵州/江西/青海×2 历史类全部全量化。
- **2024 年表 18 张**：吉林双轨经 web.archive.org 找回官方已 404 的 xls 逐格核验全等并修 3 处旧 checkpoint；贵州历史旧表 22 锚点全不符官方（疑似编造），新表=官方 PDF 文本层+hfplg 485/485 全等；上海修 10 处转录错位（官方 PDF+eol 双源 217 行零差异）；海南（900 标准分）修 7 处区间端点误读；江苏/辽宁/黑龙江/江西/新疆/天津/浙江双轨全部双源核验。
- 湖南 4 表 note 注明「含全国性加分」口径；河南 2024 理科 610 行（文理上线人数与官方「一本 155883 人」精确互证）；广东 2024 历史官方 PDF 文本层 566 行。
- 未动 9 张 2024 老高考末届粗表（山西/云南/四川文/宁夏/青海）——该轨道对 2026 届新高考考生已不存在。

### data — 专项数据集事实修正（均经官方源核实）

- qiangji-2024：修 8 校出入 → 与教育部官方 39 校名单零差异（删北科大/矿大/地大武汉/合工大，补中国农大/中央民大/东北大学/西农）
- schools-adapters：修 5 处张冠李戴/虚构院校代码（上海大学 11903→10280、上科大→14423、哈工深→10213、华电→10054、国防科大→91002）
- employment-2024：修中科大深造率分母混淆（82.27% 官方口径）、北化工 2 处、华东师大补口径注明
- junjing-jingxiao：更新 2025 年 22 所军校编制（陆军兵种大学等新组建/转隶，4 所停招单列）+ 南京警察学院/郑州警察学院等更名
- zhongwai-hezuo：港科广学费 4.5万→10万/年（2025 级官方）、昆杜 19万、港中深 14万、UIC 更名北师香港浸会大学

### fix — MCP 协议合规 + CLI 输入容错

- MCP：无 id 通知一律不回响应（原对 notifications/cancelled 回 id:null -32601，违反 JSON-RPC 2.0）；工具执行错误改 isError 工具结果（LLM 可见可自纠）；未知工具 -32602；单次输出截断 60KB 防客户端 25k token 上限整体拒收；recommend 默认 limit 20/桶、find 默认 50；请求并发处理（慢工具不再阻塞 ping）
- CLI：rank 的 --score/--rank 非数字明确报错（不再输出「分数 NaN 低于…」）；--limit 统一校验（原 NaN 静默返回全部行、裸 --limit 变 1）；--subjects 接受全角逗号/顿号；省份接受「河南省/北京市/广西壮族自治区」全称
- probe：瞬时失败 >max(50,5%) 拒绝写索引（防限流时静默产出残缺索引）；原子写（tmp+rename）；默认 --end 3000→6000（实际 id 空间超 3000，旧默认静默丢约 700 校）
- provinces/guangdong.ts：修死代码 rankToScore 反向循环

### infra

- CI 新增 tag 触发 publish 工位（版本与 tag 强校验）——唯一许可发版路径，杜绝 0.3.12 式「发布自已删 worktree、gitHead 不可达」事故复发
- install.sh：Node>=18 前置检查、pull 失败修复指引
- docs/ops-2026-chufen.md：6/25 出分日逐省抓取源与发版预案（约 20 省当天出分，6/26 24:00 前 2026 表必须可查）
- README/落地页口径对齐（30 省一分一段、3145 校）


## 0.3.16 — 2026-05-31

### data — employment-outcomes 深度重构 (45 top 校官方报告核对)
5-agent 逐校联网核对 **2024届本科就业质量报告**，重构 45 所 top 校的 `baoyan/domestic/abroad/direct`。**根因**：多校 `domestic_grad_school_pct`(国内升学) 被填成了**总深造率(含出国)** → domestic 虚高、abroad 虚低（如湖南大学 48 实为总深造 47%，真境内升学 38）。
- **修 27 校**（整条替换，全部 domestic+abroad+direct≤100 且 domestic≥baoyan，256 校平衡校验通过）：北大/复旦/上交/中科大/哈工大/天大/湖南/电子科大/西农/北邮/中国政法（高可信，官方明示）+ 北航/北理工/中国农大/北师大/南开/同济/中南/重庆/中央财经/西电/华东师大/南科大/上财/西南财（中可信，权威转载/小推算）。
- **未改 18 校**：官方只给总深造率/图片PDF/反爬/仅旧年份 → 保留现值（清华/浙大/南大/人大/武汉/华科/中山/兰州 等）。
- 详见 `docs/validation-2026-05-31.md` Round 5。

## 0.3.15 — 2026-05-31

### perf — `top --enrich`
- `top --enrich --year <y>`: 离线算 top-N 后，**一次并行**拉每校真实 录取min/max/最低位次 附到结果（隐含 JSON 输出）。一句话拿到"够得着的学校 + 真实录取数据"，省去逐校 `actual`。无该省该年数据的学校（军校/特殊类）优雅降级为 `(no data)`。

### data — 数据集真实性校验 round 4
5-agent 联网核查 per-province pass 漏掉的手写数据集，修正客观错误：
- **city-tier**: 厦门/大连/济南/昆明 "新一线"→"二线"（第一财经 15 城名单不含；原标 16 个新一线结构不可能）；厦门误挂的福州大学移回福州。
- **mistake-zone**: 公安体测长跑 1500m→男1000m/女800m（1500 是军校）；高水平运动队 2024 文化线 "一本/特控"→普通类本科线（双一流本科线/其他校80%）；港中深 11.5万→14万（2025 入学）；北师大珠海"转公办"→2024 终止办学。
- **family-budget**: income 分位来源把"人均可支配收入"误标"家庭年收入"、p95/p99 非统计局发布 → 改注为样本估算。
- 已核但**未改**（字段耦合需整体重算）：employment 各校升学/出国率（domestic+abroad+direct≈100 内部平衡）、kaogong 税务局 posts_pct（24008人误当24%，序列凑100）— 详见 `docs/validation-2026-05-31.md`。
- 缺口**不杜撰**：西藏一分一段表（考试院 PDF 数百行，无法联网如实转录）。

## 0.3.14 — 2026-05-31

### perf — 查询提速 (网络是唯一瓶颈)
profiling 显示离线 verb 全部 <0.15s, 慢的只有打 gaokao.cn 的网络调用 (1-3s/次)。

- **响应缓存** (`gaokao-cn.ts` `fetchJson` 唯一入口): 按 path 缓存到内存(暖进程) + 磁盘(`~/.cache/gaokao-pro/http`, 跨 CLI 调用共享)。gaokao.cn 是免鉴权静态历史数据, 同 path 永远同结果 → 重复 `school/plan/actual/scores` 调用从 ~1-2s 降到 **~0.11s (≈9×)**。默认 TTL 24h (当季数据隔天刷新), `GAOKAO_CN_NO_CACHE=1` / `GAOKAO_CN_CACHE_TTL_MS=0` 旁路, `GAOKAO_CN_CACHE_DIR` 改位置。probe 与 smoke 测试强制旁路 (拿活数据)。
- **`batch` verb**: 一次并行拉多校真实录取数据 (替代对候选名单逐校串行调 `actual`)。5 校冷启 **1.28s** (vs 串行 ~6.5s+), 命中缓存 **0.11s**。返回每校 min/max/最低位次/专业数 紧凑摘要, 供快速冲稳保分流。
- **`cache` verb**: `cache info` / `cache clear` 查看与清空缓存。
- help + README 提示 AI 优先 `recommend`/`top`(离线筛) → `batch`(并行拉真数据), 别逐校反复 `actual`。

真实性: 缓存的是接口原样返回的字节(无转换), 过去年份数据不可变; 当季数据由 24h TTL + `cache clear` 兜底。

## 0.3.13 — 2026-05-31

### 31-省真实性校验 (93-agent 分省核查) + 数据修复
机械层干净: 一分一段表 108 文件内部一致性全通过; school-index ↔ live gaokao.cn API 31 省抽查校名/代码/id 全一致。手写政策/特殊招生数据修复 (均经官方来源核实 + 断言现值匹配才改, 详见 `docs/validation-2026-05-31.md`):

- **艺术/体育综合分公式**: 北京 `pro_factor` 2.2→2.5 (满分750/300, 误用上海值); 黑/晋/蒙/黔 播音公式; 津 戏剧表演控制线 313→357; 粤/桂 统考线 (广西本科线此前误填高职高专线); 苏 体育满分300→150; 豫 术科每项100→50; 鄂/湘 体育控制线。
- **赋分制描述**: 3+1+2 各省 "5 等 21 级"→"5 等 A-E 等比例换算" (30-100 区间无法等分21级); 京/沪 等级命名改正; 广东 17% 比例 (非"同河北" 15%)。3+3 京/津/浙 保留真·21级。
- **综合评价**: 浙江三位一体折算比例纠正 (浙大/复旦 85/10/5, 西湖 60/30/10; **上交保持 60/30/10**); 赣移除国科大; 粤 11→12校。
- **民族加分**: 云南全国性; 宁夏川区限省内; 藏格尔木例外; 海南补聚居市县+10; 青海补四区加分 (A+20/B+15/C+5)。
- **强基**: 湖南大学 ruwei 5→4; 甘 国防科大标 removed。
- **志愿规则/日程**: 河北本科批 院校专业组+调剂→专业+学校·无调剂; 宁夏A段 45→1; 吉/鄂/云/宁 日程; 山东去重; 青海 reform 注释。

### feat: `resolveSchool()` — 统一学校解析 + wrong-school guard
`school`/`plan`/`actual`/`scores`/`paiming` 改用 `resolveSchool()`: 全名/简称/5位院校代码/gaokao.cn id 统一解析, 歧义/未知一律拒绝而非瞎猜; `school` 加 wrong-school guard (索引校名≠接口返回则拒绝展示)。

## 0.3.4 — 2026-05-29

### Fix — 31-province regression round 1
- `subjects` 简写支持: `物化生` `史地政` `物化政` `史化生` `物化技` 等家长口语化 6字写法自动展开为完整科目数组
- 综评 (zongping by-school) 按候选分数 540 floor 过滤 (380 分不再"合格"上海纽约/南科大)
- 河北 huadang `candidate_profile_summary` + `tags` 字段中残留的"112 志愿"补修 (0.3.3 只改了 what_happened/lesson)
- `art-tongkao` / `sports-tongzhao` 接受位置参数 (`art-tongkao 河南` 而不只是 `--province henan`) — 与其他 verb 一致

## 0.3.3 — 2026-05-29

### Fix — 100-persona red-team 系统性修补

**Round 1 — 整省/整 verb 断链 critical bugs**:
- `slip-risk` 接受空 group_code / `auto` / 半角 `(01)` / 全角 `（01）` → **浙江/山东 整省现在能跑滑档评估** (此前 group_code="" 完全打不通)
- `inferTrack()` 对 港澳台 (71/81/82) 抛友好错误指向 `qatw` verb → recommend/paths/rank 不再 silent fail
- `paths()` 按候选分数 floor 过滤 强基/综评/港校/军校 (450 分不再"合格"清华强基)
- `国家专项` 从单条全国占位 → 23 实施省份分别注册 (`paths --rural` 在河南/四川/贵州/云南等省正确显示)
- `新疆 reform = "3+1+2"` → `"old"` (2025 仍是老高考, 3+1+2 改革2027 首届) → recommend/roadmap 整省不再返回 0 校

**Round 2 — 数据矛盾**:
- 浙大三位一体比例 `85:10:5` → `50:30:20` (浙大公开真实比例)
- 河北 huadang 4 个 case `112 志愿` → `96 志愿` (河北 2024+ 本科批是 96, 112 是辽宁)
- 内蒙古 calendar `2026 起平行替代动态投档` → `2024 起已替代` (real 政策时间)
- 云南 2025 艺术 `culture_control_line: {historical:345}` 与 `extras: no provincial control line` 自相矛盾 → 9 records 的 `culture_control_line` 置 null + 新增 notes 说明政策

**Round 3 — UX cleanup**:
- `tiqian <省>` 接受中文名 ("浙江" / "广东") 不再只认 pinyin
- `tiqian-pi --type` 支持模糊匹配 (`公费师范` 命中 `公费师范生`, `国家专项计划` 命中 `国家专项`)
- `minzu` 接受位置参数 (`minzu 河南`) 与其他 verb 一致
- `roadmap` 在无调剂省 (浙江/山东/河北/重庆/辽宁/贵州/青海) 把"⚠️ 调剂雷"改写"ℹ️ 组内冷门" (不再说"勾服从可能掉到冷门"——这些省没有勾服从这一步)
- `slip-risk` 错误信息中文化 + 列已知组提示

### Tests
- `reform-track.test.ts` 新增 港澳台 special-region throw 测试
- 全部 300+ 单元+smoke 测试通过

## 0.3.2 — 2026-05-29

### Merge — LAWTED issue #5 (worktree-ralph-loop-special-admissions)
集成 LAWTED v0.2.0 分支的特殊招生模块 (34 区域 × 3 年 × 6 类 = 1,497 条记录):

- **6 数据集** (`cli/data/datasets/special-admissions/`):
  - `art-formula-{2023,2024,2025}.json` — 艺术统考 6 大类公式 + 合格线
  - `sports-formula-{...}.json` — 体育统招 5 种 SportsFormulaKind
  - `qiangji-quota-{...}.json` — 39 强基校 × 31 省入围线
  - `zongping-{...}.json` — 浙江三位一体 / 苏沪鲁粤综评
  - `minzu-policy-{...}.json` — 加分梯度 + 民族班/预科 + 退坡时间表
  - `qatw-channel-{...}.json` — 港澳台 8 通道 (联招/居住证/保送/DSE/独立招生等)
- **3 区域** (GB/T 2260): 71 台湾 / 81 香港 / 82 澳门 (reform: "special")
- **7 新 verbs**: art-tongkao / sports-tongzhao / qiangji-line / zonghe / minzu / qatw / special-coverage
- **7 新 MCP tools** (38 → 46 总数 = 包含 outlook 共增 8)
- **34 source markdowns** + family-quickstart + coverage tracker
- **2 新测试套**: test:special (smoke 15/15) + test:validate (18 files all valid)

### Audit caveats (from parallel scan)
- ~94 zongping `confidence: low` 记录缺 `notes` 字段 (透明记数据稀疏，不是编造)
- qatw-channel-2025 dropped `admission_rate` vs 2023/24 (schema drift, 已记)
- 湖北艺术 2024/25 `formula=None, confidence=high` 但无 notes — 待 LAWTED 确认是否 2024 政策真实改动
- minzu-policy 51 (四川) 一条 `bonus: 50` 实为 民族预科 降分 (字段命名歧义，不影响数据)
- 强基入围线填充率: 2023 4.5% / 2024 35% / 2025 38% — 985 大校多 null 但 confidence:high (上游不公开)
- Loader 不复用 main 的 `load<T>` helper (技术债，下一轮统一)

## 0.3.1 — 2026-05-29

### Add — 透明倾向：📊 / 📋 / 💭 三层标签
- **roadmap pick 输出附 📋 政策依据**：每个 pick 现在自动 attach 学校的 program 政策标签（强基/公费师范/优师/综评/三位一体/中外合作综评/国家专项/高校专项/公安/军校/民族班/农村医学）— 让家长一眼看出"为什么这个学校被推"的非主观依据。
- **新 verb `outlook`** + **新数据集 `zhuanye-outlook-2030.json`** (38 个最常报+新兴专业):
  - 📊 数据事实：可验证的招生计划 + 增长率
  - 📋 政策依据：教育部 / 工信部 / 国务院 公开文件
  - 💭 我的判断：含 `outlook_2030` / `confidence` (高/中/低) / `why` / `wrong_scenario` (反例场景)
- 覆盖：集成电路/AI/量子/储能/机器人/智能制造/临床/口腔/康复/精神医学/护理 等绿榜，会计/法学/工商管理/英语/汉语言/学前教育/生物科学/应用物理/土木 等红榜。
- MCP 工具数 38 → 39 (`outlook` 暴露)。

## 0.3.0 — 2026-05-29

### UX — Coze / 中国家长 bot 优化
- **学校简称 alias 系统**：findUniversity 现在用 SCHOOL_ALIASES 映射，新增 60+ 常用简称（北邮 / 华师 / 中大 / 哈医大 / 港中深 等 → 全名）。alias 优先于 substring 匹配，避免 "华师" 错配 "西华师范"、"中大" 错配 "西北大学" 等经典 bug。
- **友好中文错误**："数据集里没找到「北京XX」；可能想找：北京舞蹈学院 / 北京电影学院" + `suggestUniversities()` helper。
- **`detectGroupTrap()` 调剂雷区检测**：扫每个组的 majors[] spcode 前 4 位，识别"热门工科（计算机/电信/AI）+ 冷门陷阱（护理/林学/应物/食品）"混搭组。`groups` 表格 + `roadmap` 每 pick 自动 attach 警告。

### Add — Coze 集成
- **`gaokao-pro server --port 3000`** — 零依赖 Node HTTP 服务器，把全部 38 个 MCP 工具暴露为 REST 端点。
  - `GET /` 健康检查
  - `GET /api/tools` 工具清单
  - `GET /openapi.json` OpenAPI 3.0 spec（Coze 插件直接 import）
  - `POST /api/tools/{name}` 调用任意工具，body = JSON args
  - CORS 默认开启
- **`paths` 输出 120 → 19 行**：默认只显示合格条目，按 program_type 折叠（`--all` 看全部含未开通的）。
- **`roadmap --format md`**：22 行 markdown 输出（emoji + 调剂雷标记 + baseline 警告），手机聊天 UI 友好。

## 0.2.2 — 2026-05-29

### Add — 2026 数据预留 + baseline 警告
- 新增 `cli/data/datasets/data-year-status.json` 记录每个数据集的 2025 baseline / 2026 公布窗口 / fallback message:
  - **college_groups**: 2026-06-25 → 07-15 (出分后)
  - **投档线**: 2026-07-15 → 07-30 (本科批投档结束后)
  - **一分一段**: 2026-06-25 → 07-01 (出分次日)
  - **提前批 catalog**: 2026-04 → 06 (各程序简章)
  - **calendar**: 2026 partial (4 confirmed + 27 tentative)
- 新增 `data-status` verb + MCP `data_status` tool (38 工具) 显示完整状态。
- **recommend / top / slip-risk / roadmap 输出尾部自动 attach `【2025 baseline 提示】`** 告知家长：
  - recommend: 基于 2025 历年最低分；2026 投档线发布前仅作参考
  - slip-risk: 2026 投档线可能波动 ±5-15 分
  - roadmap: 6/25 出分后请用真实分 + 当年一分一段重跑
- 大量 spcode 回填 (26 round-1 校 × 7 省): 82% → 98% 覆盖.

## 0.2.1 — 2026-05-29

### Fix
- `groups` verb now surfaces each major's **6-digit national 专业代码** (e.g. `"090502"` for 园林). The data was already in the underlying files (~93% coverage from gaokao.cn's `spcode` field) but the normalizer didn't expose it. Added `MAJOR_CODE_KEYS` (`spcode/code/sp_code/major_code/spname_code/zycode/zy_code/majorcode`) and added `code: string | null` to the public `Major` type.
- Added regression test guaranteeing ≥30% of majors surface a 6-digit code.

### Improve
- `groups` verb now defaults to table-mode output on TTY, with per-group section showing 专业代码 in brackets next to each major (e.g. `[080901] 计算机科学与技术 计划2`). Pipe or pass `--format json` to get the legacy JSON.
- `--format table` flag added for forcing table mode even when piped.

This directly answers questions like "if I apply to BUPT 计算机 and don't get in, what majors am I 调剂'd to?" — `groups --university 北邮 --province 河南` now lists every major in the same group with its national code, and `slip-risk` can weigh them via `--must` / `--ok` / `--reject` keyword preferences.

## 0.2.0 — 2026-05-29

Major iteration covering parent-facing 滑档 risk, 综评提前批 catalog, 高水平运动队 specialty, plus new composite verbs (`paths`, `dossier`, `roadmap`, `province-overview`).

### New verbs

- `slip-risk <学校> <省> <组> --score N [--rank N] [--must --ok --reject]` — risk verdict (high/moderate/low/comfortable) + ≤3 matching 历史 滑档 cases. Combines (score, rank) gap × province 调剂 rules × group major-spread × optional pref weighting.
- `paths <省> [--score --rank --minority --rural --serve --sport --sport-tier --language --school]` — one-call list of every applicable 提前批 / 综评 / 高水平运动队 program with ✓/✗ + caveat per row.
- `dossier <学校>` — 7-dataset aggregation per school: 招生网 + 院校专业组 + 强基/综评 校测 + 综评 by-school + 高水平运动队 + 提前批 catalog + 涉及该校的滑档 cases. Sections nullable with `_status: not_in_dataset`.
- `roadmap <省> --score --subjects [...]` — recommend 冲/稳/保 + per-pick slip-risk + paths summary + 关键提醒 caveats.
- `province-overview <省>` — mirror of dossier, but for provinces. Aggregates 调剂rules + 2026 calendar + 综评 schools open + 提前批 programs + 滑档历史 + 一分一段 + colleges admitting here.
- `calendar <省> | --list` — 2026 投档时间日历 (31 provinces; 4 confirmed + 27 tentative based on 2025).
- `huadang [<省>] [--category --list-categories]` — 滑档/退档 历史案例 (80 cases: 33 real + 47 composite, 31-province coverage).
- `xiaoce <学校>` — 强基/综评 校测 detail per school (subjects offered / 笔试-面试-体测 / 录取分配比 / 签约条款).
- `tiqian-pi [<省>] [--type --school --list-types]` — 提前批 catalog (151 programs × 16 types × 38+ provinces).
- `zongping <省>` — 综评 2026 by-school (UCAS / SUSTech / ShanghaiTech / CUHKSZ / 沪/苏/浙/鲁/粤 综评 校).
- `gaoshui-sport <运动名>` — 高水平运动队 by sport (post-2024 reform; tier_required × exam_window × score_path).
- `capabilities` — dataset health/capability report (counts across all datasets).

### New datasets

- `college-groups/*.json` — 79 → 258 schools × ~17,000 groups × ~140,000 majors. Top ~70 schools at 31-province national coverage; rest at 7-30 provinces.
- `xiaoce-detail-2025.json` — 强基/综评 校测 detail (59 schools).
- `gaoshui-yundongdui-2025.json` — Post-2024 reform 高水平运动队 (39 schools, per-sport detail incl. swim).
- `zonghepingjia-2026.json` — 综评 by-school (40 schools, cross-province coverage like UCAS).
- `tiqian-pi-programs-2025.json` — 提前批 catalog (151 programs × 16 types).
- `huadang-cases-2022-2025.json` — 滑档/退档 历史案例 (80 cases × 31 provinces × 14 categories).
- `zhiyuan-calendar-2026.json` — 31-province 2026 投档时间 calendar.

### CLI/MCP

- MCP tool count: 25 → 37.
- `recommend` / `top` outputs auto-append per-province 滑档 footer (special bold warning for 无调剂 provinces: 浙江/山东/河北/重庆/辽宁/贵州/青海).
- `slip-risk` auto-attaches ≤3 huadang precedents matching the risk signal (无调剂 / 不勾服从 / 组内冷热门 / 新高考首届).

### Web

- `softwareVersion` updated to `0.2.0` in `src/app/layout.tsx` (structured data).

### Test coverage

- 290+ tests passing (unit + integration + smoke).
- New test files: `slip-risk.test.ts` (9 cases incl. precedent contract), `paths.test.ts` (10), `dossier.test.ts` (5), `integration.test.ts` (8 cross-verb).

## 0.1.17 — prior

CLI version pinned for `recommend / top / scores / plan / actual / match / find / rank` baseline.
