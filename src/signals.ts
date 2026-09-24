import type { HistoryPoint, MonthlySeries } from './types'

/**
 * 每個指標右上角的「一眼看懂」徽章。
 *
 * - 量的指標：這個數字代表台灣資金水位增加（▲）、減少（▼）或持平（▶）。
 * - 價的指標：這個數字代表資金面目前寬鬆、中性或緊縮。
 * - 不直接對應台幣寬緊的指標（外幣、期限溢酬形狀）標「參考指標」，不硬湊方向。
 *
 * 門檻是依歷史資料分布訂的經驗值，未經回測校準，判斷依據會連同數字一起顯示在畫面上。
 */
export type SignalTone = 'loose' | 'neutral' | 'tight' | 'severe' | 'reference'

export interface Signal {
  label: string
  arrow: '▲' | '▼' | '▶' | ''
  tone: SignalTone
  /** 判斷依據，含當下數字與門檻，畫面上會直接顯示 */
  basis: string
}

const LEVEL_WORDS = { up: '水位增加', down: '水位減少', flat: '水位持平' }
const GROWTH_WORDS = { up: '成長加速', down: '成長放緩', flat: '成長持平' }

/** 量：5 日合計小於這個值視為持平（百萬元） */
const FLOW_DEADBAND = 10_000
/** NCD 餘額 5 個交易日的變動小於餘額本身的這個比例視為持平 */
const OUTSTANDING_DEADBAND_RATIO = 0.005
/** 月頻變動小於近 60 期變動標準差的這個倍數視為持平 */
const MONTHLY_DEADBAND_SD = 0.25

/** z-score 型（TFSS、初次級利差）：與 TSS 綜合指數的 1.0／1.5 門檻同一套，0.5 以上只標「略偏」 */
const Z_BANDS = { lean: 0.5, mild: 1.0, strong: 1.5 }
/** 利率水位型：與近 120 日中位數的差距（bp） */
const DEVIATION_BANDS = { mild: 3, strong: 10 }
/** 走廊位置：貼近下限視為寬鬆 */
const CORRIDOR_BANDS = { loose: 0.05, mild: 0.15, strong: 0.3 }

const commas = (value: number, digits = 0) =>
  value.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const percentOf = (ratio: number) => Math.round(ratio * 1000) / 10
const signed = (value: number, digits = 0) => `${value >= 0 ? '+' : '-'}${commas(Math.abs(value), digits)}`

const insufficient = (reason: string): Signal => ({ label: '資料不足', arrow: '', tone: 'reference', basis: reason })

/** 量：value 是流量或變動量，effect 表示數值上升會讓台灣資金水位增加（1）或減少（-1） */
function levelSignal(
  value: number, effect: 1 | -1, deadband: number, basis: string, words = LEVEL_WORDS
): Signal {
  if (Math.abs(value) <= deadband) return { label: words.flat, arrow: '▶', tone: 'neutral', basis }
  return value * effect > 0
    ? { label: words.up, arrow: '▲', tone: 'loose', basis }
    : { label: words.down, arrow: '▼', tone: 'tight', basis }
}

/** 價：score 正值代表偏緊、負值代表偏鬆 */
function priceSignal(
  score: number, bands: { lean?: number; mild: number; strong: number }, basis: string
): Signal {
  const tight = score > 0
  const size = Math.abs(score)
  if (size >= bands.strong) {
    return { label: tight ? '緊縮' : '寬鬆', arrow: '', tone: tight ? 'severe' : 'loose', basis }
  }
  if (size >= bands.mild) {
    return { label: tight ? '偏緊' : '偏鬆', arrow: '', tone: tight ? 'tight' : 'loose', basis }
  }
  if (bands.lean !== undefined && size >= bands.lean) {
    return { label: tight ? '中性・略偏緊' : '中性・略偏鬆', arrow: '', tone: 'neutral', basis }
  }
  return { label: '中性', arrow: '', tone: 'neutral', basis }
}

