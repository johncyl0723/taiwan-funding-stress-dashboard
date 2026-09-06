import type { ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import type { Definition } from './definitions'
import type {
  AiCommentary, CompositeInputs, EventFlag, HistoryPoint, MonthlySeries,
  NcdAuction, NewsDigest, NewsItem, Status, StressStats, WeeklyBillPoint
} from './types'

const STATUS_NAMES: Record<Status, string> = {
  normal: '正常', tightening: '開始偏緊', tight: '明顯緊俏', stress: '異常壓力', unavailable: '待資料確認'
}

export function StatusBadge({ status, provisional, large }: {
  status: Status; provisional?: boolean; large?: boolean
}) {
  return <span className={`badge ${status}${large ? ' badge-lg' : ''}`}>
    {STATUS_NAMES[status]}{provisional && status !== 'unavailable' ? '（暫定）' : ''}
  </span>
}

export function Card({ title, value, unit, hint, children }: {
  title: string; value: string; unit?: string; hint?: string; children?: ReactNode
}) {
  return <article className="card">
    <p className="card-title">{title}</p>
    <div className="metric"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>
    {hint && <p className="hint">{hint}</p>}
    {children}
  </article>
}

export function EventFlags({ flags }: { flags: EventFlag[] }) {
  if (!flags.length) return null
  return <div className="flags">{flags.map(flag => <span key={flag} className="flag">{flag}</span>)}</div>
}

export function Stats({ stats }: { stats: StressStats }) {
  const display = (value: number | null, suffix = '') => value === null ? '—' : `${value.toFixed(1)}${suffix}`
  return <div className="stats-grid">
    <span>TFSS 60 日百分位 <b>{display(stats.percentile60, '%')}</b></span>
    <span>TFSS 120 日百分位 <b>{display(stats.percentile120, '%')}</b></span>
    <span>TFSS 120 日 Z-score <b>{display(stats.zScore120)}</b></span>
    <span>有效樣本 <b>{stats.sample120 >= 120 ? stats.sample120 : stats.sample60} 個交易日</b></span>
  </div>
}

// ---------------------------------------------------------------------------
// 第二／第三部分的核心版型：左圖右文
// ---------------------------------------------------------------------------

/** 年增率這類百分比序列的月變動要標「個百分點」，否則與「%」混淆 */
function deltaLabel(delta: number | null, unit: string): string {
  if (delta === null || delta === 0) return ''
  const digits = unit === '%' ? 2 : 0
  const suffix = unit === '%' ? ' 個百分點' : ` ${unit}`
  return `　較上月 ${delta > 0 ? '+' : ''}${delta.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`
}

const numberFor = (value: number | null | undefined, digits: number) =>
  value === null || value === undefined ? '—' : value.toLocaleString('zh-TW', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  })

