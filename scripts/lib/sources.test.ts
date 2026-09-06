import { describe, expect, it, vi } from 'vitest'
import { fetchMarketSeries } from './sources'

const tdccGetPage = `<input type="hidden" name="SYNCHRONIZER_TOKEN" value="tok-123" /><input type="hidden" name="SYNCHRONIZER_URI" value="/portal/zh/tcWeb/tc_05sat_main03_5" />`

const tdccHistoryTable = `<table class="table"><thead><tr><th>日期\\天期</th><th>10</th><th>20</th><th>30</th><th>60</th><th>90</th><th>120</th><th>150</th><th>180</th><th>365</th><th>備註</th></tr></thead>
<tr><td>2026-09-04</td><td>1.9117</td><td>1.9273</td><td>1.9653</td><td>2.0410</td><td>2.0943</td><td>2.1457</td><td>2.2127</td><td>2.2997</td><td>2.4190</td><td></td></tr>
<tr><td>2026-09-03</td><td>1.9117</td><td>1.9273</td><td>1.9653</td><td>2.0410</td><td>2.0910</td><td>2.1457</td><td>2.2127</td><td>2.2997</td><td>2.4190</td><td></td></tr></table>`

const taiborIndex = `<a href="/taiborDaily/details?id=3266">2026.09.04&#x53F0;&#x5317;&#x91D1;&#x878D;&#x696D;</a>
<a href="/taiborDaily/details?id=3262">2026&#x5E74;8&#x6708;&#x6708;&#x5831;</a>`
const taiborDaily = `<a href="/taiborDaily/DownloadFile?intId=1&amp;downName=.csv">2026.09.04TAIBOR&#xFF08;&#x7576;&#x65E5;&#x8CC7;&#x6599;15&#x5BB6;).csv</a>
<a href="/taiborDaily/DownloadFile?intId=2&amp;downName=.csv">2026.09.04TAIBOR&#xFF08;&#x6B77;&#x53F2;&#x8CC7;&#x6599;15&#x5BB6;).csv</a>`
const taiborMonthly = `<a href="/taiborDaily/DownloadFile?intId=3&amp;downName=.csv">AUG2026.csv</a>`

const dailyCsv = '中華民國銀行公會金融業拆款中心,,,,,,,,\n日期,一星期,二星期,一個月,二個月,三個月,六個月,九個月,一年期\n04SEP26,1.38278,1.47389,1.60356,1.62933,1.68322,1.71356,1.78289,1.89200\n03SEP26,1.38278,1.47367,1.60356,1.62933,1.68300,1.71356,1.78300,1.89211\n'
const monthlyCsv = '日期,一星期,二星期,一個月,二個月,三個月,六個月,九個月,一年期\n31AUG26,1.38278,1.47344,1.60344,1.62933,1.68300,1.71344,1.78289,1.89200\n'

/** 天期欄位互換：解析器必須依表頭定位，不能依賴固定欄序 */
const reorderedCsv = '日期,三個月,一星期,二星期,一個月,二個月,六個月,九個月,一年期\n04SEP26,1.68322,1.38278,1.47389,1.60356,1.62933,1.71356,1.78289,1.89200\n'

const overnightPage = `<p>金融業隔夜拆款利率 2026/09/04 0.822 2026/09/03 0.821</p>`
const ncdList = `<a href="/tw/cp-1163-192813-6b36b-1.html" title="115年9月4日中央銀行公開市場操作資訊">操作</a>
<a href="/tw/cp-1163-192772-d136c-1.html" title="115年9月4日中央銀行存單申購發行資訊">申購</a>`
const ncdDetail = `<p>一、115年9月4日本行定期存單發行情形 發行金額合計 3,284.00 二、到期金額(1) 3,590.50 9,294.50 發行金額(2) 3,284.00 9,868.50</p>`

function stubSite(overrides: Record<string, string> = {}) {
  const csvByIntId: Record<string, string> = { '1': dailyCsv, '2': dailyCsv, '3': monthlyCsv, ...overrides }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('tc_05sat_main03_')) {
      return new Response(init?.method === 'POST' ? tdccHistoryTable : tdccGetPage)
    }
    if (url.includes('taiborDaily/index')) return new Response(taiborIndex)
    if (url.includes('taiborDaily/details?id=3266')) return new Response(taiborDaily)
    if (url.includes('taiborDaily/details?id=3262')) return new Response(taiborMonthly)
    if (url.includes('DownloadFile')) {
      const intId = url.match(/intId=(\d+)/)![1]
      return new Response(new TextEncoder().encode(csvByIntId[intId]))
    }
    if (url.includes('lp-641-1-')) return new Response(overnightPage)
    if (url.includes('lp-1163-1-')) return new Response(ncdList)
    if (url.includes('cp-1163-')) return new Response(ncdDetail)
    throw new Error(`unexpected url ${url}`)
  }))
}

describe('official source parsing (live-site formats)', () => {
  it('assembles a multi-day series from the current TDCC/TAIBOR/央行 page formats', async () => {
    stubSite()
    const result = await fetchMarketSeries(60)
    const dates = result.observations.map(observation => observation.date)

    // 月報回補讓序列涵蓋 8 月，而不是只有最新一天
    expect(dates).toContain('2026-08-31')
    expect(dates.at(-1)).toBe('2026-09-04')

    const latest = result.observations.at(-1)!
    expect(latest.taibir90Primary).toBe(2.0943)
    expect(latest.taibir90Secondary).toBe(2.0943)
    expect(latest.taibor3m).toBe(1.68322)
    expect(latest.overnightRate).toBe(0.822)
    expect(latest.ncdNetIssuance).toBe(-30650)
  })

  it('locates the 三個月 column by header rather than by position', async () => {
    stubSite({ '1': reorderedCsv, '2': reorderedCsv })
    const result = await fetchMarketSeries(60)
    expect(result.observations.at(-1)!.taibor3m).toBe(1.68322)
  })

  it('still publishes when only a non-core source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('lp-1163-1-') || url.includes('cp-1163-')) return new Response('<p>maintenance</p>', { status: 500 })
      if (url.includes('tc_05sat_main03_')) return new Response(init?.method === 'POST' ? tdccHistoryTable : tdccGetPage)
      if (url.includes('taiborDaily/index')) return new Response(taiborIndex)
      if (url.includes('taiborDaily/details?id=3266')) return new Response(taiborDaily)
      if (url.includes('taiborDaily/details?id=3262')) return new Response(taiborMonthly)
      if (url.includes('DownloadFile')) return new Response(new TextEncoder().encode(dailyCsv))
      if (url.includes('lp-641-1-')) return new Response(overnightPage)
      throw new Error(`unexpected url ${url}`)
    }))

    const result = await fetchMarketSeries(60)
    expect(result.observations.at(-1)!.ncdNetIssuance).toBeNull()
    expect(result.observations.at(-1)!.taibir90Primary).toBe(2.0943)
    expect(result.sourceStatus['央行 NCD']).toContain('讀取失敗')
  })

  it('throws instead of publishing when a core source cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>no data</p>')))
    await expect(fetchMarketSeries(60)).rejects.toThrow('核心來源缺漏')
  })
})
