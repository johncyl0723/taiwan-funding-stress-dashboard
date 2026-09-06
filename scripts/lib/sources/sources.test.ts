import { describe, expect, it, vi } from 'vitest'
import { extractAnnouncementBody, parseNcdAnnouncement, parseNcdAuction } from './cbc'
import { fetchMarketSeries } from './index'

/** 央行公告內文（已去標籤），同列先給當日再給月累計 */
const NCD_TEXT = '中央銀行公開市場操作資訊 一、115年9月4日本行定期存單發行情形 定期存單期限 利率(%) 金額(億元) '
  + '7天期 0.825 177.00 28天期 1.215 1,595.00 91天期 1.275 312.00 364天期 1.643 1,200.00 發行金額合計 3,284.00 '
  + '二、115年9月本行定期存單到期與發行情形 單位(億元) 9月4日 9月1日至4日 到期金額(1) 3,590.50 9,294.50 '
  + '發行金額(2) 3,284.00 9,868.50 增減比較(2)-(1) -306.50 574.00 '
  + '三、截至115年9月4日止，本行定期存單未到期餘額為65,952.70億元'

describe('央行公開市場操作公告解析', () => {
  it('takes the same-day column, not the month-to-date column', () => {
    const parsed = parseNcdAnnouncement(NCD_TEXT)
    // (3,284.00 − 3,590.50) 億 = −306.5 億 = −30,650 百萬
    expect(parsed.netIssuanceMillion).toBe(-30650)
    expect(parsed.outstandingMillion).toBe(6_595_270)
  })

  it('reads the 7-day issuance rate used as the corridor floor', () => {
    expect(parseNcdAnnouncement(NCD_TEXT).rates['7']).toBe(0.825)
    expect(parseNcdAnnouncement(NCD_TEXT).rates['364']).toBe(1.643)
  })

  it('does not mistake the 發行金額合計 line for the daily issuance figure', () => {
    // 合計 3,284.00 恰好與當日相同，改測一份兩者不同的公告
    const text = NCD_TEXT.replace('發行金額合計 3,284.00', '發行金額合計 9,999.00')
    expect(parseNcdAnnouncement(text).netIssuanceMillion).toBe(-30650)
  })

  it('detects a repo operation only when the announcement body mentions one', () => {
    expect(parseNcdAnnouncement(NCD_TEXT).repoOperation).toBe(false)
    expect(parseNcdAnnouncement(`${NCD_TEXT} 四、本行辦理附買回操作 500.00 億元`).repoOperation).toBe(true)
  })

  it('ignores the site navigation, which always contains 附買回', () => {
    // 央行每一頁的左側選單都有「小規模附買回測試操作」，整頁比對會天天誤報
    const page = `回首頁 網站導覽 ${NCD_TEXT} 檔案下載 20260904 PDF ODS XLS 貨幣政策工具 公開市場操作 小規模附買回測試操作 金融機構轉存款`
    expect(parseNcdAnnouncement(page).repoOperation).toBe(false)
    expect(parseNcdAnnouncement(page).netIssuanceMillion).toBe(-30650)
  })

  it('slices the announcement body between 一、 and 檔案下載', () => {
    const body = extractAnnouncementBody(`導覽列 ${NCD_TEXT} 檔案下載 選單 附買回`)
    expect(body).toContain('到期金額(1)')
    expect(body).not.toContain('選單')
  })

  it('parses the 364-day auction result', () => {
    const auction = parseNcdAuction(
      '期別 發行總額 (億元) 投標總額 (億元) 得標總額 (億元) 投標倍數 得標比率 得標加權 平均利率 364天 1,200.00 2,026.00 1,200.00 1.69 59.23% 1.643 %',
      '2026-09-01'
    )
    expect(auction).toEqual({ date: '2026-09-01', issueAmount: 1200, bidAmount: 2026, bidToCover: 1.69, awardRate: 1.643 })
  })
})

// ---- 整合：以固定的官網格式樣本組出一段序列 -------------------------------

