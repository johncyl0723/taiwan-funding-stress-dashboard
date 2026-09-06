import { clean, decodeCsv, fetchBuffer, fetchText, openDataPeriod, rocPeriod, splitCsvLine, toNumber } from '../fetch.js'
import type { MonthlySeries, WeeklyBillPoint } from '../../../src/types.js'

const OPENDATA = 'https://www.cbc.gov.tw/public/data/OpenData'

interface CsvTable {
  headers: string[]
  rows: string[][]
}

function parseCsv(text: string): CsvTable {
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const rows = lines.map(splitCsvLine)
  return { headers: rows[0] ?? [], rows: rows.slice(1) }
}

function columnAt(table: CsvTable, label: string, context: string): number {
  const index = table.headers.findIndex(header => header.replace(/\s/g, '') === label.replace(/\s/g, ''))
  if (index < 0) throw new Error(`${context} 找不到「${label}」欄位（表頭：${table.headers.slice(0, 6).join('/')}…）`)
  return index
}

/** 期間欄位在不同檔案分別是「2026M07」與民國「11507」，兩種都接受 */
const parsePeriod = (token: string) => openDataPeriod(token) ?? rocPeriod(token)

async function loadCsv(url: string, marker: string): Promise<CsvTable> {
  return parseCsv(decodeCsv(await fetchBuffer(url), marker))
}

/** 央行經研處 OpenData：期間 + 各科目原始值／年增率 */
async function cbcOpenDataSeries(
  file: string,
  column: string,
  meta: Omit<MonthlySeries, 'points' | 'sourceUrl'>
): Promise<MonthlySeries> {
  const url = `${OPENDATA}/${encodeURIComponent('經研處')}/${file}`
  const table = await loadCsv(url, '期間')
  const periodIndex = columnAt(table, '期間', file)
  const valueIndex = columnAt(table, column, file)

  const points: MonthlySeries['points'] = []
  for (const row of table.rows) {
    const period = parsePeriod(row[periodIndex] ?? '')
    const value = Number(row[valueIndex])
    if (period && row[valueIndex] !== '-' && Number.isFinite(value)) points.push({ period, value })
  }
  if (!points.length) throw new Error(`${file} 查無有效資料列`)
  return { ...meta, sourceUrl: url, points: points.sort((a, b) => a.period.localeCompare(b.period)) }
}

/**
 * 金融機構存款準備金：每期多列（本國銀行、外銀分行…），只取「合計」列。
 * 期別碼在第一欄且只在該期第一列出現，之後的列要沿用上一個期別。
 */
async function excessReserveSeries(): Promise<MonthlySeries> {
  const url = `${OPENDATA.replace('/OpenData', '/opendata')}/${encodeURIComponent('業務局')}/${encodeURIComponent('存款科')}/reserverequirementsdata/reserverequirementsdata.csv`
  const table = await loadCsv(url, '應提準備額合計')
  const excessIndex = columnAt(table, '本期超額或不足', '存款準備金')

  const points: MonthlySeries['points'] = []
  let period: string | null = null
  for (const row of table.rows) {
    if (row[0]?.trim()) period = parsePeriod(row[0].trim())
    if (!period || row[1]?.trim() !== '合計') continue
    const value = toNumber(row[excessIndex] ?? '')
    // 千元 → 億元
    if (Number.isFinite(value)) points.push({ period, value: Math.round(value / 100_000) })
  }
  if (!points.length) throw new Error('存款準備金 CSV 查無合計列')
  return {
    key: 'excessReserve',
    label: '超額準備',
    unit: '億元',
    hint: '實際準備減應提準備，體系剩餘流動性總量',
    sourceUrl: url,
    points: points.sort((a, b) => a.period.localeCompare(b.period))
  }
}

