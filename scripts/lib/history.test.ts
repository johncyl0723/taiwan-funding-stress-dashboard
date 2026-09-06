import { describe, expect, it } from 'vitest'
import { buildHistory } from './history'
import type { DailyObservation, HistoryPoint } from '../../src/types'

const observation = (date: string, overrides: Partial<DailyObservation> = {}): DailyObservation => ({
  date,
  taibir90Primary: 2.0943,
  taibir90Secondary: 1.8515,
  taibor3m: 1.68322,
  overnightRate: 0.822,
  ncdNetIssuance: 1000,
  ...overrides
})

describe('history assembly', () => {
  it('computes TFSS only when both legs settled on the same day', () => {
    const history = buildHistory([], [
      observation('2026-09-03'),
      observation('2026-09-04', { taibor3m: null })
    ])
    expect(history[0].tfssBp).toBe(41.11)
    expect(history[1].tfssBp).toBeNull()
    expect(history[1].status).toBe('unavailable')
  })

  it('measures the 5-day change against the fifth previous valid trading day', () => {
    const values = [1.6, 1.61, 1.62, 1.63, 1.64, 1.65, 1.7]
    const history = buildHistory([], values.map((taibor3m, index) =>
      observation(`2026-09-0${index + 1}`, { taibor3m })
    ))
    // 最後一天相對第 2 天（往前數 5 個有效交易日）：(2.0943-1.7) - (2.0943-1.61) = -9 bp
    expect(history.at(-1)!.tfssChange5dBp).toBe(-9)
  })

  it('sums NCD over five days only when every day is present', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
    const complete = buildHistory([], dates.map(date => observation(date)))
    expect(complete.at(-1)!.ncdNetIssuance5d).toBe(5000)
    expect(complete.at(-1)!.ncdNetIssuance).toBe(1000)

    const withGap = buildHistory([], dates.map((date, index) =>
      observation(date, index === 2 ? { ncdNetIssuance: null } : {})
    ))
    expect(withGap.at(-1)!.ncdNetIssuance5d).toBeNull()
  })

  it('keeps older NCD values that fall outside the fetch window', () => {
    const previous = buildHistory([], [observation('2026-09-01')]) as HistoryPoint[]
    const refreshed = buildHistory(previous, [
      observation('2026-09-01', { ncdNetIssuance: null }),
      observation('2026-09-02')
    ])
    expect(refreshed[0].ncdNetIssuance).toBe(1000)
  })

  it('does not duplicate a date that is refetched', () => {
    const previous = buildHistory([], [observation('2026-09-01'), observation('2026-09-02')])
    const refreshed = buildHistory(previous, [observation('2026-09-02'), observation('2026-09-03')])
    expect(refreshed.map(point => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })
})
