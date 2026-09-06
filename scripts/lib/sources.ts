import type { RawMarketValues, SourceRef } from '../../src/types.js'

const UA = 'TaiwanFundingDashboard/1.0 (public-market-research)'
const HISTORY_LOOKBACK_DAYS = 12

const clean = (input: string) => input.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const number = (value: string) => Number(value.replace(/,/g, ''))
const decodeEntities = (input: string) =>
  input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
  return response.text()
}

function isoDateDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

/**
 * TDCC 只提供「當日」定盤利率頁面，週末或假日該列會是空白儲存格。
 * 改用官方歷史區間查詢（POST + CSRF token + session cookie），
 * 直接取回傳回範圍內最新一筆有效資料，天然對應「最近一個營業日」。
 */
async function fetchTdccHistorical90D(historyPath: string): Promise<{ date: string; value90: number }> {
  const url = `https://www.tdcc.com.tw/portal/zh/tcWeb/${historyPath}`
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
    startDate: isoDateDaysAgo(HISTORY_LOOKBACK_DAYS),
    endDate: isoDateDaysAgo(0)
  })
  const postResponse = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: body.toString()
  })
  const postHtml = await postResponse.text()
  const table = postHtml.match(/<table class="table">[\s\S]*?<\/table>/)?.[0]
  if (!table) throw new Error('查無歷史資料表格')

  const rows = [...table.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>/g)]
    .map(match => ({ date: clean(match[1]), cells: [...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1])) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date))

  // 欄位順序：10, 20, 30, 60, 90, 120, 150, 180, 365, 備註 → 90 天期為 index 4
  for (const row of rows) {
    const value90 = Number(row.cells[4])
    if (Number.isFinite(value90) && row.cells[4] !== '') return { date: row.date, value90 }
  }
  throw new Error('歷史資料區間內查無有效 90 天期利率')
}

const CSV_MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }

function parseCsvDate(token: string): string | null {
  const match = token.match(/^(\d{2})([A-Z]{3})(\d{2})$/)
  if (!match) return null
  const month = CSV_MONTHS[match[2]]
  if (!month) return null
  return `20${match[3]}-${month}-${match[1]}`
}

/**
 * 銀行公會 TAIBOR 頁面已改版，數字不再顯示於網頁文字中，
 * 改為公告內附的 Big5 編碼 CSV 下載連結（近 40 天歷史資料，含所有天期）。
 */
async function fetchTaiborHistorical3M(): Promise<{ date: string; value3m: number }> {
  const indexHtml = await fetchText('https://www.ba.org.tw/taiborDaily/index')
  const detailHref = indexHtml.match(/href="(\/taiborDaily\/details\?id=\d+)"/)?.[1]
  if (!detailHref) throw new Error('找不到最新一筆 TAIBOR 公告連結')

  const detailHtml = await fetchText(`https://www.ba.org.tw${detailHref}`)
  const downloadLinks = [...detailHtml.matchAll(/href="(\/taiborDaily\/DownloadFile\?intId=\d+&downName=\.csv)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const historyLink = downloadLinks.find(link => decodeEntities(link[2]).includes('歷史資料'))
  if (!historyLink) throw new Error('找不到 TAIBOR 歷史資料 CSV 連結')

  const csvResponse = await fetch(`https://www.ba.org.tw${historyLink[1]}`, { headers: { 'User-Agent': UA } })
  const csvText = new TextDecoder('big5').decode(await csvResponse.arrayBuffer())
  const dataLine = csvText.split('\n').map(line => line.trim()).find(line => /^\d{2}[A-Z]{3}\d{2},/.test(line))
  if (!dataLine) throw new Error('TAIBOR CSV 查無資料列')

  const [dateToken, ...rates] = dataLine.split(',')
  const date = parseCsvDate(dateToken)
  // 欄位順序：一星期, 二星期, 一個月, 二個月, 三個月, 六個月, 九個月, 一年期 → 三個月為 index 4
  const value3m = Number(rates[4])
  if (!date || !Number.isFinite(value3m)) throw new Error('TAIBOR CSV 格式無法解析')
  return { date, value3m }
}

/**
 * 央行隔夜拆款利率頁面本身就是「日期＋利率」的歷史清單（最新在最前面），
 * 直接取第一筆即為最近一個營業日的資料。
 */
async function fetchOvernightHistoricalRate(): Promise<{ date: string; rate: number }> {
  const html = await fetchText('https://www.cbc.gov.tw/tw/lp-641-1.html')
  const text = clean(html)
  const match = text.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d\.\d{3,4})/)
  if (!match) throw new Error('查無隔夜拆款利率資料列')
  return { date: `${match[1]}-${match[2]}-${match[3]}`, rate: Number(match[4]) }
}