/** 五大銀行牌告：每期五家各一列，取基準利率（機動）的平均 */
async function bigFiveBaseRateSeries(): Promise<MonthlySeries> {
  const url = `${OPENDATA}/A13Rate.csv`
  const table = await loadCsv(url, '基準利率-機動')
  const periodIndex = columnAt(table, '年月', '五大銀行利率')
  const rateIndex = columnAt(table, '基準利率-機動', '五大銀行利率')

  const buckets = new Map<string, number[]>()
  for (const row of table.rows) {
    const period = parsePeriod(row[periodIndex] ?? '')
    const value = Number(row[rateIndex])
    if (!period || !Number.isFinite(value) || value <= 0) continue
    buckets.set(period, [...(buckets.get(period) ?? []), value])
  }
  const points = [...buckets.entries()]
    .map(([period, values]) => ({
      period,
      value: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    }))
    .sort((a, b) => a.period.localeCompare(b.period))
  if (!points.length) throw new Error('五大銀行利率 CSV 查無資料列')
  return {
    key: 'bigFiveBaseRate',
    label: '五大銀行基準利率（機動）',
    unit: '%',
    hint: '五家公股行庫牌告基準利率平均，銀行額度加碼的外部基準',
    sourceUrl: url,
    points
  }
}

const MONTHLY_TASKS: { key: string; run: () => Promise<MonthlySeries> }[] = [
  { key: '超額準備', run: excessReserveSeries },
  {
    key: '準備貨幣',
    run: () => cbcOpenDataSeries('EF11M01.csv', '準備貨幣-原始值', {
      key: 'reserveMoney', label: '準備貨幣', unit: '新台幣百萬元',
      hint: '通貨發行額加金融機構準備金，貨幣供給的基礎'
    })
  },
  {
    key: 'M1B 年增率',
    run: () => cbcOpenDataSeries('EF15M01.csv', '貨幣總計數 -Ｍ１Ｂ-年增率', {
      key: 'm1bYoY', label: 'M1B 年增率', unit: '%',
      hint: '跌破 M2 年增率代表資金由活存轉向定存，市場資金活性下降'
    })
  },
  {
    key: 'M2 年增率',
    run: () => cbcOpenDataSeries('EF15M01.csv', '貨幣總計數 -Ｍ２-年增率', {
      key: 'm2YoY', label: 'M2 年增率', unit: '%',
      hint: '廣義貨幣成長，央行的中間目標'
    })
  },
  {
    key: '政府存款',
    run: () => cbcOpenDataSeries('EF25M01.csv', '政府存款-計-原始值', {
      key: 'governmentDeposits', label: '政府存款', unit: '新台幣百萬元',
      hint: '稅款入庫時資金由銀行體系移入國庫，等額抽走銀行準備'
    })
  },
  { key: '五大銀行基準利率', run: bigFiveBaseRateSeries }
]

export async function fetchMonthlySeries(): Promise<{ series: MonthlySeries[]; status: Record<string, string> }> {
  const status: Record<string, string> = {}
  const series: MonthlySeries[] = []
  for (const task of MONTHLY_TASKS) {
    try {
      const result = await task.run()
      series.push(result)
      status[task.key] = `${task.key} 已讀取（${result.points.length} 期，最新 ${result.points.at(-1)!.period}）`
    } catch (error) {
      status[task.key] = `${task.key} 讀取失敗：${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { series, status }
}

/**
 * 集保「票券保管結算交割週統計表」：初級市場承銷／兌償與次級市場各類交易量。
 * 表頭是兩層合併儲存格，資料列固定為「週別 + 7 個數字」，依位置取前四個。
 */
export async function fetchWeeklyBills(): Promise<WeeklyBillPoint[]> {
  const html = await fetchText('https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main02_3')
  const table = html.match(/<table[^>]*>[\s\S]*?<\/table>/)?.[0]
  if (!table) throw new Error('查無票券週統計表格')

  const points: WeeklyBillPoint[] = []
  for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1]))
    if (!/^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '')) continue
    const values = cells.slice(1).map(toNumber)
    if (values.length < 4 || values.some(value => !Number.isFinite(value))) continue
    points.push({
      week: cells[0].replace(/\s+/g, ' '),
      primaryIssue: values[0],
      primaryRedeem: values[1],
      secondaryOutright: values[2],
      secondaryRepo: values[3]
    })
  }
  if (!points.length) throw new Error('票券週統計查無資料列')
  return points.sort((a, b) => a.week.localeCompare(b.week))
}
