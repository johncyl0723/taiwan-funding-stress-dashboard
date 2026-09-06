import { useEffect, useState } from 'react'
import { getDashboard } from './api'
import { Card, Stats, StatusBadge, TrendChart } from './components'
import type { DashboardPayload } from './types'

const pct = (value: number | null) => value === null ? '—' : value.toFixed(3)
const bp = (value: number | null) => value === null ? '—' : value.toFixed(1)

export default function App() {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const load = async () => { setLoading(true); try { setData(await getDashboard()) } catch (error) { setMessage(error instanceof Error ? error.message : '資料載入失敗') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const market = data?.market
  return <main>
    <header className="topbar">
      <div><p className="eyebrow">PUBLIC MARKET RESEARCH · TAIWAN</p><h1>台灣資金緊俏每日儀表板</h1></div>
    </header>
    {message && <p className="notice">{message}</p>}
    {loading ? <p className="loading">載入市場資料中…</p> : !market ? <section className="empty-state"><h2>尚無可發布的有效快照</h2><p>請等待平日 12:00 由 GitHub Actions 自動更新。</p></section> : <>
      <section className="hero">
        <div><p className="section-label">今日資金壓力</p><div className="hero-value">{bp(market.tfssBp)}<small>bp</small></div><p className="formula">TFSS = 90D TAIBIR 初級市場 − 3M TAIBOR</p></div>
        <div className="hero-side"><StatusBadge status={market.status} /><p>資料日：{market.date}</p><p>更新：{new Date(market.updatedAt).toLocaleString('zh-TW')}</p><p>5 日變化：{bp(market.tfssChange5dBp)} bp</p></div>
      </section>
      <section className="stats-section"><Stats stats={market.stats} /><p className="muted">百分位與 Z-score 在樣本未滿對應交易日時不顯示，以避免不穩定的燈號。</p></section>
      <section className="grid four">
        <Card title="90D TAIBIR 初級市場" value={pct(market.taibir90Primary)} unit="%" hint="企業三個月短期籌資成本" />
        <Card title="90D 初級－次級利差" value={bp(market.primarySecondaryBp)} unit="bp" hint="新資金供給的價格壓力" />
        <Card title="金融業 O/N 隔拆" value={pct(market.overnightRate)} unit="%" hint="銀行短端 reserve liquidity" />
        <Card title="央行 5 日 NCD 淨發行" value={market.ncdNetIssuance5d === null ? '—' : market.ncdNetIssuance5d.toLocaleString()} unit="百萬元" hint="正值代表淨吸收流動性" />
      </section>
      <section className="panel"><div className="panel-header"><div><p className="section-label">時間序列</p><h2>TFSS 資金壓力差</h2></div><StatusBadge status={market.status} /></div><TrendChart market={market} /></section>
      <section className="grid two">
        <article className="panel"><p className="section-label">市場結論</p><h2>{data.insight?.marketState ?? '摘要待生成'}</h2><p>{data.insight?.pressureSource ?? '資料更新完成後，系統將生成壓力來源判讀。'}</p><h3>政策觀察</h3><p>{data.insight?.policyObservation ?? '—'}</p></article>
        <article className="panel"><p className="section-label">研究觀點</p><h2>當日貨幣市場觀測</h2><p>{data.insight?.researchView ?? '資料更新完成後，系統將生成一般性研究觀點。'}</p><h3>限制與風險</h3><ul>{data.insight?.risksAndLimits?.map(item => <li key={item}>{item}</li>) ?? <li>公開資料可能有發布延遲。</li>}</ul></article>
      </section>
      <section className="panel"><p className="section-label">季頻銀行面板</p><h2>IRB 銀行與臺灣銀行控制組</h2><div className="table-wrap"><table><thead><tr><th>銀行</th><th>類別</th><th>期別</th><th>LCR</th><th>CET1</th><th>CAR</th><th>放款增速</th><th>存款增速</th></tr></thead><tbody>{data.bankMetrics.length ? data.bankMetrics.map(row => <tr key={row.bank}><td>{row.bank}</td><td>{row.isIrb ? 'IRB' : '控制組'}</td><td>{row.period}</td><td>{pct(row.lcr)}</td><td>{pct(row.cet1)}</td><td>{pct(row.car)}</td><td>{pct(row.loanGrowth)}</td><td>{pct(row.depositGrowth)}</td></tr>) : <tr><td colSpan={8}>尚未匯入公開季報資料</td></tr>}</tbody></table></div></section>
      <section className="sources"><h2>資料來源與狀態</h2>{market.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} · {source.asOf}</a>)}<p>{Object.values(market.sourceStatus).join(' · ')}</p></section>
    </>}
    <footer>本網站僅供公開市場研究與教育用途，不構成投資、融資或交易建議，亦不反映任何未公開銀行流動性資料。</footer>
  </main>
}
