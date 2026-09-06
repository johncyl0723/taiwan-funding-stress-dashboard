import { describe, expect, it } from 'vitest'
import { classify, compositeScore, smooth5 } from './composite'
import { eventFlags, hasSeasonalFlag } from './calendar'

const inputs = (values: Partial<Record<string, number | null>> = {}) => ({
  tfss: 1, primarySecondary: 1, taiborSlope: 1, corridor: 1, ncdNetIssuance: 1, ...values
}) as Parameters<typeof compositeScore>[0]

const loose = { tfssBp: 60, corridorPosition: 0.8, sample: 200 }

/** 每項離散度都遠高於材料性門檻，代表五項全數納入 */
const material = { tfss: 3, primarySecondary: 3, taiborSlope: 3, corridor: 1, ncdNetIssuance: 90000 }

describe('composite score', () => {
  it('averages the available sub-indicators', () => {
    expect(compositeScore(inputs(), material).score).toBe(1)
    expect(compositeScore(inputs({ tfss: 2, ncdNetIssuance: 0 }), material).score).toBe(1)
  })

  it('refuses to publish a score built on fewer than two inputs', () => {
    const thin = compositeScore(inputs({ tfss: null, primarySecondary: null, taiborSlope: null, corridor: null }), material)
    expect(thin.score).toBeNull()
    expect(compositeScore(inputs({ tfss: null, primarySecondary: null, taiborSlope: null }), material).score).not.toBeNull()
  })

  it('drops a sub-indicator whose 120-day dispersion is economically trivial', () => {
    // 實測值：TAIBOR 斜率 120 日標準差僅 0.08 bp，2σ 只等於 0.16 bp 的擺動
    const result = compositeScore(inputs({ taiborSlope: 3 }), { ...material, taiborSlope: 0.08 })
    expect(result.score).toBe(1)
    expect(result.excluded.map(entry => entry.key)).toContain('taiborSlope')
    expect(result.excluded.find(entry => entry.key === 'taiborSlope')!.reason).toContain('材料性門檻')
  })

  it('reports sample-starved inputs separately from immaterial ones', () => {
    const result = compositeScore(inputs({ ncdNetIssuance: null }), { ...material, corridor: 0.001 })
    expect(result.excluded.find(entry => entry.key === 'ncdNetIssuance')!.reason).toContain('樣本不足')
    expect(result.excluded.find(entry => entry.key === 'corridor')!.reason).toContain('材料性門檻')
  })

  it('keeps every input when dispersion is unknown', () => {
    expect(compositeScore(inputs()).score).toBe(1)
  })

  it('reports a flat-but-complete market as quiet rather than data-starved', () => {
    const flat = { tfss: 0.01, primarySecondary: 0.02, taiborSlope: 0.01, corridor: 0.0001, ncdNetIssuance: 10 }
    const result = compositeScore(inputs(), flat)
    expect(result.score).toBeNull()
    expect(result.quietMarket).toBe(true)
  })

  it('does not call a sample-starved day quiet', () => {
    const result = compositeScore(
      inputs({ tfss: null, primarySecondary: null, taiborSlope: null, corridor: null, ncdNetIssuance: null }),
      material
    )
    expect(result.quietMarket).toBe(false)
  })

  it('smooths over five days but not over a mostly empty window', () => {
    expect(smooth5([1, 1, 1, 1, 2])).toBe(1.2)
    expect(smooth5([null, null, 1, 1])).toBeNull()
  })
})

describe('status classification', () => {
  it('maps the smoothed score onto the four light levels', () => {
    expect(classify(0.4, loose).status).toBe('normal')
    expect(classify(1.2, loose).status).toBe('tightening')
    expect(classify(1.7, loose).status).toBe('tight')
    expect(classify(2.4, loose).status).toBe('stress')
  })

  it('gives no light until the sample is long enough', () => {
    expect(classify(2.5, { ...loose, sample: 10 }).status).toBe('unavailable')
    expect(classify(null, loose).status).toBe('unavailable')
  })

  it('calls a quiet market normal, not unavailable', () => {
    const quiet = classify(null, loose, true)
    expect(quiet.status).toBe('normal')
    expect(quiet.guardApplied).toContain('市場無明顯波動')
    // 樣本不足時即使 quietMarket 為 true 也不能給燈號
    expect(classify(null, { ...loose, sample: 10 }, true).status).toBe('unavailable')
  })

  it('caps the light when the absolute level is still low', () => {
    // 升息週期常見情境：z-score 高，但 TFSS 仍在低檔、O/N 貼著走廊下限
    const result = classify(2.4, { tfssBp: 22, corridorPosition: 0.05, sample: 200 })
    expect(result.status).toBe('tightening')
    expect(result.guardApplied).toContain('絕對水準 guard')
  })

  it('leaves the light alone when only one guard condition holds', () => {
    expect(classify(2.4, { tfssBp: 22, corridorPosition: 0.9, sample: 200 }).status).toBe('stress')
    expect(classify(2.4, { tfssBp: 60, corridorPosition: 0.05, sample: 200 }).status).toBe('stress')
  })
})

describe('event calendar', () => {
  it('flags the May and September tax windows', () => {
    expect(eventFlags('2026-05-15')).toContain('綜所稅期')
    expect(eventFlags('2026-09-15')).toContain('營所稅暫繳')
  })

  it('flags quarter-end and year-end', () => {
    expect(eventFlags('2026-06-29')).toContain('季底')
    expect(eventFlags('2026-06-10')).not.toContain('季底')
    expect(eventFlags('2026-12-24')).toContain('年底')
  })

  it('flags the fortnight before lunar new year from the table', () => {
    expect(eventFlags('2026-02-10')).toContain('農曆年前')
    expect(eventFlags('2026-03-10')).not.toContain('農曆年前')
  })

  it('flags the week around a known board meeting', () => {
    expect(eventFlags('2026-09-17')).toContain('理監事會前後')
    expect(eventFlags('2026-09-01')).not.toContain('理監事會前後')
  })

  it('separates seasonal flags from the policy-meeting flag', () => {
    expect(hasSeasonalFlag(['理監事會前後'])).toBe(false)
    expect(hasSeasonalFlag(['季底', '理監事會前後'])).toBe(true)
  })
})
