import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNews } from './news'

const today = new Date().toISOString().slice(0, 10)
const rfc822 = (iso: string) => new Date(`${iso}T08:00:00Z`).toUTCString()
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

const cbcFeed = (dates: string[]) => `<rss><channel>${dates.map((date, index) => `
<item><title><![CDATA[115年9月${index + 1}日中央銀行公開市場操作資訊]]></title>
<link>https://www.cbc.gov.tw/tw/cp-302-${index}.html</link>
<pubDate>${rfc822(date)}</pubDate></item>`).join('')}</channel></rss>`

const googleItem = (title: string, source: string, date: string, id: string) => `
<item><title>${title} - ${source}</title>
<link>https://news.google.com/${id}</link>
<pubDate>${rfc822(date)}</pubDate>
<source url="https://x.tw">${source}</source></item>`

afterEach(() => vi.unstubAllGlobals())

function stub(cbc: string, google: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    new Response(url.includes('cbc.gov.tw') ? cbc : google)
  ))
}

describe('新聞抓取', () => {
  it('collects official releases and marks them as official', async () => {
    stub(cbcFeed([today, daysAgo(2)]), '<rss><channel></channel></rss>')
    const { items } = await fetchNews()
    expect(items.length).toBe(2)
    expect(items[0].official).toBe(true)
    expect(items[0].source).toBe('中央銀行新聞稿')
    expect(items[0].title).toContain('公開市場操作資訊')
  })

  it('drops anything older than the two-week window', async () => {
    stub(cbcFeed([today, daysAgo(40)]), '<rss><channel></channel></rss>')
    const { items } = await fetchNews()
    expect(items.length).toBe(1)
  })

  it('keeps money-market headlines and strips the trailing source name', async () => {
    stub(cbcFeed([today]), `<rss><channel>
      ${googleItem('央行8月大舉回收資金加發定存單逾2,000億元', '工商時報', today, 'a')}
    </channel></rss>`)
    const { items } = await fetchNews()
    const media = items.filter(item => !item.official)
    expect(media).toHaveLength(1)
    expect(media[0].title).toBe('央行8月大舉回收資金加發定存單逾2,000億元')
    expect(media[0].source).toBe('工商時報')
  })

  it('filters out other countries and off-topic headlines', async () => {
    stub(cbcFeed([today]), `<rss><channel>
      ${googleItem('韓國央行證實美元穩定幣需求', '動區動趨', today, 'b')}
      ${googleItem('央行打房房價卻不跌', 'Yahoo新聞', today, 'c')}
      ${googleItem('台股收盤創新高', '經濟日報', today, 'd')}
    </channel></rss>`)
    const { items } = await fetchNews()
    expect(items.filter(item => !item.official)).toHaveLength(0)
  })

  it('deduplicates the same headline returned by several queries', async () => {
    const duplicate = googleItem('TAIBOR 利率走升', '工商時報', today, 'e')
    stub(cbcFeed([today]), `<rss><channel>${duplicate}${duplicate}</channel></rss>`)
    const { items } = await fetchNews()
    expect(items.filter(item => !item.official)).toHaveLength(1)
  })

  it('still returns official news when the media feed is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('cbc.gov.tw')
        ? new Response(cbcFeed([today]))
        : new Response('boom', { status: 500 })
    ))
    const { items, status } = await fetchNews()
    expect(items).toHaveLength(1)
    expect(status).toContain('媒體 0 則')
  })

  it('throws when nothing at all could be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(fetchNews()).rejects.toThrow('查無新聞')
  })
})
