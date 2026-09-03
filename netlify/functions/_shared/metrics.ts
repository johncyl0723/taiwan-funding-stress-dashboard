import type { Status, StressStats } from './types'

export function computeStats(values: number[]): StressStats {
  const calculate = (window: number) => {
    const sample = values.slice(-window)
    if (sample.length < window) return { percentile: null, zScore: null, sample: sample.length }
    const current = sample.at(-1)!
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
    const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length
    const std = Math.sqrt(variance)
    return { percentile: sample.filter(value => value <= current).length / sample.length * 100, zScore: std === 0 ? 0 : (current - mean) / std, sample: sample.length }
  }
  const sixty = calculate(60), oneTwenty = calculate(120)
  return { percentile60: sixty.percentile, percentile120: oneTwenty.percentile, zScore60: sixty.zScore, zScore120: oneTwenty.zScore, sample60: sixty.sample, sample120: oneTwenty.sample }
}

export function stressStatus(stats: StressStats): Status {
  const percentile = stats.percentile120 ?? stats.percentile60
  if (percentile === null) return 'unavailable'
  if (percentile > 95) return 'stress'
  if (percentile > 85) return 'tight'
  if (percentile >= 60) return 'tightening'
  return 'normal'
}

export const bp = (rate: number) => Math.round(rate * 10000) / 100
