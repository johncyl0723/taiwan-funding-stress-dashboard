import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInsight } from './lib/insight.js'
import { buildHistory } from './lib/history.js'
import { fetchMarketSeries } from './lib/sources/index.js'
import { fetchNcdAuctions } from './lib/sources/cbc.js'
import { fetchMonthlySeries, fetchWeeklyBills } from './lib/sources/background.js'
import { fetchNews } from './lib/sources/news.js'
import { buildAiCommentary } from './lib/commentary.js'
import type { BackgroundPayload, DashboardPayload, HistoryPoint, NewsItem, SourceRef } from '../src/types.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, '../public/data')
const dashboardPath = path.join(dataDir, 'dashboard.json')
const historyPath = path.join(dataDir, 'history.json')
const backgroundPath = path.join(dataDir, 'background.json')

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** 月頻與週頻資料變動慢，抓取失敗時沿用上一次的檔案而不是清空 */
async function buildBackground(previous: BackgroundPayload | null): Promise<{ payload: BackgroundPayload; status: Record<string, string> }> {
  const monthly = await fetchMonthlySeries()
  const status = { ...monthly.status }

  const weeklyBills = await fetchWeeklyBills().then(
    result => { status['票券週統計'] = `票券週統計 已讀取（${result.length} 週）`; return result },
    error => { status['票券週統計'] = `票券週統計 讀取失敗：${error instanceof Error ? error.message : String(error)}`; return previous?.weeklyBills ?? [] }
  )
  const ncdAuctions = await fetchNcdAuctions().then(
    result => { status['364D NCD 標售'] = `364D NCD 標售 已讀取（${result.length} 次）`; return result },
    error => { status['364D NCD 標售'] = `364D NCD 標售 讀取失敗：${error instanceof Error ? error.message : String(error)}`; return previous?.ncdAuctions ?? [] }
  )

  const sources: SourceRef[] = [
    { label: '央行 OpenData 貨幣總計數與準備貨幣', url: 'https://data.gov.tw/dataset/6024', asOf: monthly.series.find(s => s.key === 'm2YoY')?.points.at(-1)?.period ?? '—' },
    { label: '央行 OpenData 金融機構存款準備金', url: 'https://data.gov.tw/dataset/16900', asOf: monthly.series.find(s => s.key === 'excessReserve')?.points.at(-1)?.period ?? '—' },
    { label: '央行 OpenData 五大銀行存放款利率', url: 'https://data.gov.tw/dataset/10359', asOf: monthly.series.find(s => s.key === 'bigFiveBaseRate')?.points.at(-1)?.period ?? '—' },
    { label: '集保票券保管結算交割週統計', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main02_3', asOf: weeklyBills.at(-1)?.week ?? '—' },
    { label: '央行 364 天期定期存單開標結果', url: 'https://www.cbc.gov.tw/tw/lp-1163-1.html', asOf: ncdAuctions.at(-1)?.date ?? '—' }
  ]

  return {
    payload: {
      monthly: monthly.series.length ? monthly.series : previous?.monthly ?? [],
      weeklyBills,
      ncdAuctions,
      updatedAt: new Date().toISOString(),
      sources
    },
    status
  }
}

async function main() {
  const fetched = await fetchMarketSeries()
  const previousHistory = await readJson<HistoryPoint[]>(historyPath, [])
  const previousBackground = await readJson<BackgroundPayload | null>(backgroundPath, null)

  const history = buildHistory(previousHistory, fetched.observations, fetched.policyRate ? [fetched.policyRate] : [])
  const latest = history.at(-1)
  if (!latest) throw new Error('合併後無任何可用交易日資料')

  const background = await buildBackground(previousBackground)
  const sourceStatus = { ...fetched.sourceStatus, ...background.status }

  // 新聞失敗不影響資料發布
  const news: NewsItem[] = await fetchNews().then(
    result => { sourceStatus['新聞'] = `新聞 已讀取（${result.status}）`; return result.items },
    error => { sourceStatus['新聞'] = `新聞 讀取失敗：${error instanceof Error ? error.message : String(error)}`; return [] }
  )

  const ai = await buildAiCommentary(latest, history.at(-2), news)
  sourceStatus['AI 評論'] = ai.status

  const payload: DashboardPayload = {
    market: {
      ...latest,
      updatedAt: new Date().toISOString(),
      sources: fetched.sources,
      sourceStatus,
      policyRate: fetched.policyRate
    },
    insight: buildInsight(latest, history, fetched.policyRate),
    aiCommentary: ai.commentary,
    news
  }

  await mkdir(dataDir, { recursive: true })
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`)
  await writeFile(dashboardPath, `${JSON.stringify(payload, null, 2)}\n`)
  await writeFile(backgroundPath, `${JSON.stringify(background.payload, null, 2)}\n`)

  console.log(`已更新 ${latest.date}，燈號：${latest.status}，composite 5 日均 ${latest.compositeZ5d ?? '—'}，歷史 ${history.length} 個交易日`)
  for (const line of Object.values(sourceStatus)) console.log(`  ${line}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