const numbers = (history: HistoryPoint[], key: keyof HistoryPoint) =>
  history.map(point => point[key]).filter((value): value is number => typeof value === 'number')

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stdev(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

/** 與 n 個交易日前比較，沿用 scripts/lib/insight.ts 的「較 5 個交易日前」算法 */
function changeBack(history: HistoryPoint[], key: keyof HistoryPoint, back: number): number | null {
  const current = history.at(-1)?.[key]
  const before = history.at(-(back + 1))?.[key]
  if (typeof current !== 'number' || typeof before !== 'number') return null
  return current - before
}

/** 利率水位型：與近 120 日中位數比較。這些利率貼著政策利率走，變動極小，不能用 z-score（雜訊會被放大成訊號） */
function deviationSignal(history: HistoryPoint[], key: keyof HistoryPoint, toBp: number, name: string): Signal {
  const values = numbers(history.slice(-120), key)
  const latest = history.at(-1)?.[key]
  if (values.length < 30 || typeof latest !== 'number') {
    return insufficient(`${name}歷史樣本不足 30 個交易日，暫不判讀。`)
  }
  const deviation = (latest - median(values)) * toBp
  return priceSignal(
    deviation,
    DEVIATION_BANDS,
    `${name}較近 120 日中位數 ${signed(deviation, 1)} bp（±${DEVIATION_BANDS.mild} bp 內視為中性，`
      + `±${DEVIATION_BANDS.strong} bp 以上為明顯）。這類利率貼著政策利率走，平常變動很小。`
  )
}

const REFERENCE: Record<string, string> = {
  taibirSlope: '期限溢酬的形狀同時牽涉短端與遠端預期，不直接對應台幣資金水位或寬緊，僅供選擇發票天期時參考。',
  sofr: '這是美元利率，反映美元資金成本，不是台幣資金水位或寬緊。',
  fxSpread: '兩個利率的名目差；換匯點資料尚未接上，無法據此判斷台幣寬緊。',
  usdTwd: '匯率同時受貿易、外資與央行調節影響，單看水準無法直接判斷台幣資金寬緊。'
}

/** 第二、三部分的日頻指標。history 尚未載入時回傳 null，畫面先不顯示徽章 */
export function dailySignal(key: string, market: HistoryPoint | null, history: HistoryPoint[]): Signal | null {
  if (!market || !history.length) return null

  if (REFERENCE[key]) return { label: '參考指標', arrow: '', tone: 'reference', basis: REFERENCE[key] }

  switch (key) {
    case 'foreignNet': {
      const value = market.foreignNet5d
      if (value === null) return insufficient('近 5 個交易日外資買賣超資料不完整。')
      return levelSignal(
        value, 1, FLOW_DEADBAND,
        `近 5 日外資淨${value >= 0 ? '買' : '賣'}超 ${commas(Math.abs(value))} 百萬元。買超帶來台幣資金流入，`
          + `賣超則從銀行體系抽走台幣（±${commas(FLOW_DEADBAND)} 百萬元內視為持平）。`
      )
    }

    case 'ncdNetIssuance': {
      const value = market.ncdNetIssuance5d
      if (value === null) return insufficient('近 5 個交易日 NCD 淨發行資料不完整。')
      return levelSignal(
        value, -1, FLOW_DEADBAND,
        `近 5 日央行 NCD 淨${value > 0 ? '吸收' : '釋出'} ${commas(Math.abs(value))} 百萬元。淨吸收＝央行收回台幣，`
          + `淨釋出＝放出台幣（±${commas(FLOW_DEADBAND)} 百萬元內視為持平）。`
      )
    }

    case 'ncdOutstanding': {
      const delta = changeBack(history, 'ncdOutstanding', 5)
      const level = market.ncdOutstanding
      if (delta === null || level === null) return insufficient('NCD 餘額不足 5 個交易日的資料可比較。')
      return levelSignal(
        delta, -1, level * OUTSTANDING_DEADBAND_RATIO,
        `未到期餘額較 5 個交易日前 ${signed(delta / 100)} 億元。餘額下降＝央行到期釋出資金，`
          + `上升＝央行加碼沖銷（變動小於餘額 ${percentOf(OUTSTANDING_DEADBAND_RATIO)}% 視為持平）。`
      )
    }

    case 'corridor': {
      const position = market.corridorPosition
      if (position === null) return insufficient('走廊位置資料不足。')
      const percent = `${(position * 100).toFixed(1)}%`
      const rule = `（0＝貼著下限；${percentOf(CORRIDOR_BANDS.loose)}% 以下視為寬鬆，${percentOf(CORRIDOR_BANDS.mild)}% 以上偏緊，`
        + `${percentOf(CORRIDOR_BANDS.strong)}% 以上緊縮）`
      const basis = `隔拆位於利率走廊 ${percent} 的位置${rule}。台灣隔拆長期貼著下限，是資金結構性寬裕的常態。`
      if (position >= CORRIDOR_BANDS.strong) return { label: '緊縮', arrow: '', tone: 'severe', basis }
      if (position >= CORRIDOR_BANDS.mild) return { label: '偏緊', arrow: '', tone: 'tight', basis }
      if (position > CORRIDOR_BANDS.loose) return { label: '中性', arrow: '', tone: 'neutral', basis }
      return { label: '寬鬆', arrow: '', tone: 'loose', basis }
    }

    case 'overnight':
      return deviationSignal(history, 'overnightRate', 100, '隔拆利率')
    case 'taibor':
      return deviationSignal(history, 'taibor3m', 100, '3M TAIBOR')
    case 'taiborSlope':
      return deviationSignal(history, 'taiborSlopeBp', 1, '1W–3M 斜率')

    case 'tfss':
    case 'primarySecondary': {
      const inputKey = key as 'tfss' | 'primarySecondary'
      const z = market.compositeInputs[inputKey]
      const name = inputKey === 'tfss' ? 'TFSS' : '初級－次級利差'
      if (z === null) {
        const reason = market.excludedInputs?.find(entry => entry.key === inputKey)?.reason
        return insufficient(`${name}${reason ? `：${reason}` : '樣本不足，暫不判讀'}。`)
      }
      return priceSignal(
        z, Z_BANDS,
        `${name}的 120 日 z-score ${signed(z, 2)}（與 TSS 同一套門檻：±${Z_BANDS.mild} 偏緊／偏鬆、`
          + `±${Z_BANDS.strong} 緊縮／寬鬆；±${Z_BANDS.lean} 以上標「略偏」）。`
      )
    }

    default:
      return null
  }
}

const MONTHLY_RULES: Record<string, { effect: 1 | -1; words: typeof LEVEL_WORDS; rule: string }> = {
  excessReserve: { effect: 1, words: LEVEL_WORDS, rule: '超額準備增加＝銀行體系可動用的資金變多' },
  reserveMoney: { effect: 1, words: LEVEL_WORDS, rule: '準備貨幣增加＝貨幣供給基礎擴張' },
  governmentDeposits: { effect: -1, words: LEVEL_WORDS, rule: '政府存款增加＝資金從銀行體系流向國庫、準備被抽走' },
  m1bYoY: { effect: 1, words: GROWTH_WORDS, rule: '年增率走高＝資金水位成長加速，走低＝成長放緩（年增率為正仍代表水位高於去年同期）' },
  m2YoY: { effect: 1, words: GROWTH_WORDS, rule: '年增率走高＝資金水位成長加速，走低＝成長放緩（年增率為正仍代表水位高於去年同期）' }
}

/** 第六部分的月頻背景卡片。牌告基準利率是價，其餘是量 */
export function monthlySignal(series: MonthlySeries): Signal | null {
  const last = series.points.at(-1)
  const prev = series.points.at(-2)
  if (!last || !prev) return null

  const delta = last.value - prev.value
  const digits = series.unit === '%' ? 2 : 0
  const unit = series.unit === '%' ? ' 個百分點' : ` ${series.unit}`
  const change = `${last.period} 較 ${prev.period} ${signed(delta, digits)}${unit}`

  if (series.key === 'bigFiveBaseRate') {
    const basis = `${change}。牌告基準利率上調＝資金成本變貴，下調＝變便宜（±0.01 個百分點內視為持平，`
      + '±0.125 個百分點以上為明顯）。'
    return priceSignal(delta, { mild: 0.01, strong: 0.125 }, basis)
  }

  const rule = MONTHLY_RULES[series.key]
  if (!rule) return null

  const changes = series.points.slice(-61).flatMap((point, index, all) =>
    index === 0 ? [] : [point.value - all[index - 1].value])
  const deadband = changes.length >= 6 ? MONTHLY_DEADBAND_SD * stdev(changes) : 0
  return levelSignal(
    delta, rule.effect, deadband,
    `${change}。${rule.rule}（變動小於近 60 期波動的 ${MONTHLY_DEADBAND_SD} 倍視為持平）。`,
    rule.words
  )
}
