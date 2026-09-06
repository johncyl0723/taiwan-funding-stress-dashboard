import { useEffect, useState } from 'react'
import { getBackground, getDashboard, getHistory } from './api'
import {
  AuctionTable, Card, CompositeBreakdown, CompositeChart, EventFlags,
  MonthlyPanel, SpreadChart, Stats, StatusBadge, WeeklyBillsChart
} from './components'
import type { BackgroundPayload, DashboardPayload, HistoryPoint } from './types'

/** 與 scripts/lib/composite.ts 的 THRESHOLDS 對應，僅供圖表參考線使用 */
const THRESHOLDS = { tightening: 1.0, tight: 1.5, stress: 2.0 }

const pct = (value: number | null, digits = 3) => value === null ? '—' : value.toFixed(digits)
const bp = (value: number | null) => value === null ? '—' : value.toFixed(1)
const num = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-TW')
const z = (value: number | null) => value === null ? '—' : value.toFixed(2)

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
      // 圖表與背景面板失敗不覆蓋主畫面的錯誤訊息
      await Promise.all([
        getHistory().then(setHistory, () => setHistory([])),
        getBackground().then(setBackground, () => setBackground(null))
      ])
    })()
  }, [])

  const market = data?.market
  const corridor = market?.corridorPosition

  return <main>
    <header className="topbar">
      <div>
        <p className="eyebrow">PUBLIC MARKET RESEARCH · TAIWAN</p>
        <h1>台灣資金緊俏每日儀表板</h1>
      </div>
    </header>
    {message && <p className="notice">{message}</p>}
    {loading ? <p className="loading">載入市場資料中…</p> : !market ? (
      <section className="empty-state">
        <h2>尚無可發布的有效快照</h2>
        <p>請等待平日 12:00 由 GitHub Actions 自動更新。</p>
      </section>
    ) : <>
      <section className="hero">
        <div>
          <p className="section-label">綜合資金壓力（5 日均 z-score）</p>
          <div className="hero-value">{z(market.compositeZ5d)}</div>
          <p className="formula">TFSS ＋ 初次級利差 ＋ TAIBOR 斜率 ＋ O/N 走廊位置 ＋ NCD 淨發行，各取 120 日 z-score 等權平均；未通過材料性檢定的子指標會被排除</p>
        </div>
        <div className="hero-side">
          <StatusBadge status={market.status} provisional={market.stats.provisional} />
          <p>資料日：{market.date}</p>
          <p>更新：{new Date(market.updatedAt).toLocaleString('zh-TW')}</p>
          <p>當日 z：{z(market.compositeZ)}</p>
          <EventFlags flags={market.eventFlags} />
        </div>
      </section>

      {market.guardApplied && <p className="notice guard">{market.guardApplied}</p>}
      {market.repoOperation && <p className="notice alert">央行公告出現附買回／附賣回操作，屬非例行動作。</p>}

      <section className="grid two">
        <article className="panel">
          <p className="section-label">子指標分解</p>
          <h2>各項 120 日 z-score</h2>
          <CompositeBreakdown inputs={market.compositeInputs} excluded={market.excludedInputs} />
        </article>
        <article className="panel">
          <p className="section-label">TFSS 統計</p>
          <h2>單一指標的相對位置</h2>
          <Stats stats={market.stats} />
          <p className="muted">
            百分位以中位排名法計算；樣本未滿 60／120 個交易日時標示為暫定，未滿 30 個交易日則不給燈號。
            綜合燈號改以 5 日均 z-score 判定，避免單日雜訊。
          </p>
        </article>
      </section>

      <section className="grid four">
        <Card title="TFSS" value={bp(market.tfssBp)} unit="bp" hint={`90D TAIBIR 初級 − 3M TAIBOR｜5 日變化 ${bp(market.tfssChange5dBp)} bp`} />
        <Card title="90D 初級－次級利差" value={bp(market.primarySecondaryBp)} unit="bp" hint="票券商承銷新券的定價壓力" />
        <Card title="TAIBOR 1W–3M 斜率" value={bp(market.taiborSlopeBp)} unit="bp" hint="銀行間對未來一季鬆緊的預期" />
        <Card title="TAIBIR 30–180D 斜率" value={bp(market.taibirSlopeBp)} unit="bp" hint="票券期限溢酬，陡＝發短划算、平＝拉長鎖定" />
      </section>

      <section className="grid four">
        <Card
          title="O/N 走廊位置"
          value={corridor === null || corridor === undefined ? '—' : `${(corridor * 100).toFixed(1)}`}
          unit="%"
          hint={`隔拆 ${pct(market.overnightRate)}%${market.policyRate ? `｜重貼現率 ${market.policyRate.rediscount}%` : ''}｜0＝貼著 7 天期 NCD 利率`}
        />
        <Card title="央行 NCD 淨發行" value={num(market.ncdNetIssuance5d)} unit="百萬元／5 日" hint={`當日 ${num(market.ncdNetIssuance)}｜正值代表淨吸收流動性`} />
        <Card title="NCD 未到期餘額" value={market.ncdOutstanding === null ? '—' : Math.round(market.ncdOutstanding / 100).toLocaleString('zh-TW')} unit="億元" hint="央行沖銷的存量" />
        <Card title="外資買賣超" value={num(market.foreignNet5d)} unit="百萬元／5 日" hint={`當日 ${num(market.foreignNet)}｜正值為淨買超，台幣流動性的外生來源`} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><p className="section-label">時間序列</p><h2>綜合資金壓力與燈號門檻</h2></div>
          <StatusBadge status={market.status} provisional={market.stats.provisional} />
        </div>
        <CompositeChart history={history} thresholds={THRESHOLDS} />
        <p className="muted">門檻為常態近似初值，尚未以歷史回測校準（見 <code>npm run backtest</code>）。</p>
      </section>

      <section className="panel">
        <p className="section-label">價格層</p>
        <h2>TFSS、初次級利差與 TAIBOR 斜率</h2>
        <SpreadChart history={history} />
      </section>

      <section className="grid two">
        <article className="panel">
          <p className="section-label">市場結論</p>
          <h2>{data.insight?.marketState ?? '摘要待生成'}</h2>
          <p>{data.insight?.pressureSource ?? '資料更新完成後，系統將生成壓力來源判讀。'}</p>
          <h3>政策觀察</h3>
          <p>{data.insight?.policyObservation ?? '—'}</p>
        </article>
        <article className="panel">
          <p className="section-label">研究觀點</p>
          <h2>當日貨幣市場觀測</h2>
          <p>{data.insight?.researchView ?? '資料更新完成後，系統將生成一般性研究觀點。'}</p>
          <h3>限制與風險</h3>
          <ul>{data.insight?.risksAndLimits?.map(item => <li key={item}>{item}</li>) ?? <li>公開資料可能有發布延遲。</li>}</ul>
        </article>
      </section>

      <section className="panel">
        <p className="section-label">外幣通道</p>
        <h2>外幣 vs 台幣借款</h2>
        <div className="grid three">
          <Card title="SOFR 90 日均" value={pct(market.sofr90)} unit="%" hint="美元端借款成本基準" />
          <Card title="名目利差（SOFR − 3M TAIBOR）" value={bp(market.fxNominalSpreadBp)} unit="bp" hint="正值代表美元名目上較貴" />
          <Card title="USD/TWD" value={pct(market.usdTwd)} unit="" hint={`20 日年化波動 ${market.usdTwdVol20 === null ? '—' : `${market.usdTwdVol20.toFixed(1)}%`}`} />
        </div>
        <p>{data.insight?.fxView ?? '—'}</p>
      </section>

      <section className="panel">
        <p className="section-label">月頻背景</p>
        <h2>銀行體系數量與授信環境</h2>
        <MonthlyPanel series={background?.monthly ?? []} />
      </section>

      <section className="grid two">
        <article className="panel">
          <p className="section-label">週頻數量</p>
          <h2>票券初級市場承作與兌償</h2>
          <WeeklyBillsChart points={background?.weeklyBills ?? []} />
        </article>
        <article className="panel">
          <p className="section-label">需求面</p>
          <h2>364 天期 NCD 標售</h2>
          <AuctionTable auctions={background?.ncdAuctions ?? []} />
        </article>
      </section>

      <section className="sources">
        <h2>資料來源與狀態</h2>
        {[...market.sources, ...(background?.sources ?? [])].map(source => (
          <a key={source.url + source.label} href={source.url} target="_blank" rel="noreferrer">
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
