export default function Home() {
  return (
    <main>
      <header>
        <h1>
          gaokao<span className="dot">.</span>pro
        </h1>
        <p className="tagline">
          China&apos;s 高考 college planner — <strong>from your terminal</strong>.
          Score in, schools out. 2,400+ universities, 31 provinces, offline,
          no signup.
        </p>
        <p className="subhead">made by HA7CH · sibling of job.pro &amp; cv.pro</p>
      </header>

      <section>
        <h2>
          <span className="num">01</span>install
        </h2>
        <div className="cmd">
          <span className="prompt">$</span>
          npx gaokao-pro@latest help
        </div>
      </section>

      <section>
        <h2>
          <span className="num">02</span>recommend
        </h2>
        <div className="cmd">
          <span className="prompt">$</span>
          npx gaokao-pro@latest recommend --score 660 --province henan --subjects
          物理,化学,生物 --985 --limit 4 --explain
        </div>
        <pre className="output">
          <span className="dim">gaokao-pro recommend  score=660  河南(3+1+2)  track=物理类  evaluated=44</span>{"\n\n"}
          <span className="reach">[冲  REACH]  4 schools</span>{"\n"}
          {`  school              delta  min(2025)  city    tags  belong\n`}
          {`  南京大学            -9     669        南京市  985   教育部\n`}
          {`  北京航空航天大学    -10    670        北京市  985   工业和信息化部\n`}
          {`  上海交通大学医学院  -10    670        上海市  985   教育部\n`}
          {`  中国人民大学        -12    672        北京市  985   教育部\n\n`}
          <span className="match">[稳  MATCH]  4 schools</span>{"\n"}
          {`  school                  delta  min(2025)  city    tags  belong\n`}
          {`  北京理工大学            -5     665        北京市  985   工业和信息化部\n`}
          {`  南开大学                +3     657        天津市  985   教育部\n`}
          {`  同济大学                +3     657        上海市  985   教育部\n`}
          {`  哈尔滨工业大学（威海）  +3     657        威海市  985   工业和信息化部\n\n`}
          <span className="safety">[保  SAFETY]  4 schools</span>{"\n"}
          {`  school        delta  min(2025)  city    tags  belong\n`}
          {`  四川大学      +16    644        成都市  985   教育部\n`}
          {`  华南理工大学  +16    644        广州市  985   教育部\n`}
          {`  华中科技大学  +17    643        武汉市  985   教育部\n`}
          {`  北京师范大学  +18    642        北京市  985   教育部`}
        </pre>
      </section>

      <section>
        <h2>
          <span className="num">03</span>verbs
        </h2>
        <table className="verbs">
          <tbody>
            <tr>
              <td className="verb">recommend</td>
              <td className="desc">冲 / 稳 / 保 buckets for your score in a province (offline).</td>
            </tr>
            <tr>
              <td className="verb">top</td>
              <td className="desc">Top-N best schools your score can reach.</td>
            </tr>
            <tr>
              <td className="verb">find</td>
              <td className="desc">Search majors across schools — e.g. all 985 schools that recruit 计算机.</td>
            </tr>
            <tr>
              <td className="verb">school</td>
              <td className="desc">University metadata: 985 / 211 / 双一流 / 学科评估 / 排名.</td>
            </tr>
            <tr>
              <td className="verb">plan</td>
              <td className="desc">Forward-looking admission plan per (school, year, province).</td>
            </tr>
            <tr>
              <td className="verb">actual</td>
              <td className="desc">Actual admissions per major: 最高/最低/平均分 + 最低位次.</td>
            </tr>
            <tr>
              <td className="verb">scores</td>
              <td className="desc">Historical min-score time series for one (school, province) pair.</td>
            </tr>
            <tr>
              <td className="verb">mcp</td>
              <td className="desc">Run as MCP server: <code>claude mcp add gaokao-pro -- npx -y gaokao-pro mcp</code></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>
          <span className="num">04</span>why
        </h2>
        <ul className="features">
          <li>
            <strong>Offline + local.</strong> 2,400-school index ships with the
            npm package (1 MB gzipped). Recommend &amp; top run in milliseconds
            with zero network.
          </li>
          <li>
            <strong>No signup, no token.</strong> Talks straight to{" "}
            <code>static-data.gaokao.cn</code> — the 中国教育在线 / 掌上高考
            public JSON tier.
          </li>
          <li>
            <strong>Transparent algorithm.</strong> <code>delta = score − historicalMin</code>;
            buckets at ±5 / ±15 / ±25. No black-box LLM.
          </li>
          <li>
            <strong>Claude Code native.</strong> Built-in MCP server — pipe
            recommendations straight into Claude conversations.
          </li>
          <li>
            <strong>新高考 aware.</strong> 3+3 / 3+1+2 / 老高考 轨制 inferred
            from your subjects. 31 provinces supported.
          </li>
          <li>
            <strong>Open source.</strong> MIT. Audit the recommendation logic
            in the public repo.
          </li>
        </ul>
      </section>

      <footer>
        <a href="https://github.com/HA7CH/gaokao-pro">GitHub</a>
        <span className="sep">·</span>
        <a href="https://www.npmjs.com/package/gaokao-pro">npm</a>
        <span className="sep">·</span>
        <a href="https://ha7ch.com">ha7ch.com</a>
        <span className="sep">·</span>
        <span>part of HA7CH — built in the field, hatched into impact</span>
      </footer>
    </main>
  );
}
