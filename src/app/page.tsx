"use client";

import { useState } from "react";

type Status = "live" | "building" | "none";

type Row = {
  name: string;
  reform: "3+3" | "3+1+2" | "old";
  plan: Status;
  scores: Status;
  rank: Status;
  actual: Status;
  employment: Status;
  rules: string;
};

const PROVINCES: Row[] = [
  { name: "北京", reform: "3+3", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+3 新高考（6 选 3，含技术）。普通本科批 30 个院校专业组志愿，平行投档。强基/综合评价/军校/公安/小语种 走本科提前批。语数外原始分 + 6 选 3 等级赋分，满分 750。" },
  { name: "天津", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+3 新高考（6 选 3，等级赋分）。普通本科批 50 个院校专业组志愿，平行投档。提前批 A 段 (军校/公安/飞行学员/公费师范) 顺序志愿，B 段 (五区农村专项) 平行志愿。" },
  { name: "上海", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+3 新高考（6 选 3，等级赋分），满分 660。综合评价是上海一大特色，复旦/上交/同济/华东师大/上财/上外/华理 等 14 所校都有综评。院校专业组志愿，平行投档。高分段（>580）投档线不公开。" },
  { name: "重庆", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理或历史，再选化学/生物/政治/地理 中选 2 科。院校专业组志愿。本科批 96 个志愿。提前批 含军校/公安/公费师范。" },
  { name: "河北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨（物理类占 81% 计划，历史类 19%）。院校专业组志愿。本科批 96 个志愿，平行投档。" },
  { name: "山西", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "2024 仍为老高考（文理分科，2025 起进入新高考首届）。本科一批/二批分批次，提前批/常规批分次第。" },
  { name: "内蒙古", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "老高考（2025 才进入新高考首届）。文理分科。独有「动态排名实时填报」机制：填报期间考生可实时看自己在意向校/专业的排名，整点公开投档预测线，高分先截止低分后截止。" },
  { name: "辽宁", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。院校专业组志愿，本科批 112 个志愿，平行投档。" },
  { name: "吉林", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史 + 再选 2 科。院校专业组志愿。东北师大公费师范在吉林提前批招生。" },
  { name: "黑龙江", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史 + 再选 2 科。哈工大本部/哈工程/哈深 是省内主要工科去向。" },
  { name: "江苏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。院校专业组志愿，本科批 40 个志愿。南大/东南综合评价是江苏特色路径。" },
  { name: "浙江", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+3 新高考（7 选 3，含技术）。一段线/二段线分段录取。80 个「专业 + 院校」志愿，平行投档。三位一体综合评价 是浙大/复旦/上交/科大等校在浙江独有的招生路径，高考 85% + 校测 10% + 学考 5%。" },
  { name: "安徽", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2024 首届）。首选物理/历史 + 再选 2 科。院校专业组志愿。" },
  { name: "福建", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。院校专业组志愿。厦大综合评价 + 福建省内多校公费师范 是本省特色。" },
  { name: "江西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2024 首届）。首选物理/历史分轨。院校专业组志愿。南昌大学是省内唯一 211。" },
  { name: "山东", reform: "3+3", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+3 新高考（6 选 3，等级赋分 8 档）。普通类常规批 96 个「专业 + 院校」志愿，平行投档。山大/海大 综评 + 部属公费师范在山东招生量较大。" },
  { name: "河南", reform: "3+1+2", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。考生数全国第一（140 万 +）。首选物理/历史分轨。院校专业组志愿。国家专项 + 地方专项 + 高校专项均参与。郑大是省内唯一 211。" },
  { name: "湖北", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。院校专业组志愿。武大/华科/华农/中国地大武汉等是省内顶尖工科去向。" },
  { name: "湖南", reform: "3+1+2", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。湖南公费师范 6 校（湖南师大/一师/衡阳师院/湖南文理/吉首/科技）走提前批 + 服务期 6 年。国防科大在湖南有特殊招生。" },
  { name: "广东", reform: "3+1+2", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+1+2 新高考。首选物理/历史分轨。院校专业组志愿，本科批 45 个志愿。中山大学（85:15）+ 华南理工（300 名）+ 南科大/上科大（631 模式）是广东综评主力。" },
  { name: "广西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2024 首届）。少数民族加分政策（壮族/瑶族等）。广西大学是省内唯一 211。民族班/预科班招生量较大。" },
  { name: "海南", reform: "3+3", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+3 新高考（6 选 3）。独特的「标准分」制：总分 100-900，单科满分 300。等级赋分 + 百分等级转换。院校专业组志愿。" },
  { name: "四川", reform: "3+1+2", plan: "live", scores: "live", rank: "live", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。首选物理/历史 + 再选 2 科。院校专业组志愿。电子科大/川大/西南交大/西南财大 是省内顶尖去向。" },
  { name: "贵州", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2024 首届）。首选物理/历史分轨。国家专项计划是贵州特色（脱贫县/集中连片特困区）。贵州大学是省内唯一 211。" },
  { name: "云南", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。首选物理/历史 + 再选 2 科。少数民族加分 + 民族班/预科班。云大/昆工是省内主要去向。" },
  { name: "西藏", reform: "old", plan: "live", scores: "live", rank: "none", actual: "live", employment: "building",
    rules: "老高考（暂未启动新高考）。独特的双线分轨录取：A 类（少数民族/农牧民子女）与 B 类（汉族/其他）分别设线，A 类线远低于 B 类。区外内地高校设西藏专项/民族班/预科班。" },
  { name: "陕西", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。首选物理/历史分轨。西交/西工大/西电/长安/陕师大 是省内顶尖去向。陕师大公费师范「红烛计划」是本省师范主力。" },
  { name: "甘肃", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。首选物理/历史分轨。兰大是省内唯一 985。农村专项 + 国家专项 + 地方专项 实施面较广。" },
  { name: "青海", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。少数民族加分政策（藏族/回族/土族/撒拉族等）。民族班/预科班招生量大。青大医学院藏族民族班是本地医学主路径。" },
  { name: "宁夏", reform: "3+1+2", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "3+1+2 新高考（2025 首届）。少数民族加分（回族）。宁大/北方民大 是省内主要去向。" },
  { name: "新疆", reform: "old", plan: "live", scores: "live", rank: "building", actual: "live", employment: "building",
    rules: "目前仍 old 高考（2024 秋季高一启动 3+1+2，首届新高考为 2027）。单列类 11 民族 +15 加分（维/哈/蒙/柯/塔吉克/锡伯/乌兹别克/塔塔尔/达斡尔/藏/俄）。三试卷分流（普通类/单列类外语 vs 民语言）。内高班 14 内地省市办学 + 南疆单列 + 对口援疆。" }
];

const PROMPT = `跑 \`npx gaokao-pro@latest help\` 把命令摸清楚，然后帮我规划 2026 年的高考志愿。

先问我：身份（普通类 / 艺术 / 体育 / 强基 / 综评 / 港澳台 / 民族班）、分数（估分 / 模考分 / 高考分都行，标清楚是哪种）、省份、选科组合、目标专业方向或职业兴趣、偏好（目标城市 / 是否限定 985/211 / 学费预算）。如果给的是估分或模考分，参考 2023-2025 历年一分一段做粗估位次；等高考真实分数出来再用 2026 当年一分一段精算。

对应通道：普通类用 recommend/top/find/match；艺术类用 art-tongkao 查综合分公式；体育用 sports-tongzhao 查公式；强基用 qiangji-line 查校×省入围线；综评用 zonghe 查校单+公式；港澳台用 qatw 查联招/居住证/DSE/学测通道；民族班用 minzu 查加分梯度+预科降分。

每条推荐都用 CLI 拉真实数据支撑——查历年最低分、跨校搜专业、把分数换算成位次区间。`;

// Three slot-machine reels — schools / majors / aspirations.
// All monotone gray on purpose: the user explicitly asked not to tint each
// school's brand color (so 清华 is not purple, etc.). Different scroll
// speeds + 2 directions create the slot-machine feel.
// Schools shown in the marquee — each with a 2-char colloquial abbreviation
// used in the gray serif "印章" badge. Not real校徽 (those are copyrighted);
// the badge is an original typographic mark inspired by traditional 篆刻 squares.
const SCHOOLS: Array<{ name: string; abbr: string }> = [
  { name: "清华大学", abbr: "清华" },
  { name: "北京大学", abbr: "北大" },
  { name: "复旦大学", abbr: "复旦" },
  { name: "上海交通大学", abbr: "上交" },
  { name: "浙江大学", abbr: "浙大" },
  { name: "南京大学", abbr: "南大" },
  { name: "中国科学技术大学", abbr: "科大" },
  { name: "哈尔滨工业大学", abbr: "哈工" },
  { name: "西安交通大学", abbr: "西交" },
  { name: "中国人民大学", abbr: "人大" },
  { name: "北京航空航天大学", abbr: "北航" },
  { name: "中山大学", abbr: "中山" },
  { name: "华中科技大学", abbr: "华科" },
  { name: "武汉大学", abbr: "武大" },
  { name: "厦门大学", abbr: "厦大" },
  { name: "四川大学", abbr: "川大" },
  { name: "山东大学", abbr: "山大" },
  { name: "中南大学", abbr: "中南" },
  { name: "北京师范大学", abbr: "北师" },
  { name: "同济大学", abbr: "同济" },
  { name: "中国农业大学", abbr: "农大" },
  { name: "北京理工大学", abbr: "北理" },
  { name: "南开大学", abbr: "南开" },
  { name: "天津大学", abbr: "天大" },
  { name: "吉林大学", abbr: "吉大" },
  { name: "东南大学", abbr: "东南" },
  { name: "重庆大学", abbr: "重大" },
  { name: "西北工业大学", abbr: "西工" },
  { name: "电子科技大学", abbr: "成电" },
  { name: "湖南大学", abbr: "湖大" },
  { name: "兰州大学", abbr: "兰大" },
  { name: "中国海洋大学", abbr: "海大" },
  { name: "华南理工大学", abbr: "华工" },
  { name: "南方科技大学", abbr: "南科" },
  { name: "上海科技大学", abbr: "上科" }
];

const MAJORS = [
  "计算机类", "软件工程", "人工智能", "数据科学", "网络空间安全",
  "通信工程", "电子信息", "自动化", "机械工程", "土木工程",
  "建筑学", "电气工程", "临床医学", "口腔医学", "药学",
  "护理学", "心理学", "教育学", "法学", "工商管理",
  "经济学", "金融学", "会计学", "国际贸易", "新闻传播",
  "中文", "数学", "物理学", "化学", "生物科学",
  "哲学", "历史学", "社会学", "美术学", "音乐",
  "戏剧影视", "体育", "农学", "林学", "食品科学"
];

const ASPIRATIONS = [
  "想去南方", "必须 985", "211 也行", "想出国留学", "中外合作可以",
  "想做 AI", "想进互联网大厂", "父母让我学医", "我色弱不能学医", "怕长周期想 4 年毕业",
  "找工作里面有大哥", "想考公进体制", "喜欢北京胡同", "想去上海陆家嘴", "想去深圳搞钱",
  "留省内最稳", "农村户口走专项", "民族班可以", "预科也接受", "公费师范也行",
  "想读 5+3 临床", "想做学术", "想保研到清北", "偏科不要文综", "数学特别好",
  "英语特别强", "体育生想保送", "艺考美术过线", "我想自由独立", "想离家近一些",
  "想去香港读书", "想做投行", "喜欢做研究不爱社交", "家里能承担留学", "想读 211 的王牌专业"
];

// Material Symbols Rounded (filled) — same icon pattern as job.pro for consistency
function StatusDot({ kind }: { kind: Status }) {
  if (kind === "live") {
    return (
      <span className="status-cell status-live" aria-label="ready">
        <svg viewBox="0 0 24 24" className="status-icon" aria-hidden focusable="false">
          <path fill="currentColor" d="m10.6 13.8l-2.15-2.15q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7L9.9 15.9q.3.3.7.3t.7-.3l5.65-5.65q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"/>
        </svg>
      </span>
    );
  }
  if (kind === "building") {
    return (
      <span className="status-cell status-building" aria-label="building">
        <span className="status-emoji" role="img" aria-label="施工中">🚧</span>
      </span>
    );
  }
  return (
    <span className="status-cell status-none" aria-label="not yet">
      <svg viewBox="0 0 24 24" className="status-icon" aria-hidden focusable="false">
        <path fill="currentColor" d="m12 13.4l2.9 2.9q.275.275.7.275t.7-.275t.275-.7t-.275-.7L13.4 12l2.9-2.9q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275L12 10.6L9.1 7.7q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7l2.9 2.9l-2.9 2.9q-.275.275-.275.7t.275.7t.7.275t.7-.275zm0 8.6q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.138T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"/>
      </svg>
    </span>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0}>
      <span className="info-icon" aria-hidden>?</span>
      <span className="sr-only">{text}</span>
      <span className="info-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function SlotReel({ items, dir, speed, kind }: {
  items: ReadonlyArray<string | { name: string; abbr: string }>;
  dir: "left" | "right";
  speed: number;
  kind: "school" | "major" | "aspiration";
}) {
  const styleVar = { animationDuration: `${speed}s` } as React.CSSProperties;
  const doubled = [...items, ...items];
  return (
    <div className={`reel reel-${kind}`}>
      <div className={`reel-row ${dir === "right" ? "reverse" : ""}`} style={styleVar}>
        {doubled.map((item, i) => {
          const label = typeof item === "string" ? item : item.name;
          if (kind === "school") {
            return (
              <span className="chip school-chip" key={i}>{label}</span>
            );
          }
          return (
            <span className={`chip ${kind === "aspiration" ? "voice-chip" : "major-chip"}`} key={i}>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore older browsers
    }
  }

  return (
    <main className="page">
      <header className="site-head" aria-label="高考PRO">
        <a href="/" className="logo">
          <span className="logo-mark" aria-hidden>
            <span className="logo-char">录</span>
          </span>
          <span className="logo-wordmark">
            <span className="logo-name">
              高考<span className="logo-suffix">PRO</span>
            </span>
            <span className="logo-tag">用 AI 规划你的高考</span>
            <span className="logo-tag">Ha7ch.com</span>
          </span>
        </a>
      </header>

      <h1>
        用 <span className="accent">AI</span> 高考填报志愿
      </h1>

      <section className="reels" aria-label="数据维度">
        <SlotReel items={SCHOOLS} dir="left"  speed={70} kind="school" />
        <SlotReel items={MAJORS}  dir="right" speed={55} kind="major" />
        <SlotReel items={ASPIRATIONS} dir="left" speed={40} kind="aspiration" />
      </section>

      <section className="prompt-card" aria-labelledby="prompt-title">
        <div className="prompt-head">
          <span id="prompt-title" className="prompt-head-label">
            粘贴进 Claude Code / Codex / Cursor
          </span>
          <button
            type="button"
            className="prompt-copy"
            onClick={copyPrompt}
            aria-label={copied ? "已复制" : "复制"}
          >
            {copied ? "✓ 已复制" : "复制"}
          </button>
        </div>
        <pre className="prompt-body">{PROMPT}</pre>
      </section>

      <aside className="parent-note" aria-labelledby="parent-note-title">
        <h2 id="parent-note-title">致各位家长</h2>
        <p>这是个开源免费的工具，给所有准备高考的家庭。</p>
        <p>
          它要跑在 Claude Code / Codex / Cursor 这类 AI 工具里。如果家里还没人用过这些，
          请务必找一位用过的人陪你跑一次——孩子的同学、亲戚里的年轻人、单位里搞 IT 的同事都可以；
          实在找不到，可以去{" "}
          <a href="https://www.xiaohongshu.com/user/profile/5d4113b2000000001202e2ee" target="_blank" rel="noopener noreferrer">lawted</a>{" "}
          的直播间让他帮你看一眼。
        </p>
        <p>
          这场革命已经发生了。你正在看的这个网站、背后的命令行工具、那几千行代码，
          绝大部分是 AI 一行行写出来的，人只是把需求和判断给到它。
          越来越多的公司，也已经在这样做事。
        </p>
        <p>
          所以报志愿之前，请抽一晚上去看看现在的市场——大模型今天能干哪些活、
          哪些岗位过去一两年被压缩了、哪些公司今年只招会用 AI 的人。
          今天看着稳的专业，四年后可能被重新洗牌；今天看着冷门的方向，
          可能正是入口。心里有一杆自己的秤，比靠亲戚邻居转述的旧地图靠谱。
        </p>
        <p className="parent-note-thesis">
          <strong>说到这儿，得讲一句真心话。我们做这个工具，并不是为了让 AI 替你拍板冲、稳、保——那只是个由头。
          真正想让你借这次机会看见的，是 AI 现在已经能干到什么程度、又在重塑哪些行业。
          报志愿是人生里少数几个会逼你和孩子认真想「未来三十年靠什么吃饭」的时刻，
          错过太可惜。一份冲稳保名单，远远没有这件事重要。</strong>
        </p>
        <p className="parent-note-sign">孩子的人生路口，多花点时间是值得的。</p>
      </aside>

      <section className="special-admissions-card" aria-labelledby="special-admissions-title">
        <h2 id="special-admissions-title" className="section-title">
          v0.2.0 · 特殊招生支持 ✦
        </h2>
        <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", color: "var(--fg-dim)" }}>
          为艺术 / 体育 / 强基 / 综评 / 港澳台 / 民族班家庭加的 7 个新命令。
          覆盖 <strong>34 个区域</strong>（31 省 + 港 81 / 澳 82 / 台 71）×
          <strong> 3 年</strong>（2023/2024/2025）× <strong>6 类数据</strong>，共 <strong>1,497 条结构化记录</strong>。
        </p>
        <ul style={{ marginTop: "0.5rem", paddingLeft: "1.2rem", fontSize: "0.92rem", lineHeight: "1.7" }}>
          <li><code>art-tongkao</code> — 艺术统考 6 大类公式（含河南 5 选 1、云南 25 取消省线、湖北 ×2 还原、辽宁百分制再加权 等独有口径）</li>
          <li><code>sports-tongzhao</code> — 体育统招 5 种公式 kind（湖南/青海 直接相加、陕西/甘肃 按专业课、海南 按高考总分、重庆 25 本专合一 73、湖北 1.25 系数）</li>
          <li><code>qiangji-line</code> — 强基 39 校 × 31 省 × 3 年 入围线 + 报名即入围 12 校 + 西部 75% 文化门槛（甘青宁新）</li>
          <li><code>zonghe</code> — 综评（浙江三位一体 39 校独有学考维度 / 江苏 23 校 A·B 类 / 沪鲁粤 11 校 85+15 / 京闽 7 校外省）</li>
          <li><code>minzu</code> — 少数民族加分梯度 + 民族班/预科（甘肃两州五县 +20、新疆单列类 +15、西藏双联户 +10 + 进藏干部 +1/年）+ 退坡时间表</li>
          <li><code>qatw</code> — 港澳台双向（全国联招 / 居住证高考 / DSE 互认 / 港校独立招生 / 澳门四校 / 学测申请陆校 / 陆生赴台 2020 起暂停）</li>
          <li><code>special-coverage</code> — 18 个 dataset 覆盖率统计</li>
        </ul>
      </section>

      <section className="province-table" aria-labelledby="provinces-title">
        <h2 id="provinces-title" className="section-title">
          省份覆盖
          <InfoTip text="✓ 已就绪 · 🚧 数据建设中 · ✕ 暂未支持。每个省份名后的 ⓘ 写了该省的录取规则。" />
        </h2>
        <div className="province-row header" aria-hidden>
          <span>省份</span>
          <span className="status-cell">招生计划</span>
          <span className="status-cell">历年分数</span>
          <span className="status-cell">一分一段</span>
          <span className="status-cell">实际录取</span>
          <span className="status-cell">就业报告</span>
        </div>
        {PROVINCES.map((p) => (
          <div key={p.name} className="province-row">
            <span className="province-name">
              {p.name}
              <InfoTip text={p.rules} />
            </span>
            <StatusDot kind={p.plan} />
            <StatusDot kind={p.scores} />
            <StatusDot kind={p.rank} />
            <StatusDot kind={p.actual} />
            <StatusDot kind={p.employment} />
          </div>
        ))}
      </section>

      <p className="companion">
        搭配{" "}
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
          cv.ha7ch.com
        </a>{" "}
        写简历，毕业后用{" "}
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer">
          job.ha7ch.com
        </a>{" "}
        找工作。
      </p>

      <p className="install">
        <span className="install-label">CLI</span>
        npx gaokao-pro@latest help
      </p>

      <p className="link-row">
        <a
          href="https://github.com/HA7CH/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/package/gaokao-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="npm"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C23.99.786 23.204 0 22.227 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z" />
          </svg>
        </a>
        <span aria-hidden style={{ color: "var(--fg-dim)" }}>·</span>
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
          cv.ha7ch.com
        </a>
        <a href="https://job.ha7ch.com" target="_blank" rel="noopener noreferrer">
          job.ha7ch.com
        </a>
        <a
          href="https://ha7ch.com"
          target="_blank"
          rel="noopener noreferrer"
          className="link-right"
        >
          ha7ch.com
        </a>
      </p>
    </main>
  );
}
