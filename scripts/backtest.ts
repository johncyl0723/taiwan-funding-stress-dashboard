/**
 * 回測腳本：把 TAIBIR 與 TAIBOR 回補到指定年份，重建 composite 燈號，
 * 檢查已知的資金壓力段落有沒有亮燈，並依實際分位建議門檻。
 *
 *   npm run backtest -- --from=2018-01-01
 *   npm run backtest -- --from=2009-01-01 --out=public/data/backtest.json
 *
 * 這是一次性／低頻工具，不在每日排程內：TDCC 單次查詢上限約半年，
 * 回補 17 年需要數十次請求。NCD、外資、SOFR 無法回補這麼久，
 * 因此回測時的 composite 只由 TFSS、初次級利差、TAIBOR 斜率三項合成。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHistory } from './lib/history.js'
import { THRESHOLDS } from './lib/composite.js'
import { fetchTaiborRange } from './lib/sources/taibor.js'
import { TDCC_PRIMARY, TDCC_SECONDARY, fetchTaibirRange } from './lib/sources/taibir.js'
import { fetchPolicyRates } from './lib/sources/cbc.js'
import { taipeiDateDaysAgo } from './lib/fetch.js'
import type { DailyObservation, HistoryPoint, TermCurve } from '../src/types.js'

/**
 * 檢查段落。`expectFlag` 標示這一段「應不應該」亮燈：
 *
 * 政策升息不是資金壓力事件。TFSS 的兩隻腳（票券初級利率、TAIBOR）在
 * 央行調升政策利率時同步上移，價差不變甚至收斂，所以燈號不亮是正確行為，
 * 不是漏報。真正該亮的是信用或流動性事件（價差單邊擴大）。
 */
const KNOWN_EPISODES: { label: string; from: string; to: string; expectFlag: boolean; note: string }[] = [
  { label: 'COVID 美元荒', from: '2020-03-01', to: '2020-04-30', expectFlag: true, note: '流動性事件，價差應單邊擴大' },
  { label: '央行升息循環起點', from: '2022-03-01', to: '2022-04-30', expectFlag: false, note: '政策重定價，兩腳同步上移' },
  { label: '升息循環末段', from: '2023-03-01', to: '2023-04-30', expectFlag: false, note: '政策重定價，兩腳同步上移' },
  { label: '2024 年 3 月升息', from: '2024-03-01', to: '2024-04-30', expectFlag: false, note: '政策重定價，兩腳同步上移' }
]

function arg(name: string, fallback: string): string {
  const found = process.argv.find(item => item.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * q
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)) * 1000) / 1000
}

