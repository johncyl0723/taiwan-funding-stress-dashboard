import { useEffect, useState } from 'react'
import { getBackground, getDashboard, getHistory } from './api'
import {
  AiCommentaryBlock, AuctionTable, CompositeBreakdown, CompositeChart, EventFlags,
  LayerHeader, MetricRow, MonthlyPanel, NewsList, Stats, StatusBadge, WeeklyBillsChart
} from './components'
import { DEFINITIONS, FX_DEFINITIONS, MONTHLY_HINTS } from './definitions'
import { RefreshButton } from './RefreshButton'
import type { BackgroundPayload, CompositeInputs, DashboardPayload, HistoryPoint } from './types'

/** 與 scripts/lib/composite.ts 的 THRESHOLDS 對應，僅供圖表參考線使用 */
const THRESHOLDS = { tightening: 1.0, tight: 1.5, stress: 2.0 }

const fmt = (value: number | null | undefined, digits: number) =>
  value === null || value === undefined ? '—' : value.toFixed(digits)
const num = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('zh-TW')

export default function App() {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [background, setBackground] = useState<BackgroundPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        setData(await getDashboard())
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '資料載入失敗')
      } finally {
        setLoading(false)
      }
      await Promise.all([
        getHistory().then(setHistory, () => setHistory([])),
        getBackground().then(setBackground, () => setBackground(null))
      ])
    })()
  }, [])

  const market = data?.market
  const readings = data?.insight?.readings ?? {}
  const excludedFor = (key: keyof CompositeInputs) =>
    market?.excludedInputs?.find(entry => entry.key === key)?.reason

  const row = (
    definitionKey: string,
    value: string,
    dataKey: keyof HistoryPoint,
    excludedKey?: keyof CompositeInputs
  ) => {
    const definition = DEFINITIONS[definitionKey] ?? FX_DEFINITIONS[definitionKey]
    if (!definition || !market) return null
    return <MetricRow
      key={definitionKey}
      definition={definition}
      value={value}
      reading={readings[definitionKey] ?? '尚無解讀。'}
      history={history}
      dataKey={dataKey}
      excluded={excludedKey ? excludedFor(excludedKey) : undefined}
      asOf={market.date}
    />
  }

  return <main>
    <header className="topbar">
      <div>
        <p className="eyebrow">PUBLIC MARKET RESEARCH · TAIWAN</p>
        <h1>台灣資金緊俏每日儀表板</h1>
      </div>
      <RefreshButton />
    </header>

    {message && <p className="notice">{message}</p>}

    {loading ? <p className="loading">載入市場資料中…</p> : !market ? (
      <section className="empty-state">
        <h2>尚無可發布的有效快照</h2>
        <p>請等待平日 12:00 由 GitHub Actions 自動更新。</p>
      </section>
    ) : <>

      {/* ── 第一部分：今天緊不緊 ───────────────────────────── */}
      <section className="part">
        <p className="part-label">第一部分</p>
        <h2 className="part-title">今天資金緊不緊</h2>

        <div className="hero">
          <div>
            <p className="section-label">TSS 資金緊俏綜合指數（5 日均 z-score）</p>
            <div className="hero-value">{fmt(market.compositeZ5d, 2)}</div>
            <p className="formula">
              五個子指標各取 120 日 z-score 等權平均。1.0 以上開始偏緊、1.5 明顯緊俏、2.0 異常壓力。
            </p>
          </div>
          <div className="hero-side">
            <StatusBadge status={market.status} provisional={market.stats.provisional} large />
            <p>資料日：{market.date}</p>
            <p>當日 z：{fmt(market.compositeZ, 2)}</p>
            <p>更新：{new Date(market.updatedAt).toLocaleString('zh-TW')}</p>
            <EventFlags flags={market.eventFlags} />
          </div>
        </div>

        {market.guardApplied && <p className="notice guard">{market.guardApplied}</p>}
        {market.repoOperation && <p className="notice alert">央行公告出現附買回／附賣回操作，屬非例行動作。</p>}

        <div className="grid two">
          <article className="panel">
            <p className="section-label">規則式摘要</p>
            <h3>{data.insight?.marketState ?? '摘要待生成'}</h3>
            <p>{data.insight?.researchView ?? '—'}</p>
            <p>{data.insight?.pressureSource ?? ''}</p>
            <p>{data.insight?.policyObservation ?? ''}</p>
          </article>
          <article className="panel">
            <AiCommentaryBlock commentary={data.aiCommentary ?? null} />
          </article>
        </div>

        <article className="panel">
          <div className="panel-header">
            <div><p className="section-label">時間序列</p><h3>TSS 走勢與燈號門檻</h3></div>
            <StatusBadge status={market.status} provisional={market.stats.provisional} />
          </div>
          <CompositeChart history={history} thresholds={THRESHOLDS} />
          <p className="muted">門檻為常態近似初值，尚未以真實壓力事件校準（見 <code>npm run backtest</code>）。</p>
        </article>

        <article className="panel">
          <p className="section-label">相關新聞</p>
          <h3>近兩週的官方公告與媒體報導</h3>
          <NewsList items={data.news ?? []} digest={data.newsDigest ?? null} />
        </article>
      </section>

      {/* ── 第二部分：拆解 ────────────────────────────────── */}
      <section className="part">
        <p className="part-label">第二部分</p>
        <h2 className="part-title">TSS 怎麼組成的</h2>
        <p className="part-lead">
          依知識圖譜由上而下展開：外生資金流動 → 央行調節供給 → 銀行間形成價格 → 傳導到企業票券成本 → 合成為單一指數。
          以下各層皆為日頻資料，資料日 {market.date}；月頻與週頻背景另置於本節最後。
        </p>

        <div className="layer">
          <LayerHeader index={1} label="外生驅動"
            lead="台幣流動性最大的外生來源。外資匯出時央行常進場賣匯阻貶，等於同步從銀行體系抽走台幣。" />
          {row('foreignNet', num(market.foreignNet5d), 'foreignNet5d')}
        </div>

        <div className="layer">
          <LayerHeader index={2} label="央行政策"
            lead="央行透過定期存單（NCD）調節市場上的台幣數量，並以貼放利率界定利率走廊。這一層決定資金的「供給」。" />
          {row('ncdNetIssuance', num(market.ncdNetIssuance5d), 'ncdNetIssuance5d', 'ncdNetIssuance')}
          {row('ncdOutstanding', market.ncdOutstanding === null ? '—' : Math.round(market.ncdOutstanding / 100).toLocaleString('zh-TW'), 'ncdOutstanding')}
          {row('corridor', market.corridorPosition === null ? '—' : (market.corridorPosition * 100).toFixed(1), 'corridorPosition', 'corridor')}
        </div>

        <div className="layer">
          <LayerHeader index={3} label="銀行間價格"
            lead="銀行之間互相拆借的價格。準備部位鬆緊會先反映在隔夜拆款，再傳到 1 週至 3 個月的 TAIBOR。" />
          {row('overnight', fmt(market.overnightRate, 3), 'overnightRate')}
          {row('taibor', fmt(market.taibor3m, 3), 'taibor3m')}
          {row('taiborSlope', fmt(market.taiborSlopeBp, 1), 'taiborSlopeBp', 'taiborSlope')}
        </div>

        <div className="layer">
          <LayerHeader index={4} label="票券與企業融資"
            lead="資金成本傳到企業端：企業發行商業本票（CP）的實際利率，以及票券商願不願意承銷新券。" />
          {row('tfss', fmt(market.tfssBp, 1), 'tfssBp', 'tfss')}
          {row('primarySecondary', fmt(market.primarySecondaryBp, 1), 'primarySecondaryBp', 'primarySecondary')}
          {row('taibirSlope', fmt(market.taibirSlopeBp, 1), 'taibirSlopeBp')}
        </div>

        <div className="layer">
          <LayerHeader index={5} label="合成與判讀"
            lead="把上面各層的價格訊號標準化後合成單一指數，並套用材料性檢定、絕對水準 guard、5 日均值與事件旗標四道修正。" />
          <div className="grid two">
            <article className="panel">
              <p className="section-label">子指標分解</p>
              <h3>各項 120 日 z-score</h3>
              <CompositeBreakdown inputs={market.compositeInputs} excluded={market.excludedInputs} />
            </article>
            <article className="panel">
              <p className="section-label">TFSS 統計</p>
              <h3>單一指標的相對位置</h3>
              <Stats stats={market.stats} />
              <p className="muted">
                百分位以中位排名法計算；樣本未滿 60／120 個交易日時標示為暫定，未滿 30 個交易日則不給燈號。
                綜合燈號以 5 日均 z-score 判定，避免單日雜訊。
              </p>
            </article>
          </div>
        </div>

        <div className="layer background-band">
          <LayerHeader index={6} label="月頻與週頻背景"
            lead="銀行體系的數量面與授信環境。這些資料頻率較低且有發布落差，只作背景，不進 TSS 合成。" />
          <p className="freq-warning">
            以下為月頻與週頻資料，最新期別與上方日頻數字不同期，不可直接並列比較。
          </p>
          <MonthlyPanel series={background?.monthly ?? []} hints={MONTHLY_HINTS} />
          <div className="grid two">
            <article className="panel">
              <p className="section-label">週頻 · {background?.weeklyBills.at(-1)?.week ?? '—'}</p>
              <h3>票券初級市場承作與兌償</h3>
              <WeeklyBillsChart points={background?.weeklyBills ?? []} />
            </article>
            <article className="panel">
              <p className="section-label">約每月 · {background?.ncdAuctions.at(-1)?.date.slice(0, 7) ?? '—'}</p>
              <h3>364 天期 NCD 標售</h3>
              <AuctionTable auctions={background?.ncdAuctions ?? []} />
            </article>
          </div>
        </div>
      </section>

      {/* ── 第三部分：外幣通道 ────────────────────────────── */}
      <section className="part">
        <p className="part-label">第三部分</p>
        <h2 className="part-title">台幣 vs 美元</h2>
        <p className="part-lead">
          外幣借款划不划算，取決於「美元利率 ＋ 避險成本」與「台幣利率」的比較。
          目前缺換匯點資料，只能呈現名目利差與匯率波動，算不出避險後的隱含台幣成本。
        </p>
        <div className="layer">
          {row('sofr', fmt(market.sofr90, 3), 'sofr90')}
          {row('fxSpread', fmt(market.fxNominalSpreadBp, 1), 'fxNominalSpreadBp')}
          {row('usdTwd', fmt(market.usdTwd, 3), 'usdTwd')}
        </div>
      </section>

      <section className="panel">
        <p className="section-label">限制與風險</p>
        <ul>{data.insight?.risksAndLimits?.map(item => <li key={item}>{item}</li>) ?? <li>公開資料可能有發布延遲。</li>}</ul>
      </section>

      <section className="sources">
        <h2>資料來源與狀態</h2>
        {[...market.sources, ...(background?.sources ?? [])].map(source => (
          <a key={source.url + source.label} href={source.url} target="_blank" rel="noreferrer noopener">
            {source.label} · {source.asOf}
          </a>
        ))}
        <p>{Object.values(market.sourceStatus).join(' · ')}</p>
      </section>
    </>}

    <footer>
      本網站僅供公開市場研究與教育用途，不構成投資、融資或交易建議，亦不反映任何未公開銀行流動性資料。
    </footer>
  </main>
}
