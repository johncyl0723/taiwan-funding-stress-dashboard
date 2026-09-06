const UA = 'TaiwanFundingDashboard/1.0 (public-market-research)'
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

export const clean = (input: string) =>
  input.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export const toNumber = (value: string) => Number(value.replace(/,/g, ''))

/**
 * HTML 實體解碼。央行 RSS 的 CDATA 內文含具名實體（&nbsp;、&lt;），
 * 只處理數字實體會讓樣板雜訊留在文字裡，因此兩種都要解。
 * &amp; 必須最後處理，否則 &amp;lt; 會被連續解成 <。
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'"
}

export const decodeEntities = (input: string) =>
  input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(nbsp|lt|gt|quot|apos);/g, (_, name) => NAMED_ENTITIES[name] ?? '')
    .replace(/&amp;/g, '&')

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
  return response.text()
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
  return response.arrayBuffer()
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`回應不是 JSON（${url}）`)
  }
}

/**
 * 官方來源的編碼並不一致：銀行公會 CSV 是 Big5，央行 OpenData 是 UTF-8 BOM。
 * 以「解碼後是否出現預期的表頭關鍵字」決定採用哪一種，避免寫死。
 */
export function decodeCsv(buffer: ArrayBuffer, marker: string): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')
  if (utf8.includes(marker)) return utf8
  const big5 = new TextDecoder('big5').decode(buffer)
  if (big5.includes(marker)) return big5
  return utf8
}

/** 逗號分隔但欄位可能帶引號的 CSV 單行解析 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++ } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current); current = ''
    } else current += char
  }
  cells.push(current)
  return cells.map(cell => cell.trim())
}

/** 所有日期一律以台北時間（UTC+8）為準，避免 UTC 換日造成整批資料錯位一天 */
export function taipeiDateDaysAgo(days: number): string {
  return new Date(Date.now() + TAIPEI_OFFSET_MS - days * 86_400_000).toISOString().slice(0, 10)
}

export function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** 由今天往回列出 count 個平日（不含例假日，但仍可能含國定假日） */
export function recentWeekdays(count: number): string[] {
  const dates: string[] = []
  for (let back = 0; dates.length < count && back < count * 3; back++) {
    const iso = taipeiDateDaysAgo(back)
    if (!isWeekend(iso)) dates.push(iso)
  }
  return dates
}

/** 依表頭文字定位欄位，官網調整欄序時會直接報錯，而不是靜默取到錯的欄位 */
export function columnIndex(headers: string[], label: string, context: string): number {
  const index = headers.findIndex(header => header === label)
  if (index < 0) throw new Error(`${context} 找不到「${label}」欄位（表頭：${headers.join('/')}）`)
  return index
}

export async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
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

/** 民國「115年9月4日」→ 2026-09-04 */
export function rocDate(text: string): string | null {
  const match = text.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/)
  if (!match) return null
  return `${Number(match[1]) + 1911}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

/** 央行 OpenData 的期間欄位「2026M07」→ 2026-07 */
export function openDataPeriod(token: string): string | null {
  const match = token.match(/^(\d{4})M(\d{2})$/)
  return match ? `${match[1]}-${match[2]}` : null
}

/** 民國期別「11507」→ 2026-07 */
export function rocPeriod(token: string): string | null {
  const match = token.match(/^(\d{3})(\d{2})$/)
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${Number(match[1]) + 1911}-${match[2]}`
}

export function latestKey(series: Map<string, unknown> | null | undefined): string {
  if (!series || !series.size) return '—'
  return [...series.keys()].sort().at(-1)!
}
