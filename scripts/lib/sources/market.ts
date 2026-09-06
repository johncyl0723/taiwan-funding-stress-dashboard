import { fetchJson, isWeekend, mapLimited, recentWeekdays } from '../fetch.js'

/** TWSE 三大法人買賣金額只提供單日查詢，回補靠逐日打 API */
const TWSE_URL = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U'
const FOREIGN_LABEL = '外資及陸資(不含外資自營商)'

interface TwseResponse {
  stat?: string
  date?: string
  data?: string[][]
}

/**
 * 外資及陸資買賣超（元 → 百萬元）。
 * 假日與無交易日 API 會回 stat 非 OK 或空 data，直接略過該日。
 */
export async function fetchForeignNetSeries(days: number): Promise<Map<string, number>> {
  const dates = recentWeekdays(days).filter(date => !isWeekend(date))
  const series = new Map<string, number>()
  await mapLimited(dates, 3, async date => {
    try {
      const payload = await fetchJson<TwseResponse>(
        `${TWSE_URL}?dayDate=${date.replace(/-/g, '')}&type=day&response=json`
      )
      if (payload.stat !== 'OK' || !payload.data?.length) return
      const row = payload.data.find(entry => entry[0]?.trim() === FOREIGN_LABEL)
      if (!row) return
      const net = Number(row[3].replace(/,/g, ''))
      if (Number.isFinite(net)) series.set(date, Math.round(net / 1_000_000))
    } catch {
      // 單日失敗只讓該日為空值
    }
  })
  if (!series.size) throw new Error('查無外資買賣超資料')
  return series
}

interface SofrRow {
  effectiveDate: string
  average30day: number
  average90day: number
  average180day: number
}

/** NY Fed SOFR 平均指數：30／90／180 日複合平均 */
export async function fetchSofrSeries(days: number): Promise<Map<string, { d30: number; d90: number; d180: number }>> {
  const payload = await fetchJson<{ refRates?: SofrRow[] }>(
    `https://markets.newyorkfed.org/api/rates/secured/sofrai/last/${Math.max(1, days)}.json`
  )
  const series = new Map<string, { d30: number; d90: number; d180: number }>()
  for (const row of payload.refRates ?? []) {
    if (!row.effectiveDate) continue
    series.set(row.effectiveDate, {
      d30: row.average30day,
      d90: row.average90day,
      d180: row.average180day
    })
  }
  if (!series.size) throw new Error('查無 SOFR 資料')
  return series
}
