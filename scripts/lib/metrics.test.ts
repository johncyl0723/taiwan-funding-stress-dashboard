import { describe, expect, it } from 'vitest'
import { annualisedVolatility, bp, bpDiff, computeStats, rollingZScore } from './metrics'

describe('funding stress metrics', () => {
  it('calculates basis points accurately', () => {
    expect(bp(2.091 - 1.683)).toBe(40.8)
  })

  it('subtracts two basis-point readings without rescaling them', () => {
    expect(bpDiff(41.11, 38.6)).toBe(2.51)
  })

  it('gives no reading at all below the minimum sample', () => {
    const stats = computeStats(Array.from({ length: 29 }, (_, index) => index))
    expect(stats.percentile60).toBeNull()
    expect(stats.sample60).toBe(29)
  })

  it('marks a partially filled window as provisional instead of withholding it for months', () => {
    const stats = computeStats(Array.from({ length: 45 }, (_, index) => index))
    expect(stats.percentile60).not.toBeNull()
    expect(stats.provisional).toBe(true)
  })

  it('stops flagging a full window as provisional', () => {
    const stats = computeStats(Array.from({ length: 60 }, (_, index) => index))
    expect(stats.sample60).toBe(60)
    expect(stats.provisional).toBe(false)
  })

  it('does not read a flat series as an extreme percentile', () => {
    const stats = computeStats(Array.from({ length: 60 }, () => 40))
    expect(stats.percentile60).toBe(50)
    expect(stats.zScore60).toBe(0)
  })

  it('scores the newest value against the trailing 120-day window', () => {
    const values = [...Array.from({ length: 119 }, () => 10), 20]
    const zScore = rollingZScore(values)
    expect(zScore).not.toBeNull()
    expect(zScore!).toBeGreaterThan(10)
  })

  it('returns no z-score until the minimum sample is reached', () => {
    expect(rollingZScore(Array.from({ length: 20 }, (_, index) => index))).toBeNull()
  })

  it('annualises exchange-rate volatility and ignores too-short windows', () => {
    expect(annualisedVolatility([31.5, 31.5])).toBeNull()
    const vol = annualisedVolatility([31.5, 31.6, 31.4, 31.7, 31.5, 31.8])
    expect(vol).not.toBeNull()
    expect(vol!).toBeGreaterThan(0)
  })
})
