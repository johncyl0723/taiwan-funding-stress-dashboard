import type { DailyObservation, MarketFetchResult, SourceRef } from '../../src/types.js'

const UA = 'TaiwanFundingDashboard/1.0 (public-market-research)'
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 央行 NCD 公告需逐日點開內文，成本高，只回補足夠算 5 日移動合計的天數 */
const NCD_MAX_DAYS = 12
const NCD_LIST_PAGES = 2

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

/** 所有日期一律以台北時間（UTC+8）為準，避免 UTC 換日造成整批資料錯位一天 */
function taipeiDateDaysAgo(days: number): string {
  return new Date(Date.now() + TAIPEI_OFFSET_MS - days * 86_400_000).toISOString().slice(0, 10)
}

/** 依表頭文字定位欄位，官網調整欄序時會直接報錯，而不是靜默取到錯的天期 */
function columnIndex(headers: string[], label: string, context: string): number {
  const index = headers.findIndex(header => header === label)
  if (index < 0) throw new Error(`${context} 找不到「${label}」欄位（表頭：${headers.join('/')}）`)
  return index
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * TDCC 只提供「當日」定盤利率頁面，週末或假日該列會是空白儲存格。
 * 改用官方歷史區間查詢（POST + CSRF token + session cookie），一次取回整段區間，
 * 讓百分位／Z-score 的統計窗格可以立即回補，而不是從零開始每天累積。
 */
async function fetchTdccSeries90D(historyPath: string, lookbackDays: number): Promise<Map<string, number>> {
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
    startDate: taipeiDateDaysAgo(lookbackDays),
    endDate: taipeiDateDaysAgo(0)
  })
  const postResponse = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: body.toString()
  })
  const postHtml = await postResponse.text()
  const table = postHtml.match(/<table class="table">[\s\S]*?<\/table>/)?.[0]
  if (!table) throw new Error('查無歷史資料表格')

  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => clean(match[1]))
  const target = columnIndex(headers, '90', 'TDCC 定盤利率')

  const series = new Map<string, number>()
  for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1]))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '')) continue
    const value = Number(cells[target])
    if (cells[target] !== '' && Number.isFinite(value)) series.set(cells[0], value)
  }
  if (!series.size) throw new Error('歷史資料區間內查無有效 90 天期利率')
  return series
}

const CSV_MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }

function parseCsvDate(token: string): string | null {
  const match = token.match(/^(\d{2})([A-Z]{3})(\d{2})$/)
  if (!match) return null
  const month = CSV_MONTHS[match[2]]
  if (!month) return null
  return `20${match[3]}-${month}-${match[1]}`
}

/** TAIBOR 的 CSV 為 Big5 編碼，表頭列以「日期」開頭，其後為各天期 */
function parseTaiborCsv(text: string, into: Map<string, number>): void {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const headerLine = lines.find(line => line.startsWith('日期,'))
  if (!headerLine) throw new Error('TAIBOR CSV 查無表頭列')
  const target = columnIndex(headerLine.split(',').map(cell => cell.trim()), '三個月', 'TAIBOR')

  for (const line of lines) {
    if (!/^\d{2}[A-Z]{3}\d{2},/.test(line)) continue
    const cells = line.split(',')
    const date = parseCsvDate(cells[0])
    const value = Number(cells[target])
    if (date && Number.isFinite(value)) into.set(date, value)
  }
}

/** 現行 CSV 為 Big5；若將來改為 UTF-8，以表頭是否解碼成功作為判斷依據自動回退 */
function decodeCsv(buffer: ArrayBuffer): string {
  const big5 = new TextDecoder('big5').decode(buffer)
  if (big5.split(/\r?\n/).some(line => line.trim().startsWith('日期,'))) return big5
  return new TextDecoder('utf-8').decode(buffer)
}

async function fetchTaiborCsv(href: string, into: Map<string, number>): Promise<void> {
  const response = await fetch(`https://www.ba.org.tw${href}`, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`HTTP ${response.status}（TAIBOR CSV）`)
  parseTaiborCsv(decodeCsv(await response.arrayBuffer()), into)
}