/**
 * 央行 NCD 頁面已改版為公告清單，發行/到期金額（億元）要點進
 * 「中央銀行公開市場操作資訊」公告內文才有（另一種公告只列利率，沒有金額）。
 */
async function fetchNcdHistoricalNetIssuance(): Promise<{ date: string; netIssuanceMillion: number }> {
  const listHtml = await fetchText('https://www.cbc.gov.tw/tw/lp-1163-1.html')
  const link = [...listHtml.matchAll(/href="(\/tw\/cp-1163-[^"]+)" title="([^"]*公開市場操作資訊)"/g)][0]
  if (!link) throw new Error('找不到最新一筆公開市場操作公告')

  const titleMatch = link[2].match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/)
  if (!titleMatch) throw new Error('公告標題無法解析日期')
  const date = `${Number(titleMatch[1]) + 1911}-${titleMatch[2].padStart(2, '0')}-${titleMatch[3].padStart(2, '0')}`

  const detailHtml = await fetchText(`https://www.cbc.gov.tw${link[1]}`)
  const text = clean(detailHtml)
  const matured = text.match(/到期金額(?:\(1\))?\s*([\d,.]+)/)
  const issued = text.match(/發行金額(?:\(2\))?\s*([\d,.]+)/)
  if (!matured || !issued) throw new Error('公告內文查無發行／到期金額')
  return { date, netIssuanceMillion: Math.round((number(issued[1]) - number(matured[1])) * 100) }
}

export async function fetchMarketSources(): Promise<RawMarketValues> {
  const status: Record<string, string> = {}

  const run = async <T,>(key: string, task: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await task()
      status[key] = `${key} 已讀取`
      return result
    } catch (error) {
      status[key] = `${key} 讀取失敗：${error instanceof Error ? error.message : String(error)}`
      return null
    }
  }

  const [primary, secondary, taibor, overnight, ncd] = await Promise.all([
    run('TDCC 初級', () => fetchTdccHistorical90D('tc_05sat_main03_5')),
    run('TDCC 次級', () => fetchTdccHistorical90D('tc_05sat_main03_6')),
    run('TAIBOR', fetchTaiborHistorical3M),
    run('央行 O/N', fetchOvernightHistoricalRate),
    run('央行 NCD', fetchNcdHistoricalNetIssuance)
  ])

  if (!primary || !secondary || !taibor || !overnight || !ncd) throw new Error(`資料尚未完整定盤：${JSON.stringify(status)}`)

  const sources: SourceRef[] = [
    { label: 'TDCC TAIBIR 初級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_5', asOf: primary.date },
    { label: 'TDCC TAIBIR 次級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_6', asOf: secondary.date },
    { label: '銀行公會 TAIBOR（歷史資料 CSV）', url: 'https://www.ba.org.tw/taiborDaily/index', asOf: taibor.date },
    { label: '中央銀行金融業隔夜拆款', url: 'https://www.cbc.gov.tw/tw/lp-641-1.html', asOf: overnight.date },
    { label: '中央銀行公開市場操作', url: 'https://www.cbc.gov.tw/tw/lp-1163-1.html', asOf: ncd.date }
  ]

  return {
    date: primary.date,
    taibir90Primary: primary.value90,
    taibir90Secondary: secondary.value90,
    taibor3m: taibor.value3m,
    overnightRate: overnight.rate,
    ncdNetIssuance: ncd.netIssuanceMillion,
    sources,
    sourceStatus: status
  }
}
