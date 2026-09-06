import { describe, expect, it } from 'vitest'
import { buildHistory } from './history'
import type { DailyObservation, HistoryPoint, PolicyRate } from '../../src/types'

const POLICY: PolicyRate[] = [
  { effectiveFrom: '2024-03-22', rediscount: 2, securedAccommodation: 2.375, shortTermAccommodation: 4.25 }
]

const observation = (date: string, overrides: Partial<DailyObservation> = {}): DailyObservation => ({
  date,
  taibirPrimary: { '30': 1.965, '90': 2.0943, '180': 2.3 },
  taibirSecondary: { '90': 1.8515 },
  taibor: { '1W': 1.38278, '3M': 1.68322 },
  overnightRate: 0.822,
  ncdNetIssuance: 1000,
  ncdOutstanding: 6_595_270,
  ncdRates: { '7': 0.825 },
  repoOperation: false,
  foreignNet: 500,
  usdTwd: 31.63,
  sofr30: 3.64,
  sofr90: 3.646,
  sofr180: 3.659,
  ...overrides
})

const build = (rows: DailyObservation[], previous: HistoryPoint[] = []) =>
  buildHistory(previous, rows, POLICY)

describe('history assembly', () => {
  it('computes TFSS only when both legs settled on the same day', () => {
    const history = build([
      observation('2026-09-03'),
      observation('2026-09-04', { taibor: {} })
    ])
    expect(history[0].tfssBp).toBe(41.11)
    expect(history[1].tfssBp).toBeNull()
  })

  it('derives both curve slopes from the same source tables', () => {
    const [point] = build([observation('2026-09-04')])
    // TAIBOR 3M − 1W
    expect(point.taiborSlopeBp).toBe(30.04)
    // TAIBIR 180D − 30D
    expect(point.taibirSlopeBp).toBe(33.5)
  })

  it('places the overnight rate inside the policy corridor', () => {
    const [point] = build([observation('2026-09-04')])
    // (0.822 − 0.825) / (2.0 − 0.825) ≈ −0.0026，隔拆略低於 7 天期 NCD 利率
    expect(point.corridorPosition).toBeCloseTo(-0.0026, 4)
  })

  it('carries the NCD floor across days the announcement did not cover', () => {
    const history = build([
      observation('2026-09-01', { ncdRates: {} }),
      observation('2026-09-02', { ncdRates: { '7': 0.825 } }),
      observation('2026-09-03', { ncdRates: {} })
    ])
    expect(history.every(point => point.corridorPosition !== null)).toBe(true)
  })

  it('measures the 5-day change against the fifth previous valid trading day', () => {
    const rates = [1.6, 1.61, 1.62, 1.63, 1.64, 1.65, 1.7]
    const history = build(rates.map((rate, index) =>
      observation(`2026-09-0${index + 1}`, { taibor: { '1W': 1.38278, '3M': rate } })
    ))
    // (2.0943−1.7) − (2.0943−1.61) = −9 bp
    expect(history.at(-1)!.tfssChange5dBp).toBe(-9)
  })

  it('sums NCD and foreign flows over five days only when every day is present', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']
    const complete = build(dates.map(date => observation(date)))
    expect(complete.at(-1)!.ncdNetIssuance5d).toBe(5000)
    expect(complete.at(-1)!.foreignNet5d).toBe(2500)

    const withGap = build(dates.map((date, index) =>
      observation(date, index === 2 ? { ncdNetIssuance: null } : {})
    ))
    expect(withGap.at(-1)!.ncdNetIssuance5d).toBeNull()
  })

  it('keeps older values that fall outside the fetch window', () => {
    const previous = build([observation('2026-09-01')])
    const refreshed = build([
      observation('2026-09-01', { ncdNetIssuance: null, foreignNet: null }),
      observation('2026-09-02')
    ], previous)
    expect(refreshed[0].ncdNetIssuance).toBe(1000)
    expect(refreshed[0].foreignNet).toBe(500)
  })

  it('does not duplicate a date that is refetched', () => {
    const previous = build([observation('2026-09-01'), observation('2026-09-02')])
    const refreshed = build([observation('2026-09-02'), observation('2026-09-03')], previous)
    expect(refreshed.map(point => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })

  it('withholds a composite score until enough sub-indicators have a full window', () => {
    const [point] = build([observation('2026-09-04')])
    expect(point.compositeZ).toBeNull()
    expect(point.status).toBe('unavailable')
  })

  it('produces a composite score once the windows fill, and tags event flags', () => {
    // 40 個交易日、TFSS 逐日走高，最後一日應落在高檔
    const rows = Array.from({ length: 40 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 4, 4) + index * 86_400_000).toISOString().slice(0, 10)
      return observation(day, { taibor: { '1W': 1.38, '3M': 1.7 - index * 0.002 } })
    })
    const history = build(rows)
    const last = history.at(-1)!
    expect(last.compositeZ).not.toBeNull()
    expect(last.compositeZ5d).not.toBeNull()
    // 5 月落在綜所稅期
    expect(history[0].eventFlags).toContain('綜所稅期')
  })

  it('flags a repo operation and keeps it through a later merge', () => {
    const previous = build([observation('2026-09-01', { repoOperation: true })])
    const refreshed = build([observation('2026-09-01')], previous)
    expect(refreshed[0].repoOperation).toBe(true)
  })
})