const tdccGetPage = '<input type="hidden" name="SYNCHRONIZER_TOKEN" value="tok-123" />'
  + '<input type="hidden" name="SYNCHRONIZER_URI" value="/portal/zh/tcWeb/tc_05sat_main03_5" />'

const tdccTable = `<table class="table"><thead><tr><th>日期\\天期</th><th>10</th><th>20</th><th>30</th><th>60</th><th>90</th><th>120</th><th>150</th><th>180</th><th>365</th><th>備註</th></tr></thead>
<tr><td>2026-09-04</td><td>1.9117</td><td>1.9273</td><td>1.9653</td><td>2.0410</td><td>2.0943</td><td>2.1457</td><td>2.2127</td><td>2.2997</td><td>2.4190</td><td></td></tr>
<tr><td>2026-09-03</td><td>1.9117</td><td>1.9273</td><td>1.9653</td><td>2.0410</td><td>2.0910</td><td>2.1457</td><td>2.2127</td><td>2.2997</td><td>2.4190</td><td></td></tr></table>`

const taiborIndex = '<a href="/taiborDaily/details?id=3266">2026.09.04&#x53F0;&#x5317;</a>'
  + '<a href="/taiborDaily/details?id=3262">2026&#x5E74;8&#x6708;&#x6708;&#x5831;</a>'
const taiborDaily = '<a href="/taiborDaily/DownloadFile?intId=1&amp;downName=.csv">2026.09.04TAIBOR&#xFF08;&#x7576;&#x65E5;&#x8CC7;&#x6599;15&#x5BB6;).csv</a>'
  + '<a href="/taiborDaily/DownloadFile?intId=2&amp;downName=.csv">2026.09.04TAIBOR&#xFF08;&#x6B77;&#x53F2;&#x8CC7;&#x6599;15&#x5BB6;).csv</a>'
const taiborMonthly = '<a href="/taiborDaily/DownloadFile?intId=3&amp;downName=.csv">AUG2026.csv</a>'

const dailyCsv = '中華民國銀行公會金融業拆款中心,,,,,,,,\n日期,一星期,二星期,一個月,二個月,三個月,六個月,九個月,一年期\n'
  + '04SEP26,1.38278,1.47389,1.60356,1.62933,1.68322,1.71356,1.78289,1.89200\n'
  + '03SEP26,1.38278,1.47367,1.60356,1.62933,1.68300,1.71356,1.78300,1.89211\n'
const monthlyCsv = '日期,一星期,二星期,一個月,二個月,三個月,六個月,九個月,一年期\n'
  + '31AUG26,1.38278,1.47344,1.60344,1.62933,1.68300,1.71344,1.78289,1.89200\n'
/** 天期欄位互換：解析器必須依表頭定位，不能依賴固定欄序 */
const reorderedCsv = '日期,三個月,一星期,二星期,一個月,二個月,六個月,九個月,一年期\n'
  + '04SEP26,1.68322,1.38278,1.47389,1.60356,1.62933,1.71356,1.78289,1.89200\n'

const overnightPage = '<p>金融業隔夜拆款利率 2026/09/04 0.822 2026/09/03 0.821</p>'
const fxPage = '<p>新臺幣/美元 2026/09/04 31.630 2026/09/03 31.755</p>'
const policyPage = '<p>調整日期 重貼現率 擔保放款融通利率 短期融通利率 2024/3/22 2 2.375 4.25 2023/3/24 1.875 2.25 4.125</p>'
const ncdList = '<a href="/tw/cp-1163-1.html" title="115年9月4日中央銀行公開市場操作資訊">操作</a>'
  + '<a href="/tw/cp-1163-2.html" title="115年9月4日中央銀行存單申購發行資訊">申購</a>'
const twseJson = JSON.stringify({
  stat: 'OK', date: '20260904',
  data: [['外資及陸資(不含外資自營商)', '362,796,136,864', '306,583,183,061', '56,212,953,803']]
})
const sofrJson = JSON.stringify({
  refRates: [{ effectiveDate: '2026-09-04', average30day: 3.64586, average90day: 3.64571, average180day: 3.65865 }]
})

