import type { StressStats, WindowStats } from '../../src/types.js'

/** 樣本未滿完整窗格時，至少要有這麼多交易日才給暫定讀數 */
export const MIN_SAMPLE = 30
export const Z_WINDOW = 120

export function windowStats(values: number[], window: number): WindowStats {
  const sample = values.slice(-window)
  const full = sample.length >= window
  if (sample.length < Math.min(window, MIN_SAMPLE)) {
    return { percentile: null, zScore: null, sample: sample.length, full }
  }

  const current = sample.at(-1)!
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
  const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length
  const std = Math.sqrt(variance)

  // 中位排名法：平盤序列不會被誤判成 100 百分位
  const below = sample.filter(value => value < current).length
  const equal = sample.filter(value => value === current).length
  const percentile = (below + equal / 2) / sample.length * 100

  return { percentile, zScore: std === 0 ? 0 : (current - mean) / std, sample: sample.length, full }
}

export function computeStats(values: number[]): StressStats {
  const sixty = windowStats(values, 60)
  const oneTwenty = windowStats(values, Z_WINDOW)
  return {
    percentile60: sixty.percentile,
    percentile120: oneTwenty.percentile,
    zScore60: sixty.zScore,
    zScore120: oneTwenty.zScore,
    sample60: sixty.sample,
    sample120: oneTwenty.sample,
    provisional: sixty.percentile !== null && !sixty.full
  }
}

/** 以 120 日窗格計算最後一筆的 z-score；樣本不足回傳 null */
export const rollingZScore = (values: number[]) => windowStats(values, Z_WINDOW).zScore

/** 120 日窗格的母體標準差，用於 composite 的材料性檢定；樣本不足回傳 null */
export function rollingStdDev(values: number[]): number | null {
  const sample = values.slice(-Z_WINDOW)
  if (sample.length < MIN_SAMPLE) return null
  const avg = sample.reduce((sum, value) => sum + value, 0) / sample.length
  return Math.sqrt(sample.reduce((sum, value) => sum + (value - avg) ** 2, 0) / sample.length)
}

export const bp = (rate: number) => Math.round(rate * 10000) / 100

/** 兩個已換算為 bp 的數值相減，避免再經過一次 *10000 的縮放 */
export const bpDiff = (current: number, previous: number) => Math.round((current - previous) * 100) / 100

export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 年化標準差（%），用於匯率波動度 */
export function annualisedVolatility(levels: number[]): number | null {
  if (levels.length < 3) return null
  const returns: number[] = []
  for (let i = 1; i < levels.length; i++) {
    if (levels[i - 1] > 0 && levels[i] > 0) returns.push(Math.log(levels[i] / levels[i - 1]))
  }
  if (returns.length < 2) return null
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (returns.length - 1)
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2)
}
