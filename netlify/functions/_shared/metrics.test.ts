import { describe, expect, it } from 'vitest'
import { bp, computeStats, stressStatus } from './metrics'

describe('funding stress metrics', () => {
  it('calculates basis points accurately', () => {
    expect(bp(2.091 - 1.683)).toBe(40.8)
  })

  it('does not produce unstable statistics before a full window', () => {
    const stats = computeStats(Array.from({ length: 59 }, (_, index) => index))
    expect(stats.percentile60).toBeNull()
    expect(stats.sample60).toBe(59)
    expect(stressStatus(stats)).toBe('unavailable')
  })

  it('labels the latest observation from a complete 60-day window', () => {
    const stats = computeStats([...Array.from({ length: 59 }, () => 1), 2])
    expect(stats.percentile60).toBe(100)
    expect(stressStatus(stats)).toBe('stress')
  })
})