function stubSite(overrides: Record<string, string> = {}, fail: string[] = []) {
  const csv: Record<string, string> = { '1': dailyCsv, '2': dailyCsv, '3': monthlyCsv, ...overrides }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const blocked = fail.find(fragment => url.includes(fragment))
    if (blocked) return new Response('<p>maintenance</p>', { status: 500 })
    if (url.includes('tc_05sat_main03_')) return new Response(init?.method === 'POST' ? tdccTable : tdccGetPage)
    if (url.includes('taiborDaily/index')) return new Response(taiborIndex)
    if (url.includes('taiborDaily/details?id=3266')) return new Response(taiborDaily)
    if (url.includes('taiborDaily/details?id=3262')) return new Response(taiborMonthly)
    if (url.includes('DownloadFile')) {
      return new Response(new TextEncoder().encode(csv[url.match(/intId=(\d+)/)![1]]))
    }
    if (url.includes('lp-641-1-')) return new Response(overnightPage)
    if (url.includes('lp-645-1-')) return new Response(fxPage)
    if (url.includes('lp-370-1')) return new Response(policyPage)
    if (url.includes('lp-1163-1-')) return new Response(ncdList)
    if (url.includes('cp-1163-')) return new Response(NCD_TEXT)
    if (url.includes('twse.com.tw')) return new Response(twseJson)
    if (url.includes('newyorkfed.org')) return new Response(sofrJson)
    throw new Error(`unexpected url ${url}`)
  }))
}

describe('official source parsing (live-site formats)', () => {
  it('assembles a multi-day series with full curves from every source', async () => {
    stubSite()
    const result = await fetchMarketSeries(60)
    const dates = result.observations.map(observation => observation.date)
    expect(dates).toContain('2026-08-31')
    expect(dates.at(-1)).toBe('2026-09-04')

    const latest = result.observations.at(-1)!
    expect(latest.taibirPrimary['90']).toBe(2.0943)
    expect(latest.taibirPrimary['30']).toBe(1.9653)
    expect(latest.taibirPrimary['180']).toBe(2.2997)
    expect(latest.taibirSecondary['90']).toBe(2.0943)
    expect(latest.taibor['3M']).toBe(1.68322)
    expect(latest.taibor['1W']).toBe(1.38278)
    expect(latest.overnightRate).toBe(0.822)
    expect(latest.ncdNetIssuance).toBe(-30650)
    expect(latest.ncdRates['7']).toBe(0.825)
    expect(latest.usdTwd).toBe(31.63)
    expect(latest.sofr90).toBe(3.64571)
    // 562.1 億元 → 56,213 百萬元
    expect(latest.foreignNet).toBe(56213)
    expect(result.policyRate?.rediscount).toBe(2)
  })

  it('locates the 三個月 column by header rather than by position', async () => {
    stubSite({ '1': reorderedCsv, '2': reorderedCsv })
    const result = await fetchMarketSeries(60)
    expect(result.observations.at(-1)!.taibor['3M']).toBe(1.68322)
  })

  it('still publishes when only non-core sources fail', async () => {
    stubSite({}, ['lp-1163', 'cp-1163', 'twse.com.tw', 'newyorkfed.org'])
    const result = await fetchMarketSeries(60)
    const latest = result.observations.at(-1)!
    expect(latest.taibirPrimary['90']).toBe(2.0943)
    expect(latest.ncdNetIssuance).toBeNull()
    expect(latest.foreignNet).toBeNull()
    expect(latest.sofr90).toBeNull()
    expect(result.sourceStatus['央行 NCD']).toContain('讀取失敗')
    expect(result.sourceStatus['外資買賣超']).toContain('讀取失敗')
  })

  it('throws instead of publishing when a core source cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>no data</p>')))
    await expect(fetchMarketSeries(60)).rejects.toThrow('核心來源缺漏')
  })
})
