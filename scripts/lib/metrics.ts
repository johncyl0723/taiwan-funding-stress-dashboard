import type { Status, StressStats } from '../../src/types.js'

/** 樣本未滿完整窗格時，至少要有這麼多交易日才給暫定燈號 */
export const MIN_SAMPLE = 30

interface WindowStats {
  percentile: number | null
  zScore: number | null
  sample: number
  full: boolean
}

function calculateWindow(values: number[], window: number): WindowStats {
  const sample = values.slice(-window)
  const full = sample.length >= window
  if (sample.length < Math.min(window, MIN_SAMPLE)) return { percentile: null, zScore: null, sample: sample.length, full }

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
  const sixty = calculateWindow(values, 60)
  const oneTwenty = calculateWindow(values, 120)
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

export function stressStatus(stats: StressStats): Status {
  // 優先用 120 日窗格；樣本不足時退回 60 日，兩者皆不足才判定為 unavailable
  const percentile = stats.sample120 >= 120 ? stats.percentile120 : stats.percentile60 ?? stats.percentile120
  if (percentile === null) return 'unavailable'
  if (percentile > 95) return 'stress'
  if (percentile > 85) return 'tight'
  if (percentile >= 60) return 'tightening'
  return 'normal'
}

export const bp = (rate: number) => Math.round(rate * 10000) / 100

/** 兩個已換算為 bp 的數值相減，避免再經過一次 *10000 的縮放 */
export const bpDiff = (current: number, previous: number) => Math.round((current - previous) * 100) / 100
