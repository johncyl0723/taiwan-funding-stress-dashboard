import { clean, fetchText, mapLimited, rocDate, toNumber } from '../fetch.js'
import type { NcdAuction, PolicyRate, TermCurve } from '../../../src/types.js'

const BASE = 'https://www.cbc.gov.tw'

/** 央行 NCD 公告需逐日點開內文，成本高，只回補足夠算 5 日移動合計的天數 */
const NCD_MAX_DAYS = 12
const NCD_LIST_PAGES = 2

/** 每頁 20 筆、依日期遞減的央行清單頁通用抓取（隔拆、匯率） */
async function fetchPagedRates(
  path: string,
  lookbackDays: number,
  label: string
): Promise<Map<string, number>> {
  const series = new Map<string, number>()
  const pages = Math.max(1, Math.ceil((lookbackDays * 5 / 7) / 20))
  for (let page = 1; page <= pages; page++) {
    const html = await fetchText(`${BASE}/tw/${path}-${page}-20.html`)
    const rows = [...clean(html).matchAll(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d+\.\d+)/g)]
    if (!rows.length) break
    for (const row of rows) series.set(`${row[1]}-${row[2]}-${row[3]}`, Number(row[4]))
  }
  if (!series.size) throw new Error(`查無${label}資料列`)
  return series
}

/** 央行重要指標「金融業隔夜拆款利率」 */
export const fetchOvernightSeries = (lookbackDays: number) =>
  fetchPagedRates('lp-641-1', lookbackDays, '隔夜拆款利率')

/** 央行外匯資訊「新臺幣/美元 銀行間收盤匯率」 */
export const fetchUsdTwdSeries = (lookbackDays: number) =>
  fetchPagedRates('lp-645-1', lookbackDays, '新臺幣對美元收盤匯率')

/**
 * 央行貼放利率：重貼現率、擔保放款融通、短期融通。
 * 頁面是「調整日期 + 三個利率」的歷史清單，最新在最前面。
 */
