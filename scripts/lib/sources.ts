import type { RawMarketValues, SourceRef } from '../../src/types.js'

const TDCC_PRIMARY = 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_3'
const TDCC_SECONDARY = 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_4'
const TAIBOR = 'https://www.ba.org.tw/taiborDaily/index'
const OVERNIGHT = 'https://www.cbc.gov.tw/tw/lp-641-1.html'
const NCD = 'https://www.cbc.gov.tw/tw/lp-1163-1.html'

const clean = (input: string) => input.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const number = (value: string) => Number(value.replace(/,/g, ''))

function dateInPage(html: string): string | null {
  const western = clean(html).match(/(?:營業日|日期|Date)[：:\s]*(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/)
  return western ? `${western[1]}-${western[2].padStart(2, '0')}-${western[3].padStart(2, '0')}` : null
}

function fixing90(html: string): number | null {
  const row = html.match(/<tr[^>]*>[\s\S]*?Fixing\s*Rate[\s\S]*?<\/tr>/i)?.[0]
  if (!row) return null
  const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => clean(match[1]))
  // row layout: label, 10D, 20D, 30D, 60D, 90D, ...
  const candidate = cells[5]
  return candidate && /^\d+(\.\d+)?$/.test(candidate) ? number(candidate) : null
}

function taibor3m(html: string): number | null {
  const text = clean(html)
  const matches = [
    /3\s*(?:Month|個月|M)[^\d]{0,60}(\d\.\d{3,4})/i,
    /(?:三個月)[^\d]{0,60}(\d\.\d{3,4})/i
  ]
  for (const pattern of matches) { const match = text.match(pattern); if (match) return number(match[1]) }
  return null
}

function overnightRate(html: string): number | null {
  const text = clean(html)
  const match = text.match(/(?:金融業)?隔夜拆款(?:加權平均)?[^\d]{0,100}(\d\.\d{3,4})/i)
  return match ? number(match[1]) : null
}

function ncdNetIssuance(html: string): number | null {
  const text = clean(html)
  const issued = text.match(/(?:發行|新發)[^\d]{0,16}([\d,.]+)\s*億元/)
  const matured = text.match(/到期[^\d]{0,16}([\d,.]+)\s*億元/)
  return issued && matured ? Math.round((number(issued[1]) - number(matured[1])) * 100) : null // 轉為百萬元
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'TaiwanFundingDashboard/1.0 (public-market-research)' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

export async function fetchMarketSources(): Promise<RawMarketValues> {
  const [primary, secondary, taibor, overnight, ncd] = await Promise.allSettled([fetchText(TDCC_PRIMARY), fetchText(TDCC_SECONDARY), fetchText(TAIBOR), fetchText(OVERNIGHT), fetchText(NCD)])
  const status: Record<string, string> = {}
  const read = (key: string, result: PromiseSettledResult<string>) => {
    if (result.status === 'rejected') { status[key] = `${key} 讀取失敗：${String(result.reason)}`; return null }
    status[key] = `${key} 已讀取`; return result.value
  }
  const primaryHtml = read('TDCC 初級', primary), secondaryHtml = read('TDCC 次級', secondary), taiborHtml = read('TAIBOR', taibor), overnightHtml = read('央行 O/N', overnight), ncdHtml = read('央行 NCD', ncd)
  const p = primaryHtml ? fixing90(primaryHtml) : null
  const s = secondaryHtml ? fixing90(secondaryHtml) : null
  const t = taiborHtml ? taibor3m(taiborHtml) : null
  const o = overnightHtml ? overnightRate(overnightHtml) : null
  const n = ncdHtml ? ncdNetIssuance(ncdHtml) : null
  const date = primaryHtml && dateInPage(primaryHtml)
  if (!date || p === null || s === null || t === null || o === null || n === null) throw new Error(`資料尚未完整定盤：${JSON.stringify(status)}`)
  const sources: SourceRef[] = [
    { label: 'TDCC TAIBIR 初級', url: TDCC_PRIMARY, asOf: date }, { label: 'TDCC TAIBIR 次級', url: TDCC_SECONDARY, asOf: date },
    { label: '銀行公會 TAIBOR', url: TAIBOR, asOf: date }, { label: '中央銀行金融業隔夜拆款', url: OVERNIGHT, asOf: date }, { label: '中央銀行公開市場操作', url: NCD, asOf: date }
  ]
  return { date, taibir90Primary: p, taibir90Secondary: s, taibor3m: t, overnightRate: o, ncdNetIssuance: n, sources, sourceStatus: status }
}
