import { clean, columnIndex, taipeiDateDaysAgo } from '../fetch.js'
import type { TermCurve } from '../../../src/types.js'

const UA = 'TaiwanFundingDashboard/1.0 (public-market-research)'

export const TDCC_PRIMARY = 'tc_05sat_main03_5'
export const TDCC_SECONDARY = 'tc_05sat_main03_6'

/** TDCC 單次查詢上限約半年，超過會回空表 */
const MAX_SEGMENT_DAYS = 170

export type CurveSeries = Map<string, TermCurve>

/**
 * TDCC 只提供「當日」定盤利率頁面，週末或假日該列會是空白儲存格。
 * 改用官方歷史區間查詢（POST + CSRF token + session cookie），一次取回整段區間，
 * 讓統計窗格可以立即回補，而不是從零開始每天累積。
 *
 * SYNCHRONIZER_TOKEN 是一次性的：同一 session 重複 POST 會回空表，
 * 所以每個區段都必須重新 GET 一次表單頁取得新 token。
 */
async function fetchSegment(path: string, startDate: string, endDate: string): Promise<CurveSeries> {
  const url = `https://www.tdcc.com.tw/portal/zh/tcWeb/${path}`
  const getResponse = await fetch(url, { headers: { 'User-Agent': UA } })
  const getHtml = await getResponse.text()
  const cookie = (getResponse.headers.getSetCookie?.() ?? []).map(entry => entry.split(';')[0]).join('; ')
  const token = getHtml.match(/name="SYNCHRONIZER_TOKEN" value="([^"]+)"/)?.[1]
  const uri = getHtml.match(/name="SYNCHRONIZER_URI" value="([^"]+)"/)?.[1]
  if (!token || !uri) throw new Error('找不到查詢表單 token')

  const body = new URLSearchParams({
    SYNCHRONIZER_TOKEN: token,
    SYNCHRONIZER_URI: uri,
    method: 'submit',
    startDate,
    endDate
  })
  const postResponse = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: body.toString()
  })
  const postHtml = await postResponse.text()
  const table = postHtml.match(/<table class="table">[\s\S]*?<\/table>/)?.[0]
  if (!table) throw new Error(`查無歷史資料表格（${startDate}~${endDate}）`)

  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => clean(match[1]))
  // 表頭第一欄是「日期\天期」，其餘為天期數字；依表頭定位而非固定欄序
  const terms = headers
    .map((header, index) => ({ header, index }))
    .filter(entry => /^\d+$/.test(entry.header))
  if (!terms.length) throw new Error(`TDCC 定盤利率表頭無天期欄位（${headers.join('/')}）`)
  columnIndex(headers, '90', 'TDCC 定盤利率')

  const series: CurveSeries = new Map()
  for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1]))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '')) continue
    const curve: TermCurve = {}
    for (const term of terms) {
      const raw = cells[term.index]
      const value = Number(raw)
      if (raw !== undefined && raw !== '' && Number.isFinite(value)) curve[term.header] = value
    }
    if (Object.keys(curve).length) series.set(cells[0], curve)
  }
  return series
}

/** 把長區間切成 TDCC 接受的區段，逐段查詢後合併 */
export async function fetchTaibirCurve(path: string, lookbackDays: number): Promise<CurveSeries> {
  const merged: CurveSeries = new Map()
  const errors: string[] = []
  for (let offset = 0; offset < lookbackDays; offset += MAX_SEGMENT_DAYS) {
    const endDays = Math.max(0, offset - 1)
    const startDays = Math.min(lookbackDays, offset + MAX_SEGMENT_DAYS)
    try {
      const segment = await fetchSegment(path, taipeiDateDaysAgo(startDays), taipeiDateDaysAgo(endDays))
      for (const [date, curve] of segment) if (!merged.has(date)) merged.set(date, curve)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (!merged.size) throw new Error(errors[0] ?? '歷史資料區間內查無有效定盤利率')
  return merged
}

/** 回測用：指定絕對日期區間，自動切段 */
export async function fetchTaibirRange(path: string, from: string, to: string): Promise<CurveSeries> {
  const merged: CurveSeries = new Map()
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  for (let cursor = start; cursor <= end; cursor += MAX_SEGMENT_DAYS * 86_400_000) {
    const segEnd = Math.min(end, cursor + (MAX_SEGMENT_DAYS - 1) * 86_400_000)
    const segment = await fetchSegment(
      path,
      new Date(cursor).toISOString().slice(0, 10),
      new Date(segEnd).toISOString().slice(0, 10)
    )
    for (const [date, curve] of segment) if (!merged.has(date)) merged.set(date, curve)
  }
  return merged
}