function csvLinks(detailHtml: string): { href: string; label: string }[] {
  return [...detailHtml.matchAll(/href="(\/taiborDaily\/DownloadFile\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(link => ({ href: link[1].replace(/&amp;/g, '&'), label: decodeEntities(clean(link[2])) }))
}

/**
 * 銀行公會 TAIBOR 頁面的數字不在網頁文字中，而在公告內附的 Big5 CSV。
 * 公告清單同時有「每日公告」（附近 40 天歷史資料）與「月報」（單月全月資料），
 * 兩者合併即可回補任意長度的歷史，不必等每日累積。
 */
async function fetchTaiborSeries3M(lookbackDays: number): Promise<Map<string, number>> {
  const indexHtml = await fetchText('https://www.ba.org.tw/taiborDaily/index')
  const entries = [...indexHtml.matchAll(/href="(\/taiborDaily\/details\?id=\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(entry => ({ href: entry[1], label: decodeEntities(clean(entry[2])) }))
  if (!entries.length) throw new Error('找不到 TAIBOR 公告清單')

  const daily = entries.find(entry => /^\d{4}\.\d{2}\.\d{2}/.test(entry.label))
  if (!daily) throw new Error('找不到最新一筆 TAIBOR 每日公告')

  // 月報公告：回補到足以覆蓋 lookback 的月份數（多抓一個月確保窗格填滿）
  const monthsNeeded = Math.ceil(lookbackDays / 30) + 1
  const cutoff = taipeiDateDaysAgo(lookbackDays).slice(0, 7)
  const wanted = entries
    .map(entry => {
      const match = entry.label.match(/^(\d{4})年(\d{1,2})月/)
      return match ? { ...entry, ym: `${match[1]}-${match[2].padStart(2, '0')}` } : null
    })
    .filter((entry): entry is { href: string; label: string; ym: string } => entry !== null)
    .filter(entry => entry.ym >= cutoff)
    .sort((a, b) => b.ym.localeCompare(a.ym))
    .slice(0, monthsNeeded)

  const series = new Map<string, number>()
  const details = await mapLimited([daily, ...wanted], 4, async entry => ({
    entry,
    html: await fetchText(`https://www.ba.org.tw${entry.href}`)
  }))

  for (const { entry, html } of details) {
    const links = csvLinks(html)
    const link = /^\d{4}\.\d{2}\.\d{2}/.test(entry.label)
      ? links.find(item => item.label.includes('歷史資料'))
      : links[0]
    if (!link) continue
    try {
      await fetchTaiborCsv(link.href, series)
    } catch {
      // 單一月報缺漏不影響整體序列，只會讓回補天數變少
    }
  }

  if (!series.size) throw new Error('TAIBOR CSV 查無資料列')
  return series
}

/** 央行隔夜拆款利率頁面每頁 20 筆、依日期遞減，翻頁即可回補歷史 */
async function fetchOvernightSeries(lookbackDays: number): Promise<Map<string, number>> {
  const series = new Map<string, number>()
  const pages = Math.max(1, Math.ceil((lookbackDays * 5 / 7) / 20))
  for (let page = 1; page <= pages; page++) {
    const html = await fetchText(`https://www.cbc.gov.tw/tw/lp-641-1-${page}-20.html`)
    const rows = [...clean(html).matchAll(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d+\.\d+)/g)]
    if (!rows.length) break
    for (const row of rows) series.set(`${row[1]}-${row[2]}-${row[3]}`, Number(row[4]))
  }
  if (!series.size) throw new Error('查無隔夜拆款利率資料列')
  return series
}

function rocDateFromTitle(title: string): string | null {
  const match = title.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/)
  if (!match) return null
  return `${Number(match[1]) + 1911}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

/**
 * 央行 NCD 的發行／到期金額（億元）只在「公開市場操作資訊」公告內文，
 * 另一種「存單申購發行資訊」公告只有利率沒有金額，必須用標題過濾。
 */
async function fetchNcdSeries(): Promise<Map<string, number>> {
  const links: { href: string; date: string }[] = []
  for (let page = 1; page <= NCD_LIST_PAGES; page++) {
    const listHtml = await fetchText(`https://www.cbc.gov.tw/tw/lp-1163-1-${page}-20.html`)
    for (const match of listHtml.matchAll(/href="(\/tw\/cp-1163-[^"]+)" title="([^"]*公開市場操作資訊)"/g)) {
      const date = rocDateFromTitle(match[2])
      if (date && !links.some(link => link.date === date)) links.push({ href: match[1], date })
    }
  }
  if (!links.length) throw new Error('找不到公開市場操作公告')

  const targets = links.sort((a, b) => b.date.localeCompare(a.date)).slice(0, NCD_MAX_DAYS)
  const series = new Map<string, number>()
  await mapLimited(targets, 4, async link => {
    try {
      const text = clean(await fetchText(`https://www.cbc.gov.tw${link.href}`))
      // 公告同列會先給「當日」再給「月累計」，取第一個數字即為當日金額
      const matured = text.match(/到期金額\(1\)\s*([\d,.]+)/)
      const issued = text.match(/發行金額\(2\)\s*([\d,.]+)/)
      if (!matured || !issued) return
      series.set(link.date, Math.round((number(issued[1]) - number(matured[1])) * 100))
    } catch {
      // 個別公告解析失敗只讓該日 NCD 為 null
    }
  })
  if (!series.size) throw new Error('公告內文查無發行／到期金額')
  return series
}

export async function fetchMarketSeries(lookbackDays = 200): Promise<MarketFetchResult> {
  const status: Record<string, string> = {}

  const run = async (key: string, task: () => Promise<Map<string, number>>): Promise<Map<string, number> | null> => {
    try {
      const result = await task()
      status[key] = `${key} 已讀取（${result.size} 筆）`
      return result
    } catch (error) {
      status[key] = `${key} 讀取失敗：${error instanceof Error ? error.message : String(error)}`
      return null
    }
  }

  const [primary, secondary, taibor, overnight, ncd] = await Promise.all([
    run('TDCC 初級', () => fetchTdccSeries90D('tc_05sat_main03_5', lookbackDays)),
    run('TDCC 次級', () => fetchTdccSeries90D('tc_05sat_main03_6', lookbackDays)),
    run('TAIBOR', () => fetchTaiborSeries3M(lookbackDays)),
    run('央行 O/N', () => fetchOvernightSeries(lookbackDays)),
    run('央行 NCD', () => fetchNcdSeries())
  ])

  // 只有 TFSS 的兩隻腳是核心來源；其餘缺漏降級為 null，不拖垮整批更新
  if (!primary || !taibor) throw new Error(`核心來源缺漏，不發布：${JSON.stringify(status)}`)

  const dates = [...new Set([...primary.keys(), ...taibor.keys()])].sort()
  const observations: DailyObservation[] = dates.map(date => ({
    date,
    taibir90Primary: primary.get(date) ?? null,
    taibir90Secondary: secondary?.get(date) ?? null,
    taibor3m: taibor.get(date) ?? null,
    overnightRate: overnight?.get(date) ?? null,
    ncdNetIssuance: ncd?.get(date) ?? null
  }))

  const latest = (series: Map<string, number> | null) =>
    series && series.size ? [...series.keys()].sort().at(-1)! : '—'

  const sources: SourceRef[] = [
    { label: 'TDCC TAIBIR 初級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_5', asOf: latest(primary) },
    { label: 'TDCC TAIBIR 次級（歷史查詢）', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_6', asOf: latest(secondary) },
    { label: '銀行公會 TAIBOR（每日＋月報 CSV）', url: 'https://www.ba.org.tw/taiborDaily/index', asOf: latest(taibor) },
    { label: '中央銀行金融業隔夜拆款', url: 'https://www.cbc.gov.tw/tw/lp-641-1.html', asOf: latest(overnight) },
    { label: '中央銀行公開市場操作', url: 'https://www.cbc.gov.tw/tw/lp-1163-1.html', asOf: latest(ncd) }
  ]

  return { observations, sources, sourceStatus: status }
}
