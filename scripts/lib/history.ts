import { bp, bpDiff, computeStats, stressStatus } from './metrics.js'
import type { DailyObservation, HistoryPoint } from '../../src/types.js'

/** 保留約一年的交易日 */
const MAX_HISTORY = 260
const NCD_WINDOW = 5
const TFSS_CHANGE_LAG = 5

type Raw = Pick<DailyObservation, 'date' | 'taibir90Primary' | 'taibir90Secondary' | 'taibor3m' | 'overnightRate' | 'ncdNetIssuance'>

const pick = (next: number | null | undefined, previous: number | null | undefined): number | null =>
  next ?? previous ?? null

/**
 * 合併既有歷史與本次抓到的區間資料。
 * 新抓到的值優先，但欄位為 null 時沿用舊值 —— NCD 只回補約 12 個交易日，
 * 若不沿用，更早的日子每次更新都會被清成 null。
 */
function mergeObservations(previous: HistoryPoint[], incoming: DailyObservation[]): Raw[] {
  const merged = new Map<string, Raw>()
  for (const point of previous) {
    merged.set(point.date, {
      date: point.date,
      taibir90Primary: point.taibir90Primary,
      taibir90Secondary: point.taibir90Secondary,
      taibor3m: point.taibor3m,
      overnightRate: point.overnightRate,
      ncdNetIssuance: point.ncdNetIssuance ?? null
    })
  }
  for (const observation of incoming) {
    const existing = merged.get(observation.date)
    merged.set(observation.date, {
      date: observation.date,
      taibir90Primary: pick(observation.taibir90Primary, existing?.taibir90Primary),
      taibir90Secondary: pick(observation.taibir90Secondary, existing?.taibir90Secondary),
      taibor3m: pick(observation.taibor3m, existing?.taibor3m),
      overnightRate: pick(observation.overnightRate, existing?.overnightRate),
      ncdNetIssuance: pick(observation.ncdNetIssuance, existing?.ncdNetIssuance)
    })
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_HISTORY)
}

export function buildHistory(previous: HistoryPoint[], incoming: DailyObservation[]): HistoryPoint[] {
  const rows = mergeObservations(previous, incoming)

  // TFSS 只在同一交易日同時有 TAIBIR 初級與 TAIBOR 定盤時才成立
  const tfss = rows.map(row =>
    row.taibir90Primary !== null && row.taibor3m !== null ? bp(row.taibir90Primary - row.taibor3m) : null
  )
  const observed: number[] = []

  return rows.map((row, index) => {
    const value = tfss[index]
    if (value !== null) observed.push(value)

    // 5 個「有效 TFSS 交易日」之前的讀數，缺漏日不算在內
    const previousValue = value === null ? null : observed.at(-(TFSS_CHANGE_LAG + 1)) ?? null
    const stats = computeStats(observed)

    const ncdWindow = rows.slice(Math.max(0, index - NCD_WINDOW + 1), index + 1).map(item => item.ncdNetIssuance)
    const ncdComplete = ncdWindow.length === NCD_WINDOW && ncdWindow.every(item => item !== null)

    return {
      date: row.date,
      status: value === null ? 'unavailable' : stressStatus(stats),
      tfssBp: value,
      tfssChange5dBp: value === null || previousValue === null ? null : bpDiff(value, previousValue),
      taibir90Primary: row.taibir90Primary,
      taibir90Secondary: row.taibir90Secondary,
      primarySecondaryBp:
        row.taibir90Primary !== null && row.taibir90Secondary !== null
          ? bp(row.taibir90Primary - row.taibir90Secondary)
          : null,
      taibor3m: row.taibor3m,
      overnightRate: row.overnightRate,
      ncdNetIssuance: row.ncdNetIssuance,
      ncdNetIssuance5d: ncdComplete ? (ncdWindow as number[]).reduce((sum, item) => sum + item, 0) : null,
      stats
    }
  })
}