/** 單一指標的迷你走勢圖，取最近 90 個有值的交易日 */
function MiniTrend({ history, dataKey, muted }: {
  history: HistoryPoint[]; dataKey: keyof HistoryPoint; muted?: boolean
}) {
  const data = history
    .map(point => ({ date: point.date.slice(5), value: point[dataKey] }))
    .filter(point => typeof point.value === 'number')
    .slice(-90)

  if (data.length < 2) return <div className="mini-empty">歷史資料不足，尚無走勢</div>

  const stroke = muted ? '#7b8b9c' : '#ffb55e'
  return <ResponsiveContainer width="100%" height={170}>
    <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
      <defs>
        <linearGradient id={`fill-${String(dataKey)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
      <XAxis dataKey="date" minTickGap={40} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} width={46} />
      <Tooltip formatter={(value: unknown) => typeof value === 'number' ? value.toFixed(2) : '—'} />
      <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2}
        fill={`url(#fill-${String(dataKey)})`} dot={false} connectNulls />
    </AreaChart>
  </ResponsiveContainer>
}

/**
 * 一個指標一列：左邊走勢圖、右邊文字。
 * 文字固定分成「這個指標在量什麼」與「現在的數字說什麼」兩段，
 * 未進入合成的指標以 muted 狀態呈現並標明原因 —— 這是設計好的狀態，不是錯誤。
 */
export function MetricRow({ definition, value, reading, history, dataKey, excluded, asOf }: {
  definition: Definition
  value: string
  reading: string
  history: HistoryPoint[]
  dataKey: keyof HistoryPoint
  excluded?: string
  asOf: string
}) {
  return <article className={`metric-row${excluded ? ' is-excluded' : ''}`}>
    <div className="metric-chart">
      <MiniTrend history={history} dataKey={dataKey} muted={Boolean(excluded)} />
    </div>
    <div className="metric-text">
      <header className="metric-head">
        <h3>{definition.title}</h3>
        <span className="freq">{definition.frequency}頻 · {asOf}</span>
      </header>
      <div className="metric-value">
        <strong>{value}</strong>{definition.unit && <span>{definition.unit}</span>}
        {excluded && <span className="excluded-tag">未計入 TSS</span>}
      </div>
      <dl>
        <dt>這個指標在量什麼</dt>
        <dd>{definition.meaning}</dd>
        <dt>現在的數字說什麼</dt>
        <dd>{reading}</dd>
      </dl>
      {definition.caveat && <p className="caveat">限制：{definition.caveat}</p>}
    </div>
  </article>
}

export function LayerHeader({ index, label, lead }: { index: number; label: string; lead: string }) {
  return <header className="layer-head">
    <span className="layer-index">{index}</span>
    <div>
      <h2>{label}</h2>
      <p>{lead}</p>
    </div>
  </header>
}

// ---------------------------------------------------------------------------
// 第一部分
// ---------------------------------------------------------------------------

export function AiCommentaryBlock({ commentary }: { commentary: AiCommentary | null }) {
  if (!commentary) {
    return <div className="ai-block ai-off">
      <p className="ai-label">AI 短評</p>
      <p className="muted">未產生。需在 repo secrets 設定 <code>OPENAI_API_KEY</code>；未設定時本區塊留空，上方規則式摘要不受影響。</p>
    </div>
  }
  return <div className="ai-block">
    <p className="ai-label">AI 短評 · {commentary.model}</p>
    {commentary.text.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    <p className="ai-foot">
      由 OpenAI {commentary.model} 依當日數據與新聞標題生成於 {new Date(commentary.generatedAt).toLocaleString('zh-TW')}，
      未經人工審閱，可能有誤，不構成投資、融資或交易建議。
    </p>
  </div>
}

export function NewsList({ items, digest }: { items: NewsItem[]; digest: NewsDigest | null }) {
  if (!items.length) return <p className="empty-chart">目前沒有取得相關新聞</p>
  const official = items.filter(item => item.official)
  const media = items.filter(item => !item.official)

  const render = (list: NewsItem[]) => <ul className="news">
    {list.map(item => (
      <li key={item.url}>
        <a href={item.url} target="_blank" rel="noreferrer noopener">{item.title}</a>
        <span className="news-meta">{item.source} · {item.date}</span>
      </li>
    ))}
  </ul>

  return <div className="news-wrap">
    {official.length > 0 && <div>
      <div className="news-head">
        <p className="news-group">央行官方新聞稿</p>
        <span className="news-basis">摘要依據新聞稿全文</span>
      </div>
      {digest?.official && <p className="news-digest">{digest.official}</p>}
      <details className="news-detail">
        <summary>{official.length} 則原始公告</summary>
        {render(official)}
      </details>
    </div>}

    {media.length > 0 && <div>
      <div className="news-head">
        <p className="news-group">財經媒體報導</p>
        <span className="news-basis warn">摘要僅依據標題</span>
      </div>
      {digest?.media && <p className="news-digest">{digest.media}</p>}
      <details className="news-detail">
        <summary>{media.length} 則原始標題</summary>
        {render(media)}
      </details>
      <p className="muted small">
        媒體全文未被讀取 —— 有版權與付費牆限制，外部網頁內容也是提示詞注入的常見載體。
        因此媒體摘要只是依標題歸納主題，實際內容請點連結查閱。標題與摘要皆未納入任何指標計算。
      </p>
    </div>}

    {digest && <p className="news-foot">
      本節摘要由 OpenAI {digest.model} 生成於 {new Date(digest.generatedAt).toLocaleString('zh-TW')}，未經人工審閱。
    </p>}
    {!digest && <p className="muted small">AI 摘要未產生，以下為原始標題列表。</p>}
  </div>
}

const INPUT_LABELS: Record<keyof CompositeInputs, string> = {
  tfss: 'TFSS',
  primarySecondary: '初次級利差',
  taiborSlope: 'TAIBOR 斜率',
  corridor: 'O/N 走廊位置',
  ncdNetIssuance: 'NCD 淨發行'
}

export function CompositeBreakdown({ inputs, excluded }: {
  inputs: CompositeInputs
  excluded?: { key: keyof CompositeInputs; reason: string }[]
}) {
  const dropped = new Set((excluded ?? []).map(entry => entry.key))
  const data = (Object.keys(INPUT_LABELS) as (keyof CompositeInputs)[])
    .filter(key => !dropped.has(key))
    .map(key => ({ name: INPUT_LABELS[key], z: inputs[key] }))
    .filter((entry): entry is { name: string; z: number } => entry.z !== null)

  if (!data.length) return <p className="empty-chart">子指標樣本不足，尚未產生 z-score 分解</p>

  return <>
    <ResponsiveContainer width="100%" height={40 + data.length * 34}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 72 }}>
        <XAxis type="number" domain={[-3, 3]} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={72} />
        <ReferenceLine x={0} stroke="rgba(255,255,255,0.35)" />
        <Tooltip formatter={(value: unknown) => typeof value === 'number' ? `z ${value.toFixed(2)}` : '—'} />
        <Bar dataKey="z" radius={[0, 3, 3, 0]}>
          {data.map(entry => (
            <Cell key={entry.name} fill={entry.z >= 1.5 ? '#ff8a6a' : entry.z >= 1 ? '#ffb55e' : entry.z <= -1 ? '#6fa8ff' : '#8ba0b5'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {excluded && excluded.length > 0 && (
      <ul className="excluded">{excluded.map(entry => <li key={entry.key}>{entry.reason}</li>)}</ul>
    )}
  </>
}

export function CompositeChart({ history, thresholds }: {
  history: HistoryPoint[]
  thresholds: { tightening: number; tight: number; stress: number }
}) {
  const data = history
    .filter(point => point.compositeZ5d !== null)
    .map(point => ({ date: point.date.slice(5), z: point.compositeZ5d, daily: point.compositeZ }))

  if (data.length < 2) return <p className="empty-chart">歷史資料累積後顯示綜合指數走勢</p>

  return <ResponsiveContainer width="100%" height={280}>
    <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
      <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 12 }} />
      <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
      <Tooltip formatter={(value: unknown) => typeof value === 'number' ? value.toFixed(2) : '—'} />
      <Legend />
      <ReferenceLine y={thresholds.tightening} stroke="#ffd08a" strokeDasharray="4 4" label={{ value: '開始偏緊', fontSize: 10, fill: '#ffd08a', position: 'insideTopLeft' }} />
      <ReferenceLine y={thresholds.tight} stroke="#ffb55e" strokeDasharray="4 4" label={{ value: '明顯緊俏', fontSize: 10, fill: '#ffb55e', position: 'insideTopLeft' }} />
      <ReferenceLine y={thresholds.stress} stroke="#ff8a6a" strokeDasharray="4 4" label={{ value: '異常壓力', fontSize: 10, fill: '#ff8a6a', position: 'insideTopLeft' }} />
      <Line type="monotone" dataKey="daily" name="當日 z" stroke="#5c6f82" strokeWidth={1} dot={false} connectNulls />
      <Line type="monotone" dataKey="z" name="5 日均 z" stroke="#ffb55e" strokeWidth={2.5} dot={false} connectNulls />
    </ComposedChart>
  </ResponsiveContainer>
}

// ---------------------------------------------------------------------------
// 背景面板
// ---------------------------------------------------------------------------

export function MonthlyPanel({ series, hints }: { series: MonthlySeries[]; hints: Record<string, string> }) {
  if (!series.length) return <p className="empty-chart">月頻背景資料尚未取得</p>
  return <div className="grid three">
    {series.map(item => {
      const last = item.points.at(-1)
      const prev = item.points.at(-2)
      const delta = last && prev ? last.value - prev.value : null
      return <Card
        key={item.key}
        title={item.label}
        value={last ? numberFor(last.value, item.unit === '%' ? 2 : 0) : '—'}
        unit={item.unit}
        hint={`${last?.period ?? '—'}${deltaLabel(delta, item.unit)}`}
      >
        <p className="hint">{hints[item.key] ?? item.hint}</p>
      </Card>
    })}
  </div>
}

export function WeeklyBillsChart({ points }: { points: WeeklyBillPoint[] }) {
  if (points.length < 2) return <p className="empty-chart">票券週統計尚未取得</p>
  const data = points.slice(-16).map(point => ({
    week: point.week.split('~')[0].trim().slice(5),
    承作: point.primaryIssue,
    兌償: point.primaryRedeem,
    淨額: point.primaryIssue - point.primaryRedeem
  }))
  return <ResponsiveContainer width="100%" height={240}>
    <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 6 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
      <XAxis dataKey="week" tick={{ fontSize: 11 }} minTickGap={16} />
      <YAxis tick={{ fontSize: 11 }} width={62} tickFormatter={(value: number) => `${Math.round(value / 1000)}k`} />
      <Tooltip formatter={(value: unknown) => typeof value === 'number' ? `${value.toLocaleString('zh-TW')} 百萬` : '—'} />
      <Legend />
      <Bar dataKey="承作" fill="#6fa8ff" radius={[3, 3, 0, 0]} />
      <Bar dataKey="兌償" fill="#5c6f82" radius={[3, 3, 0, 0]} />
      <Line type="monotone" dataKey="淨額" stroke="#ffb55e" strokeWidth={2} dot={false} />
    </ComposedChart>
  </ResponsiveContainer>
}

export function AuctionTable({ auctions }: { auctions: NcdAuction[] }) {
  if (!auctions.length) return <p className="empty-chart">364 天期標售資料尚未取得</p>
  return <div className="table-wrap">
    <table>
      <thead><tr><th>標售月份</th><th>發行總額（億）</th><th>投標總額（億）</th><th>投標倍數</th><th>得標加權平均利率</th></tr></thead>
      <tbody>
        {[...auctions].reverse().slice(0, 8).map(auction => (
          <tr key={auction.date}>
            <td>{auction.date.slice(0, 7)}</td>
            <td>{auction.issueAmount.toLocaleString('zh-TW')}</td>
            <td>{auction.bidAmount.toLocaleString('zh-TW')}</td>
            <td>{auction.bidToCover.toFixed(2)}</td>
            <td>{auction.awardRate.toFixed(3)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
}

export function SpreadChart({ history }: { history: HistoryPoint[] }) {
  const data = history
    .filter(point => point.tfssBp !== null)
    .map(point => ({
      date: point.date.slice(5),
      tfss: point.tfssBp,
      spread: point.primarySecondaryBp,
      slope: point.taiborSlopeBp
    }))

  if (data.length < 2) return <p className="empty-chart">歷史資料累積後顯示利差走勢</p>

  return <ResponsiveContainer width="100%" height={260}>
    <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
      <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 12 }} />
      <YAxis unit="bp" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
      <Tooltip formatter={(value: unknown) => typeof value === 'number' ? `${value.toFixed(1)} bp` : '—'} />
      <Legend />
      <Line type="monotone" dataKey="tfss" name="TFSS" stroke="#ffb55e" strokeWidth={2.5} dot={false} connectNulls />
      <Line type="monotone" dataKey="spread" name="初級－次級" stroke="#6fa8ff" strokeWidth={1.8} dot={false} connectNulls />
      <Line type="monotone" dataKey="slope" name="TAIBOR 1W–3M 斜率" stroke="#7fd6a6" strokeWidth={1.8} dot={false} connectNulls />
    </LineChart>
  </ResponsiveContainer>
}
