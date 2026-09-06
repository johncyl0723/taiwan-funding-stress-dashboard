import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import type {
  CompositeInputs, EventFlag, HistoryPoint, MonthlySeries, NcdAuction, Status, StressStats, WeeklyBillPoint
} from './types'

const STATUS_NAMES: Record<Status, string> = {
  normal: '正常', tightening: '開始偏緊', tight: '明顯緊俏', stress: '異常壓力', unavailable: '待資料確認'
}

export function StatusBadge({ status, provisional }: { status: Status; provisional?: boolean }) {
  return <span className={`badge ${status}`}>
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

const INPUT_LABELS: Record<keyof CompositeInputs, string> = {
  tfss: 'TFSS',
  primarySecondary: '初次級利差',
  taiborSlope: 'TAIBOR 斜率',
  corridor: 'O/N 走廊位置',
  ncdNetIssuance: 'NCD 淨發行'
}

/** 五個子指標的 z-score 橫條，負值往左、正值往右；未納入合成者另外列出 */
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
  <ResponsiveContainer width="100%" height={190}>
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 68 }}>
      <XAxis type="number" domain={[-3, 3]} tick={{ fontSize: 11 }} />
      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={68} />
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
    <ul className="excluded">
      {excluded.map(entry => <li key={entry.key}>{entry.reason}</li>)}
    </ul>
  )}
  </>
}

const bpTooltip = (value: unknown) => typeof value === 'number' ? `${value.toFixed(1)} bp` : '—'

/** composite 5 日均 + 燈號門檻參考線 */
export function CompositeChart({ history, thresholds }: {
  history: HistoryPoint[]
  thresholds: { tightening: number; tight: number; stress: number }
}) {
  const data = history
    .filter(point => point.compositeZ5d !== null)
    .map(point => ({ date: point.date.slice(5), z: point.compositeZ5d, daily: point.compositeZ }))

  if (data.length < 2) return <p className="empty-chart">歷史資料累積後顯示綜合指標走勢</p>

  return <ResponsiveContainer width="100%" height={260}>
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
      <Tooltip formatter={bpTooltip} />
      <Legend />
      <Line type="monotone" dataKey="tfss" name="TFSS" stroke="#ffb55e" strokeWidth={2.5} dot={false} connectNulls />
      <Line type="monotone" dataKey="spread" name="初級－次級" stroke="#6fa8ff" strokeWidth={1.8} dot={false} connectNulls />
      <Line type="monotone" dataKey="slope" name="TAIBOR 1W–3M 斜率" stroke="#7fd6a6" strokeWidth={1.8} dot={false} connectNulls />
    </LineChart>
  </ResponsiveContainer>
}

export function MonthlyPanel({ series }: { series: MonthlySeries[] }) {
  if (!series.length) return <p className="empty-chart">月頻背景資料尚未取得</p>
  return <div className="grid three">
    {series.map(item => {
      const last = item.points.at(-1)
      const prev = item.points.at(-2)
      const delta = last && prev ? last.value - prev.value : null
      return <Card
        key={item.key}
        title={item.label}
        value={last ? last.value.toLocaleString('zh-TW') : '—'}
        unit={item.unit}
        hint={`${last?.period ?? '—'}｜${delta === null ? '' : `較上月 ${delta >= 0 ? '+' : ''}${delta.toLocaleString('zh-TW')}　`}${item.hint}`}
      />
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
