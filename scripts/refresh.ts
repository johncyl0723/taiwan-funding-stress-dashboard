import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInsight } from './lib/insight.js'
import { buildHistory } from './lib/history.js'
import { fetchMarketSeries } from './lib/sources.js'
import type { DashboardPayload, HistoryPoint, MarketSnapshot } from '../src/types.js'

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
  const fetched = await fetchMarketSeries()
  const previousHistory = await readJson<HistoryPoint[]>(historyPath, [])
  const previousDashboard = await readJson<DashboardPayload | null>(dashboardPath, null)

  const history = buildHistory(previousHistory, fetched.observations)
  const latest = history.at(-1)
  if (!latest) throw new Error('合併後無任何可用交易日資料')

  const market: MarketSnapshot = {
    ...latest,
    updatedAt: new Date().toISOString(),
    sourceStatus: fetched.sourceStatus,
    sources: fetched.sources
  }

  const payload: DashboardPayload = {
    market,
    insight: buildInsight(market),
    bankMetrics: previousDashboard?.bankMetrics ?? []
  }

  await mkdir(path.dirname(dashboardPath), { recursive: true })
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`)
  await writeFile(dashboardPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`已更新 ${market.date} 資料，狀態：${market.status}，歷史 ${history.length} 個交易日`)
  for (const line of Object.values(fetched.sourceStatus)) console.log(`  ${line}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
