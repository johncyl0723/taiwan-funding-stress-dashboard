import type { ReactNode } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { HistoryPoint, Status, StressStats } from './types'

export function StatusBadge({ status, provisional }: { status: Status; provisional?: boolean }) {
  const names: Record<Status, string> = { normal: '正常', tightening: '開始偏緊', tight: '明顯緊俏', stress: '異常壓力', unavailable: '待資料確認' }
  return <span className={`badge ${status}`}>{names[status]}{provisional && status !== 'unavailable' ? '（暫定）' : ''}</span>
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
    <span>有效樣本 <b>{stats.sample60 >= 120 ? stats.sample120 : stats.sample60} 個交易日</b></span>
  </div>
}

export function TrendChart({ history }: { history: HistoryPoint[] }) {
  const data = history
    .filter(point => point.tfssBp !== null)
    .map(point => ({ date: point.date.slice(5), tfss: point.tfssBp, spread: point.primarySecondaryBp }))

  if (data.length < 2) return <div className="chart"><p className="empty-chart">歷史資料累積後顯示 TFSS 走勢</p></div>

  return <div className="chart" aria-label="TFSS 趨勢圖">
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
        <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 12 }} />
        <YAxis unit="bp" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
        <Tooltip formatter={value => typeof value === 'number' ? `${value.toFixed(1)} bp` : '—'} />
        <Legend />
        <Line type="monotone" dataKey="tfss" name="TFSS" stroke="#ffb55e" strokeWidth={2.5} dot={false} connectNulls />
        <Line type="monotone" dataKey="spread" name="初級－次級" stroke="#6fa8ff" strokeWidth={1.8} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  </div>
}
