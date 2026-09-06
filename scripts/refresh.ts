import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInsight } from './lib/insight.js'
import { bp, computeStats, stressStatus } from './lib/metrics.js'
import { fetchMarketSources } from './lib/sources.js'
import type { DashboardPayload, MarketSnapshot } from '../src/types.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const dashboardPath = path.join(root, '../public/data/dashboard.json')
const historyPath = path.join(root, '../public/data/history.json')

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function main() {
  const raw = await fetchMarketSources()
  const previousHistory = await readJson<MarketSnapshot[]>(historyPath, [])
  const previousDashboard = await readJson<DashboardPayload | null>(dashboardPath, null)

  const withoutSameDate = previousHistory.filter(item => item.date !== raw.date)
  const provisionalTfss = bp(raw.taibir90Primary - raw.taibor3m)
  const values = [...withoutSameDate, { tfssBp: provisionalTfss }].map(item => item.tfssBp).filter((value): value is number => value !== null)
  const stats = computeStats(values)
  const fiveBack = withoutSameDate.at(-5)?.tfssBp ?? null
  const recentNcd = [...withoutSameDate.slice(-4).map(item => item.ncdNetIssuance5d ?? 0), raw.ncdNetIssuance]

  const market: MarketSnapshot = {
    date: raw.date,
    updatedAt: new Date().toISOString(),
    status: stressStatus(stats),
    tfssBp: provisionalTfss,
    tfssChange5dBp: fiveBack === null ? null : bp(provisionalTfss / 100 - fiveBack / 100),
    taibir90Primary: raw.taibir90Primary,
    taibir90Secondary: raw.taibir90Secondary,
    primarySecondaryBp: bp(raw.taibir90Primary - raw.taibir90Secondary),
    taibor3m: raw.taibor3m,
    overnightRate: raw.overnightRate,
    ncdNetIssuance5d: recentNcd.length === 5 ? recentNcd.reduce((sum, value) => sum + value, 0) : null,
    stats,
    sourceStatus: raw.sourceStatus,
    sources: raw.sources
  }

  const payload: DashboardPayload = {
    market,
    insight: buildInsight(market),
    bankMetrics: previousDashboard?.bankMetrics ?? []
  }

  const nextHistory = [...withoutSameDate, market].slice(-260)
  await mkdir(path.dirname(dashboardPath), { recursive: true })
  await writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`)
  await writeFile(dashboardPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`已更新 ${raw.date} 資料，狀態：${market.status}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