export async function fetchPolicyRates(): Promise<PolicyRate[]> {
  const html = await fetchText(`${BASE}/tw/lp-370-1.html`)
  const rows = [...clean(html).matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
  const rates = rows.map(row => ({
    effectiveFrom: `${row[1]}-${row[2].padStart(2, '0')}-${row[3].padStart(2, '0')}`,
    rediscount: Number(row[4]),
    securedAccommodation: Number(row[5]),
    shortTermAccommodation: Number(row[6])
  }))
  if (!rates.length) throw new Error('查無央行貼放利率資料列')
  return rates.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

export interface NcdDaily {
  netIssuanceMillion: number | null
  outstandingMillion: number | null
  rates: TermCurve
  repoOperation: boolean
}

/** 億元 → 百萬元 */
const yiToMillion = (value: number) => Math.round(value * 100)

/**
 * 央行網頁的左側選單含有「小規模附買回測試操作」等連結，整頁比對會把
 * 每一天都誤判成有附買回操作。公告本文固定介於「一、」與「檔案下載」之間，
 * 先切出本文再解析。
 */
export function extractAnnouncementBody(text: string): string {
  const start = text.search(/一、\s*\d{2,3}年/)
  if (start < 0) return text
  const end = text.indexOf('檔案下載', start)
  return end < 0 ? text.slice(start) : text.slice(start, end)
}

/**
 * 央行 NCD 的發行／到期金額只在「公開市場操作資訊」公告內文；
 * 另一種「存單申購發行資訊」公告只列利率沒有金額，必須用標題過濾。
 */
export function parseNcdAnnouncement(raw: string): NcdDaily {
  const text = extractAnnouncementBody(raw)
  // 公告同列會先給「當日」再給「月累計」，取第一個數字即為當日金額
  const matured = text.match(/到期金額\(1\)\s*([\d,.]+)/)
  const issued = text.match(/發行金額\(2\)\s*([\d,.]+)/)
  const outstanding = text.match(/未到期餘額為\s*([\d,.]+)\s*億元/)

  const rates: TermCurve = {}
  // 「7天期 0.825 177.00」→ 天期、申購發行利率、金額
  for (const match of text.matchAll(/(\d{1,3})天期\s+([\d.]+)\s+([\d,.]+)/g)) {
    rates[match[1]] = Number(match[2])
  }

  return {
    netIssuanceMillion:
      matured && issued ? yiToMillion(toNumber(issued[1]) - toNumber(matured[1])) : null,
    outstandingMillion: outstanding ? yiToMillion(toNumber(outstanding[1])) : null,
    rates,
    repoOperation: /附買回|附賣回/.test(text)
  }
}

async function listOperationAnnouncements(pages: number): Promise<{ href: string; date: string }[]> {
  const links: { href: string; date: string }[] = []
  for (let page = 1; page <= pages; page++) {
    const listHtml = await fetchText(`${BASE}/tw/lp-1163-1-${page}-20.html`)
    for (const match of listHtml.matchAll(/href="(\/tw\/cp-1163-[^"]+)" title="([^"]*公開市場操作資訊)"/g)) {
      const date = rocDate(match[2])
      if (date && !links.some(link => link.date === date)) links.push({ href: match[1], date })
    }
  }
  return links.sort((a, b) => b.date.localeCompare(a.date))
}

export async function fetchNcdSeries(): Promise<Map<string, NcdDaily>> {
  const links = await listOperationAnnouncements(NCD_LIST_PAGES)
  if (!links.length) throw new Error('找不到公開市場操作公告')

  const series = new Map<string, NcdDaily>()
  await mapLimited(links.slice(0, NCD_MAX_DAYS), 4, async link => {
    try {
      const parsed = parseNcdAnnouncement(clean(await fetchText(`${BASE}${link.href}`)))
      if (parsed.netIssuanceMillion !== null || parsed.outstandingMillion !== null) {
        series.set(link.date, parsed)
      }
    } catch {
      // 個別公告解析失敗只讓該日 NCD 為空值
    }
  })
  if (!series.size) throw new Error('公告內文查無發行／到期金額')
  return series
}

/** 「364天 1,200.00 2,026.00 1,200.00 1.69 59.23% 1.643 %」 */
export function parseNcdAuction(text: string, date: string): NcdAuction | null {
  const match = text.match(
    /364天\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d.]+)\s+([\d.]+)%\s+([\d.]+)/
  )
  if (!match) return null
  return {
    date,
    issueAmount: toNumber(match[1]),
    bidAmount: toNumber(match[2]),
    bidToCover: Number(match[4]),
    awardRate: Number(match[6])
  }
}

/** 364 天期定期存單開標結果，約每月一次 */
export async function fetchNcdAuctions(pages = 3): Promise<NcdAuction[]> {
  const links: { href: string; date: string }[] = []
  for (let page = 1; page <= pages; page++) {
    const listHtml = await fetchText(`${BASE}/tw/lp-1163-1-${page}-20.html`)
    for (const match of listHtml.matchAll(/href="(\/tw\/cp-1163-[^"]+)" title="([^"]*364天期定期存單開標結果)"/g)) {
      // 標題為「115年9月364天期定期存單開標結果」，只有年月沒有日
      const ym = match[2].match(/(\d{2,3})年(\d{1,2})月/)
      if (!ym) continue
      const date = `${Number(ym[1]) + 1911}-${ym[2].padStart(2, '0')}-01`
      if (!links.some(link => link.date === date)) links.push({ href: match[1], date })
    }
  }
  if (!links.length) return []

  const auctions: NcdAuction[] = []
  await mapLimited(links, 4, async link => {
    try {
      const parsed = parseNcdAuction(clean(await fetchText(`${BASE}${link.href}`)), link.date)
      if (parsed) auctions.push(parsed)
    } catch {
      // 個別公告失敗略過
    }
  })
  return auctions.sort((a, b) => a.date.localeCompare(b.date))
}
