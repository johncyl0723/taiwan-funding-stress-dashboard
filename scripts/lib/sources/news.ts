import { decodeEntities, fetchText } from '../fetch.js'
import type { NewsItem } from '../../../src/types.js'

/** 只保留近期新聞，避免頁面被舊消息塞滿 */
const MAX_AGE_DAYS = 14
const MAX_OFFICIAL = 8
const MAX_MEDIA = 8

/**
 * 央行官方新聞稿 RSS。這是訊號品質最高的來源 —— 全部與貨幣政策、
 * 公開市場操作、外匯存底直接相關，不需要相關性過濾。
 */
const CBC_FEED = 'https://www.cbc.gov.tw/tw/rss-302-1.xml'

/** Google News 關鍵字查詢；一次查不完，用數個窄查詢合併比單一寬查詢乾淨 */
const MEDIA_QUERIES = [
  '央行 定存單 資金',
  '台灣 貨幣市場 利率',
  'TAIBOR 拆款 利率'
]

/**
 * 標題至少要命中一個詞才收錄。Google News 的查詢語法會把
 * 「韓國央行」「房市鬆綁」之類的報導一起帶進來，必須再過濾一次。
 */
const REQUIRED_TERMS = [
  '央行', '定存單', '存單', '拆款', 'TAIBOR', '資金', '利率',
  '貨幣市場', '票券', '流動性', '升息', '降息', '公開市場'
]

/** 命中這些詞代表講的是別國的央行或無關主題 */
const EXCLUDED_TERMS = [
  '韓國', '日本央行', '日銀', '人民銀行', '歐洲央行', 'ECB',
  '加密', '比特幣', '穩定幣', '房價', '房市', '打房'
]

const cdata = (value: string) => value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')

function tag(item: string, name: string): string | null {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return match ? decodeEntities(cdata(match[1]).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : null
}

/** RSS 的 pubDate 是 RFC 822，轉成 YYYY-MM-DD */
function isoDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const time = Date.parse(pubDate)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null
}

/**
 * 央行新聞稿內文前後都有樣板：抬頭、網址、新聞發布編號、分隔線、聯絡電話。
 * 摘要前先切掉，否則會佔掉大半的 prompt 額度。
 */
const BODY_LIMIT = 700
function cleanBody(raw: string | null): string | undefined {
  if (!raw) return undefined
  let text = raw.split(/﹋{3,}/)[0]
  // 正文從「新聞發布第N號」之後開始；沒有這個標記就從頭取
  const marker = text.match(/新聞發布第\d+號/)
  if (marker?.index !== undefined) text = text.slice(marker.index + marker[0].length)
  const trimmed = text
    .replace(/<網址[:：][^>]*>/g, '')
    .replace(/業務聯繫單位[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed.length > 20 ? trimmed.slice(0, BODY_LIMIT) : undefined
}

function parseFeed(xml: string): { title: string; link: string; date: string | null; source: string | null; body?: string }[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const item = match[1]
    return {
      title: tag(item, 'title') ?? '',
      link: (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '').trim(),
      date: isoDate(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null),
      source: tag(item, 'source'),
      body: cleanBody(tag(item, 'description'))
    }
  }).filter(entry => entry.title && entry.link)
}

const withinWindow = (date: string | null, cutoff: string) => date !== null && date >= cutoff

/** Google News 的標題結尾常帶「 - 媒體名」，來源另有 source 欄位，去掉重複 */
const stripSourceSuffix = (title: string, source: string | null) =>
  source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title

export async function fetchNews(): Promise<{ items: NewsItem[]; status: string }> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const items: NewsItem[] = []
  const notes: string[] = []

  try {
    const official = parseFeed(await fetchText(CBC_FEED))
      .filter(entry => withinWindow(entry.date, cutoff))
      .slice(0, MAX_OFFICIAL)
      .map(entry => ({
        title: entry.title,
        url: entry.link,
        source: '中央銀行新聞稿',
        date: entry.date!,
        official: true,
        body: entry.body
      }))
    items.push(...official)
    notes.push(`央行 ${official.length} 則`)
  } catch (error) {
    notes.push(`央行讀取失敗：${error instanceof Error ? error.message : String(error)}`)
  }

  const media: NewsItem[] = []
  for (const query of MEDIA_QUERIES) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
      for (const entry of parseFeed(await fetchText(url))) {
        if (!withinWindow(entry.date, cutoff)) continue
        const title = stripSourceSuffix(entry.title, entry.source)
        if (!REQUIRED_TERMS.some(term => title.includes(term))) continue
        if (EXCLUDED_TERMS.some(term => title.includes(term))) continue
        if (media.some(item => item.title === title)) continue
        media.push({ title, url: entry.link, source: entry.source ?? '未標示', date: entry.date!, official: false })
      }
    } catch {
      // 單一查詢失敗不影響其他查詢
    }
  }
  media.sort((a, b) => b.date.localeCompare(a.date))
  items.push(...media.slice(0, MAX_MEDIA))
  notes.push(`媒體 ${Math.min(media.length, MAX_MEDIA)} 則`)

  if (!items.length) throw new Error(`查無新聞（${notes.join('、')}）`)
  return { items, status: notes.join('、') }
}
