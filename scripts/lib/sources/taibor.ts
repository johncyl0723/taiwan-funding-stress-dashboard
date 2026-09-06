import { clean, decodeCsv, decodeEntities, fetchBuffer, fetchText, mapLimited, splitCsvLine, taipeiDateDaysAgo } from '../fetch.js'
import type { TermCurve } from '../../../src/types.js'

export type CurveSeries = Map<string, TermCurve>

const CSV_MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
}

/** CSV 表頭的中文天期 → 儀表板使用的代號 */
const TERM_ALIASES: Record<string, string> = {
  一星期: '1W', 二星期: '2W', 一個月: '1M', 二個月: '2M',
  三個月: '3M', 六個月: '6M', 九個月: '9M', 一年期: '1Y'
}

function parseCsvDate(token: string): string | null {
  const match = token.match(/^(\d{2})([A-Z]{3})(\d{2})$/)
  if (!match) return null
  const month = CSV_MONTHS[match[2]]
  if (!month) return null
  return `20${match[3]}-${month}-${match[1]}`
}

/** TAIBOR 的 CSV 表頭列以「日期」開頭，其後為各天期中文名稱 */
function parseTaiborCsv(text: string, into: CurveSeries): void {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const headerLine = lines.find(line => line.startsWith('日期,'))
  if (!headerLine) throw new Error('TAIBOR CSV 查無表頭列')
  const headers = splitCsvLine(headerLine)
  const terms = headers
    .map((header, index) => ({ code: TERM_ALIASES[header], index }))
    .filter((entry): entry is { code: string; index: number } => Boolean(entry.code))
  if (!terms.some(term => term.code === '3M')) {
    throw new Error(`TAIBOR CSV 找不到「三個月」欄位（表頭：${headers.join('/')}）`)
  }

  for (const line of lines) {
    if (!/^\d{2}[A-Z]{3}\d{2},/.test(line)) continue
    const cells = splitCsvLine(line)
    const date = parseCsvDate(cells[0])
    if (!date) continue
    const curve: TermCurve = {}
    for (const term of terms) {
      const value = Number(cells[term.index])
      if (cells[term.index] !== '' && Number.isFinite(value)) curve[term.code] = value
    }
    if (Object.keys(curve).length) into.set(date, curve)
  }
}

async function fetchCsvInto(href: string, into: CurveSeries): Promise<void> {
  const buffer = await fetchBuffer(`https://www.ba.org.tw${href}`)
  parseTaiborCsv(decodeCsv(buffer, '日期,'), into)
}

function csvLinks(detailHtml: string): { href: string; label: string }[] {
  return [...detailHtml.matchAll(/href="(\/taiborDaily\/DownloadFile\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(link => ({ href: decodeEntities(link[1]), label: decodeEntities(clean(link[2])) }))
}

interface Announcement { href: string; label: string; ym?: string }

/**
 * 公告清單每頁 20 筆，第 1 頁只回溯到約一年半前；回測要更早的資料必須翻頁
 * （`/taiborDaily/index?page=N`）。日常更新只需要第 1 頁。
 */
async function listAnnouncements(pages = 1): Promise<Announcement[]> {
  const entries: Announcement[] = []
  for (let page = 1; page <= pages; page++) {
    const url = page === 1
      ? 'https://www.ba.org.tw/taiborDaily/index'
      : `https://www.ba.org.tw/taiborDaily/index?page=${page}`
    const html = await fetchText(url).catch(() => '')
    const found = [...html.matchAll(/href="(\/taiborDaily\/details\?id=\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map(entry => ({ href: entry[1], label: decodeEntities(clean(entry[2])) }))
    if (!found.length) break
    for (const entry of found) if (!entries.some(item => item.href === entry.href)) entries.push(entry)
  }
  if (!entries.length) throw new Error('找不到 TAIBOR 公告清單')
  return entries.map(entry => {
    const month = entry.label.match(/^(\d{4})年(\d{1,2})月/)
    return month ? { ...entry, ym: `${month[1]}-${month[2].padStart(2, '0')}` } : entry
  })
}

async function loadInto(entries: Announcement[], into: CurveSeries): Promise<void> {
  const details = await mapLimited(entries, 4, async entry => ({
    entry,
    html: await fetchText(`https://www.ba.org.tw${entry.href}`).catch(() => '')
  }))
  for (const { entry, html } of details) {
    if (!html) continue
    const links = csvLinks(html)
    // 每日公告附有「近 40 天歷史資料」與「當日資料」兩個檔；月報公告只有一個檔
    const link = entry.ym ? links[0] : links.find(item => item.label.includes('歷史資料'))
    if (!link) continue
    try {
      await fetchCsvInto(link.href, into)
    } catch {
      // 單一月報缺漏不影響整體序列，只會讓回補天數變少
    }
  }
}

/**
 * 銀行公會 TAIBOR 頁面的數字不在網頁文字中，而在公告內附的 Big5 CSV。
 * 公告清單同時有「每日公告」（附近 40 天歷史）與「月報」（單月全月），
 * 兩者合併即可回補任意長度的歷史，不必等每日累積。
 */
export async function fetchTaiborCurve(lookbackDays: number): Promise<CurveSeries> {
  const entries = await listAnnouncements()
  const daily = entries.find(entry => /^\d{4}\.\d{2}\.\d{2}/.test(entry.label))
  if (!daily) throw new Error('找不到最新一筆 TAIBOR 每日公告')

  const cutoff = taipeiDateDaysAgo(lookbackDays).slice(0, 7)
  const monthly = entries
    .filter((entry): entry is Required<Announcement> => Boolean(entry.ym))
    .filter(entry => entry.ym >= cutoff)
    .sort((a, b) => b.ym.localeCompare(a.ym))
    .slice(0, Math.ceil(lookbackDays / 30) + 1)

  const series: CurveSeries = new Map()
  await loadInto([daily, ...monthly], series)
  if (!series.size) throw new Error('TAIBOR CSV 查無資料列')
  return series
}

/** 回測用：抓取 from~to 之間所有月報，依區間長度決定要翻幾頁清單 */
export async function fetchTaiborRange(from: string, to: string): Promise<CurveSeries> {
  const months = Math.max(
    1,
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1
  )
  // 每頁 20 筆，其中多數是月報；多抓一頁確保覆蓋
  const entries = await listAnnouncements(Math.ceil(months / 12) + 1)
  const monthly = entries
    .filter((entry): entry is Required<Announcement> => Boolean(entry.ym))
    .filter(entry => entry.ym >= from.slice(0, 7) && entry.ym <= to.slice(0, 7))
  const series: CurveSeries = new Map()
  await loadInto(monthly, series)
  return series
}
