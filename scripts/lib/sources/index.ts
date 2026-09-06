import { latestKey } from '../fetch.js'
import { fetchNcdSeries, fetchOvernightSeries, fetchPolicyRates, fetchUsdTwdSeries, type NcdDaily } from './cbc.js'
import { fetchForeignNetSeries, fetchSofrSeries } from './market.js'
import { fetchTaiborCurve } from './taibor.js'
import { TDCC_PRIMARY, TDCC_SECONDARY, fetchTaibirCurve } from './taibir.js'
import type { DailyObservation, MarketFetchResult, PolicyRate, SourceRef, TermCurve } from '../../../src/types.js'

/** 外資買賣超只能逐日查詢，回補天數要克制 */
const FOREIGN_LOOKBACK_DAYS = 12

export async function fetchMarketSeries(lookbackDays = 200): Promise<MarketFetchResult> {
  const status: Record<string, string> = {}

  const run = async <T>(key: string, task: () => Promise<T>, size?: (result: T) => number): Promise<T | null> => {
    try {
      const result = await task()
      const count = size ? `${size(result)} 筆` : '完成'
      status[key] = `${key} 已讀取（${count}）`
      return result
    } catch (error) {
      status[key] = `${key} 讀取失敗：${error instanceof Error ? error.message : String(error)}`
      return null
    }
  }

  const mapSize = (value: Map<string, unknown>) => value.size

  const [primary, secondary, taibor, overnight, ncd, policy, foreign, usdTwd, sofr] = await Promise.all([
    run('TDCC 初級', () => fetchTaibirCurve(TDCC_PRIMARY, lookbackDays), mapSize),
    run('TDCC 次級', () => fetchTaibirCurve(TDCC_SECONDARY, lookbackDays), mapSize),
    run('TAIBOR', () => fetchTaiborCurve(lookbackDays), mapSize),
    run('央行 O/N', () => fetchOvernightSeries(lookbackDays), mapSize),
    run('央行 NCD', () => fetchNcdSeries(), mapSize),
    run('央行貼放利率', () => fetchPolicyRates(), rates => rates.length),
    run('外資買賣超', () => fetchForeignNetSeries(FOREIGN_LOOKBACK_DAYS), mapSize),
    run('新臺幣匯率', () => fetchUsdTwdSeries(lookbackDays), mapSize),
    run('USD SOFR', () => fetchSofrSeries(lookbackDays), mapSize)
  ])

  // TFSS 的兩隻腳是核心來源；其餘缺漏降級為空值，不拖垮整批更新
  if (!primary || !taibor) throw new Error(`核心來源缺漏，不發布：${JSON.stringify(status)}`)

  const dates = [...new Set([...primary.keys(), ...taibor.keys()])].sort()
  const empty: TermCurve = {}
  const observations: DailyObservation[] = dates.map(date => {
    const ncdDay: NcdDaily | undefined = ncd?.get(date)
    const sofrDay = sofr?.get(date)
    return {
      date,
      taibirPrimary: primary.get(date) ?? empty,
      taibirSecondary: secondary?.get(date) ?? empty,
      taibor: taibor.get(date) ?? empty,
      overnightRate: overnight?.get(date) ?? null,
      ncdNetIssuance: ncdDay?.netIssuanceMillion ?? null,
      ncdOutstanding: ncdDay?.outstandingMillion ?? null,
      ncdRates: ncdDay?.rates ?? empty,
      repoOperation: ncdDay?.repoOperation ?? false,
      foreignNet: foreign?.get(date) ?? null,
      usdTwd: usdTwd?.get(date) ?? null,
      sofr30: sofrDay?.d30 ?? null,
      sofr90: sofrDay?.d90 ?? null,
      sofr180: sofrDay?.d180 ?? null
    }
  })

  const policyRate: PolicyRate | null = policy?.at(-1) ?? null
  const sources: SourceRef[] = [
    { label: 'TDCC TAIBIR 初級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_5', asOf: latestKey(primary) },
    { label: 'TDCC TAIBIR 次級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_6', asOf: latestKey(secondary) },
    { label: '銀行公會 TAIBOR（每日＋月報 CSV）', url: 'https://www.ba.org.tw/taiborDaily/index', asOf: latestKey(taibor) },
    { label: '中央銀行金融業隔夜拆款', url: 'https://www.cbc.gov.tw/tw/lp-641-1.html', asOf: latestKey(overnight) },
    { label: '中央銀行公開市場操作', url: 'https://www.cbc.gov.tw/tw/lp-1163-1.html', asOf: latestKey(ncd) },
    { label: '中央銀行貼放利率', url: 'https://www.cbc.gov.tw/tw/lp-370-1.html', asOf: policyRate?.effectiveFrom ?? '—' },
    { label: '證交所三大法人買賣金額', url: 'https://www.twse.com.tw/zh/trading/foreign/bfi82u.html', asOf: latestKey(foreign) },
    { label: '中央銀行新臺幣對美元收盤匯率', url: 'https://www.cbc.gov.tw/tw/lp-645-1.html', asOf: latestKey(usdTwd) },
    { label: 'NY Fed SOFR 平均指數', url: 'https://www.newyorkfed.org/markets/reference-rates/sofr-averages-and-index', asOf: latestKey(sofr) }
  ]

  return { observations, policyRate, sources, sourceStatus: status }
}
