import type { ReactNode } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MarketSnapshot, Status, StressStats } from './types'

export function StatusBadge({ status }: { status: Status }) {
  const names: Record<Status, string> = { normal: '正常', tightening: '開始偏緊', tight: '明顯緊俏', stress: '異常壓力', unavailable: '待資料確認' }
  return <span className={`badge ${status}`}>{names[status]}</span>
}

export function Card({ title, value, unit, hint, children }: { title: string; value: string; unit?: string; hint?: string; children?: ReactNode }) {
  return <article className="card">
    <p className="card-title">{title}</p>
    <div className="metric"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>
    {hint && <p className="hint">{hint}</p>}
    {children}
  </article>
}

export function Stats({ stats }: { stats: StressStats }) {
  const display = (value: number | null, suffix = '') => value === null ? '—' : `${value.toFixed(1)}${suffix}`
  return <div className="stats-grid">
    <span>60 日百分位 <b>{display(stats.percentile60, '%')}</b></span>
    <span>120 日百分位 <b>{display(stats.percentile120, '%')}</b></span>
    <span>60 日 Z-score <b>{display(stats.zScore60)}</b></span>
    <span>120 日 Z-score <b>{display(stats.zScore120)}</b></span>
  </div>
}

export function TrendChart({ market }: { market: MarketSnapshot }) {
  const data = market.tfssBp === null ? [] : [{ date: market.date.slice(5), tfss: market.tfssBp }]
  return <div className="chart" aria-label="TFSS 趨勢圖">
    {data.length < 2 ? <p className="empty-chart">歷史資料累積後顯示 TFSS 走勢</p> : <ResponsiveContainer width="100%" height={220}><LineChart data={data}><XAxis dataKey="date" /><YAxis unit="bp" /><Tooltip /><Line type="monotone" dataKey="tfss" stroke="#ffb55e" strokeWidth={3} /></LineChart></ResponsiveContainer>}
  </div>
}