async function main() {
  const from = arg('from', '2018-01-01')
  const to = arg('to', taipeiDateDaysAgo(0))
  const outPath = arg('out', 'public/data/backtest.json')

  console.log(`回補 ${from} ~ ${to}…（TDCC 逐段查詢，會花幾分鐘）`)
  const [primary, secondary, taibor, policyRates] = await Promise.all([
    fetchTaibirRange(TDCC_PRIMARY, from, to),
    fetchTaibirRange(TDCC_SECONDARY, from, to),
    fetchTaiborRange(from, to),
    fetchPolicyRates().catch(() => [])
  ])
  console.log(`  TAIBIR 初級 ${primary.size} 日、次級 ${secondary.size} 日、TAIBOR ${taibor.size} 日`)

  const empty: TermCurve = {}
  const dates = [...new Set([...primary.keys(), ...taibor.keys()])].sort().filter(date => date >= from && date <= to)
  const observations: DailyObservation[] = dates.map(date => ({
    date,
    taibirPrimary: primary.get(date) ?? empty,
    taibirSecondary: secondary.get(date) ?? empty,
    taibor: taibor.get(date) ?? empty,
    overnightRate: null,
    ncdNetIssuance: null,
    ncdOutstanding: null,
    ncdRates: empty,
    repoOperation: false,
    foreignNet: null,
    usdTwd: null,
    sofr30: null,
    sofr90: null,
    sofr180: null
  }))

  // 一次建完整段：分段重建會讓每段開頭的 30 個交易日樣本不足，產生假性 unavailable
  const history: HistoryPoint[] = buildHistory([], observations, policyRates, {
    maxHistory: observations.length
  })

  const scores = history.map(point => point.compositeZ5d).filter((value): value is number => value !== null)
  const tfss = history.map(point => point.tfssBp).filter((value): value is number => value !== null)

  const statusCounts = history.reduce<Record<string, number>>((counts, point) => {
    counts[point.status] = (counts[point.status] ?? 0) + 1
    return counts
  }, {})

  const episodes = KNOWN_EPISODES.map(episode => {
    const window = history.filter(point => point.date >= episode.from && point.date <= episode.to)
    const peak = window.reduce<HistoryPoint | null>(
      (best, point) => (point.compositeZ5d ?? -Infinity) > (best?.compositeZ5d ?? -Infinity) ? point : best,
      null
    )
    const flagged = window.some(point => point.status === 'tight' || point.status === 'stress')
    return {
      ...episode,
      tradingDays: window.length,
      peakComposite: peak?.compositeZ5d ?? null,
      peakDate: peak?.date ?? null,
      peakStatus: peak?.status ?? 'unavailable',
      flagged,
      // 沒有資料的段落無從判斷，不算通過也不算失敗
      verdict: window.length === 0 ? 'no-data' : flagged === episode.expectFlag ? 'pass' : 'fail'
    }
  })

  const suggested = {
    tightening: quantile(scores, 0.80),
    tight: quantile(scores, 0.92),
    stress: quantile(scores, 0.98)
  }

  const stressEpisodes = episodes.filter(episode => episode.expectFlag && episode.tradingDays > 0)
  const report = {
    generatedAt: new Date().toISOString(),
    range: { from, to, tradingDays: history.length },
    note: 'NCD、外資、SOFR、O/N 走廊無法回補至此區間，composite 僅由 TFSS、初次級利差、TAIBOR 斜率合成，門檻建議值與線上即時值不完全可比。',
    thresholdWarning: stressEpisodes.length === 0
      ? '本區間不含任何真實資金壓力事件（升息屬政策重定價，非壓力），因此分位數建議門檻只是把燈號固定點亮 20%／8%／2% 的時間，並不是校準。在找到含壓力事件的區間之前，維持常態近似初值。'
      : `本區間含 ${stressEpisodes.length} 個壓力事件，分位建議門檻可作為校準參考。`,
    tfss: {
      min: tfss.length ? Math.min(...tfss) : null,
      max: tfss.length ? Math.max(...tfss) : null,
      median: quantile(tfss, 0.5)
    },
    composite: {
      count: scores.length,
      p80: suggested.tightening,
      p92: suggested.tight,
      p98: suggested.stress,
      max: scores.length ? Math.max(...scores) : null
    },
    currentThresholds: THRESHOLDS,
    suggestedThresholds: suggested,
    statusCounts,
    episodes
  }

  const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', outPath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({ report, history }, null, 2)}\n`)

  console.log(`\n交易日 ${history.length}，TFSS ${report.tfss.min}~${report.tfss.max} bp`)
  console.log(`燈號分布：${JSON.stringify(statusCounts)}`)
  console.log(`門檻：目前 ${JSON.stringify(THRESHOLDS)} → 依實際分位建議 ${JSON.stringify(suggested)}`)
  const marks: Record<string, string> = { pass: '✔', fail: '✘', 'no-data': '·' }
  for (const episode of episodes) {
    console.log(`  ${marks[episode.verdict]} ${episode.label}（${episode.tradingDays} 日，預期${episode.expectFlag ? '亮燈' : '不亮'}）峰值 ${episode.peakComposite ?? '—'} @ ${episode.peakDate ?? '—'} → ${episode.peakStatus}｜${episode.note}`)
  }
  console.log(`
${report.thresholdWarning}`)
  console.log(`\n報告已寫入 ${outPath}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
