import { describe, expect, it, vi } from 'vitest'
import { fetchMarketSources } from './sources'

const tdccHistoryTable = `<table class="table"><thead><tr><th>日期\\天期</th><th>10</th><th>20</th><th>30</th><th>60</th><th>90</th><th>120</th><th>150</th><th>180</th><th>365</th><th>備註</th></tr></thead>
<tr><td>2026-09-04</td><td>1.6635</td><td>1.7073</td><td>1.7527</td><td>1.8075</td><td>1.8515</td><td>1.8910</td><td>1.9292</td><td>1.9672</td><td>2.0535</td><td></td></tr>
<tr><td>2026-09-03</td><td>1.6635</td><td>1.7073</td><td>1.7527</td><td>1.8075</td><td>1.8482</td><td>1.8910</td><td>1.9292</td><td>1.9672</td><td>2.0535</td><td></td></tr></table>`

const tdccGetPage = `<input type="hidden" name="SYNCHRONIZER_TOKEN" value="tok-123" /><input type="hidden" name="SYNCHRONIZER_URI" value="/portal/zh/tcWeb/tc_05sat_main03_5" />`

const taiborIndex = `<a href="/taiborDaily/details?id=3266">最新</a>`
const taiborDetails = `<a href="/taiborDaily/DownloadFile?intId=1&downName=.csv">2026.09.04TAIBOR&#xFF08;&#x7576;&#x65E5;&#x8CC7;&#x6599;&#xFF09;.csv</a>
<a href="/taiborDaily/DownloadFile?intId=2&downName=.csv">2026.09.04TAIBOR&#xFF08;&#x6B77;&#x53F2;&#x8CC7;&#x6599;&#xFF09;.csv</a>`
const taiborCsvText = '日期,一星期,二星期,一個月,二個月,三個月,六個月,九個月,一年期\n04SEP26,1.38278,1.47389,1.60356,1.62933,1.68322,1.71356,1.78289,1.89200\n'
const taiborCsvBytes = new TextEncoder().encode(taiborCsvText)

const overnightPage = `<p>金融業隔夜拆款利率 標題(顯示資料日期) 利率 2026/09/04 0.822 2026/09/03 0.821</p>`

const ncdList = `<a href="/tw/cp-1163-192813-6b36b-1.html" title="115年9月4日中央銀行公開市場操作資訊">115年9月4日中央銀行公開市場操作資訊</a>`
const ncdDetail = `<p>一、115年9月4日本行定期存單發行情形 ... 到期金額(1) 3,590.50 9,294.50 發行金額(2) 3,284.00 9,868.50</p>`

function jsonResponse(body: string, extraHeaders?: Record<string, string>) {
  return new Response(body, { headers: extraHeaders })
}

describe('official source parsing (live-site formats)', () => {
  it('assembles a complete snapshot from the current TDCC/TAIBOR/央行 page formats', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('tc_05sat_main03_5') || url.includes('tc_05sat_main03_6')) {
        if (init?.method === 'POST') return jsonResponse(tdccHistoryTable)
        return jsonResponse(tdccGetPage)
      }
      if (url.includes('taiborDaily/index')) return jsonResponse(taiborIndex)
      if (url.includes('taiborDaily/details')) return jsonResponse(taiborDetails)
      if (url.includes('DownloadFile')) return new Response(taiborCsvBytes)
      if (url.includes('lp-641-1')) return jsonResponse(overnightPage)
      if (url.includes('lp-1163-1.html')) return jsonResponse(ncdList)
      if (url.includes('cp-1163-')) return jsonResponse(ncdDetail)
      throw new Error(`unexpected url ${url}`)
    }))

    const values = await fetchMarketSources()
    expect(values.date).toBe('2026-09-04')
    expect(values.taibir90Primary).toBe(1.8515)
    expect(values.taibir90Secondary).toBe(1.8515)
    expect(values.taibor3m).toBe(1.68322)
    expect(values.overnightRate).toBe(0.822)
    expect(values.ncdNetIssuance).toBe(-30650)
  })

  it('throws instead of publishing when a source cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('<p>no data</p>')))
    await expect(fetchMarketSources()).rejects.toThrow('資料尚未完整定盤')
  })
})
