import { describe, expect, it } from 'vitest'
import { bp, bpDiff, computeStats, stressStatus } from './metrics'

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
    expect(stressStatus(stats)).toBe('unavailable')
  })

  it('marks a partially filled window as provisional instead of withholding it for months', () => {
    const stats = computeStats(Array.from({ length: 45 }, (_, index) => index))
    expect(stats.percentile60).not.toBeNull()
    expect(stats.provisional).toBe(true)
    expect(stressStatus(stats)).toBe('stress')
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
    expect(stressStatus(stats)).toBe('normal')
  })

  it('prefers the 120-day window once it is complete', () => {
    // 前 60 日偏高、近 60 日偏低：兩個窗格會給出相反的判讀
    const values = [...Array.from({ length: 60 }, () => 80), ...Array.from({ length: 60 }, () => 10)]
    const stats = computeStats(values)
    expect(stats.percentile60).toBe(50)
    expect(stats.percentile120).toBe(25)
    expect(stressStatus(stats)).toBe('normal')
  })
})
