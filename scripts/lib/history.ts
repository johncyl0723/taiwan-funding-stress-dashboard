import { eventFlags } from './calendar.js'
import { classify, compositeScore, smooth5 } from './composite.js'
import { annualisedVolatility, bp, bpDiff, computeStats, rollingStdDev, rollingZScore, round } from './metrics.js'
import type { CompositeInputs, DailyObservation, HistoryPoint, PolicyRate } from '../../src/types.js'

/** 每日快照保留約一年的交易日；回測需要完整區間，可用 options 覆寫 */
const MAX_HISTORY = 260
const NCD_WINDOW = 5
const FOREIGN_WINDOW = 5
const VOL_WINDOW = 20
const TFSS_CHANGE_LAG = 5

/** 每日純量：合併新舊歷史時只需要這些欄位，不必保留完整天期曲線 */
interface Derived {
  date: string
  tfssBp: number | null
  taibir90Primary: number | null
  taibir90Secondary: number | null
  primarySecondaryBp: number | null
  taibirSlopeBp: number | null
  taibor3m: number | null
  taiborSlopeBp: number | null
  overnightRate: number | null
  corridorPosition: number | null
  ncdNetIssuance: number | null
  ncdOutstanding: number | null
  repoOperation: boolean
  foreignNet: number | null
  usdTwd: number | null
  sofr90: number | null
  fxNominalSpreadBp: number | null
}

const pick = (next: number | null | undefined, previous: number | null | undefined): number | null =>
  next ?? previous ?? null

const term = (curve: Record<string, number> | undefined, key: string): number | null =>
  curve && Number.isFinite(curve[key]) ? curve[key] : null

function policyRateAt(rates: PolicyRate[], date: string): PolicyRate | null {
  let match: PolicyRate | null = null
  for (const rate of rates) if (rate.effectiveFrom <= date) match = rate
  return match ?? rates[0] ?? null
}

/**
 * 走廊下限取 7 天期 NCD 申購發行利率、上限取重貼現率。
 * NCD 公告只回補約 12 個交易日，其餘日子以最近一筆已知利率前後填補 ——
 * 這個利率極少變動，用它換得整段歷史都能算出走廊位置。
 */
function buildFloorSeries(observations: DailyObservation[]): (number | null)[] {
  const raw = observations.map(observation => term(observation.ncdRates as Record<string, number>, '7'))
  const filled = [...raw]
  let last: number | null = null
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== null) last = filled[i]
    else filled[i] = last
  }
  last = null
  for (let i = filled.length - 1; i >= 0; i--) {
    if (filled[i] !== null) last = filled[i]
    else filled[i] = last
  }
  return filled
}

function derive(observations: DailyObservation[], policyRates: PolicyRate[]): Derived[] {
  const floors = buildFloorSeries(observations)
  return observations.map((observation, index) => {
    const primary = observation.taibirPrimary as Record<string, number>
    const secondary = observation.taibirSecondary as Record<string, number>
    const taibor = observation.taibor as Record<string, number>

    const p90 = term(primary, '90')
    const s90 = term(secondary, '90')
    const t3m = term(taibor, '3M')
    const t1w = term(taibor, '1W')
    const p30 = term(primary, '30')
    const p180 = term(primary, '180')

    const policy = policyRateAt(policyRates, observation.date)
    const floor = floors[index]
    const corridorPosition =
      observation.overnightRate !== null && floor !== null && policy && policy.rediscount > floor
        ? round((observation.overnightRate - floor) / (policy.rediscount - floor), 4)
        : null

    return {
      date: observation.date,
      // TFSS 只在同一交易日同時有 TAIBIR 初級與 TAIBOR 定盤時才成立
      tfssBp: p90 !== null && t3m !== null ? bp(p90 - t3m) : null,
      taibir90Primary: p90,
      taibir90Secondary: s90,
      primarySecondaryBp: p90 !== null && s90 !== null ? bp(p90 - s90) : null,
      taibirSlopeBp: p30 !== null && p180 !== null ? bp(p180 - p30) : null,
      taibor3m: t3m,
      taiborSlopeBp: t1w !== null && t3m !== null ? bp(t3m - t1w) : null,
      overnightRate: observation.overnightRate,
      corridorPosition,
      ncdNetIssuance: observation.ncdNetIssuance,
      ncdOutstanding: observation.ncdOutstanding,
      repoOperation: observation.repoOperation,
      foreignNet: observation.foreignNet,
      usdTwd: observation.usdTwd,
      sofr90: observation.sofr90,
      fxNominalSpreadBp:
        observation.sofr90 !== null && t3m !== null ? bp(observation.sofr90 - t3m) : null
    }
  })
}

/**
 * 合併既有歷史與本次抓到的區間資料。新抓到的值優先，欄位為空時沿用舊值 ——
 * NCD、外資只回補約 12 個交易日，若不沿用，更早的日子每次更新都會被清成 null。
 */
function merge(previous: HistoryPoint[], incoming: Derived[], maxHistory: number): Derived[] {
  const merged = new Map<string, Derived>()
  for (const point of previous) {
    merged.set(point.date, {
      date: point.date,
      tfssBp: point.tfssBp,
      taibir90Primary: point.taibir90Primary,
      taibir90Secondary: point.taibir90Secondary,
      primarySecondaryBp: point.primarySecondaryBp,
      taibirSlopeBp: point.taibirSlopeBp ?? null,
      taibor3m: point.taibor3m,
      taiborSlopeBp: point.taiborSlopeBp ?? null,
      overnightRate: point.overnightRate,
      corridorPosition: point.corridorPosition ?? null,
      ncdNetIssuance: point.ncdNetIssuance ?? null,
      ncdOutstanding: point.ncdOutstanding ?? null,
      repoOperation: point.repoOperation ?? false,
      foreignNet: point.foreignNet ?? null,
      usdTwd: point.usdTwd ?? null,
      sofr90: point.sofr90 ?? null,
      fxNominalSpreadBp: point.fxNominalSpreadBp ?? null
    })
  }
  for (const row of incoming) {
    const existing = merged.get(row.date)
    merged.set(row.date, {
      date: row.date,
      tfssBp: pick(row.tfssBp, existing?.tfssBp),
      taibir90Primary: pick(row.taibir90Primary, existing?.taibir90Primary),
      taibir90Secondary: pick(row.taibir90Secondary, existing?.taibir90Secondary),
      primarySecondaryBp: pick(row.primarySecondaryBp, existing?.primarySecondaryBp),
      taibirSlopeBp: pick(row.taibirSlopeBp, existing?.taibirSlopeBp),
      taibor3m: pick(row.taibor3m, existing?.taibor3m),
      taiborSlopeBp: pick(row.taiborSlopeBp, existing?.taiborSlopeBp),
      overnightRate: pick(row.overnightRate, existing?.overnightRate),
      corridorPosition: pick(row.corridorPosition, existing?.corridorPosition),
      ncdNetIssuance: pick(row.ncdNetIssuance, existing?.ncdNetIssuance),
      ncdOutstanding: pick(row.ncdOutstanding, existing?.ncdOutstanding),
      repoOperation: row.repoOperation || (existing?.repoOperation ?? false),
      foreignNet: pick(row.foreignNet, existing?.foreignNet),
      usdTwd: pick(row.usdTwd, existing?.usdTwd),
      sofr90: pick(row.sofr90, existing?.sofr90),
      fxNominalSpreadBp: pick(row.fxNominalSpreadBp, existing?.fxNominalSpreadBp)
    })
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-maxHistory)
}

/** 移動視窗合計，視窗內任一日缺值即回 null */
function windowSum(values: (number | null)[], index: number, size: number): number | null {
  const slice = values.slice(Math.max(0, index - size + 1), index + 1)
  if (slice.length < size || slice.some(value => value === null)) return null
  return (slice as number[]).reduce((sum, value) => sum + value, 0)
}

export function buildHistory(
  previous: HistoryPoint[],
  observations: DailyObservation[],
  policyRates: PolicyRate[],
  options: { maxHistory?: number } = {}
): HistoryPoint[] {
  const rows = merge(previous, derive(observations, policyRates), options.maxHistory ?? MAX_HISTORY)

  // 各子指標的累積序列，用於逐日計算 120 日 z-score
  const tfssSeries: number[] = []
  const spreadSeries: number[] = []
  const slopeSeries: number[] = []
  const corridorSeries: number[] = []
  const ncd5dSeries: number[] = []
  const compositeSeries: (number | null)[] = []

  const ncdDaily = rows.map(row => row.ncdNetIssuance)
  const foreignDaily = rows.map(row => row.foreignNet)

  return rows.map((row, index) => {
    if (row.tfssBp !== null) tfssSeries.push(row.tfssBp)
    if (row.primarySecondaryBp !== null) spreadSeries.push(row.primarySecondaryBp)
    if (row.taiborSlopeBp !== null) slopeSeries.push(row.taiborSlopeBp)
    if (row.corridorPosition !== null) corridorSeries.push(row.corridorPosition)

    const ncd5d = windowSum(ncdDaily, index, NCD_WINDOW)
    if (ncd5d !== null) ncd5dSeries.push(ncd5d)

    const compositeInputs: CompositeInputs = {
      tfss: row.tfssBp === null ? null : rollingZScore(tfssSeries),
      primarySecondary: row.primarySecondaryBp === null ? null : rollingZScore(spreadSeries),
      taiborSlope: row.taiborSlopeBp === null ? null : rollingZScore(slopeSeries),
      corridor: row.corridorPosition === null ? null : rollingZScore(corridorSeries),
      ncdNetIssuance: ncd5d === null ? null : rollingZScore(ncd5dSeries)
    }
    // 材料性檢定要看子指標自身的離散度，而不是合成後的 z-score
    const compositeDispersion = {
      tfss: rollingStdDev(tfssSeries),
      primarySecondary: rollingStdDev(spreadSeries),
      taiborSlope: rollingStdDev(slopeSeries),
      corridor: rollingStdDev(corridorSeries),
      ncdNetIssuance: rollingStdDev(ncd5dSeries)
    }
    const composite = compositeScore(compositeInputs, compositeDispersion)
    const compositeZ = composite.score
    compositeSeries.push(compositeZ)
    const compositeZ5d = smooth5(compositeSeries)

    const stats = computeStats(tfssSeries)
    const { status, guardApplied } = classify(compositeZ5d, {
      tfssBp: row.tfssBp,
      corridorPosition: row.corridorPosition,
      sample: tfssSeries.length
    }, composite.quietMarket)

    // 5 個「有效 TFSS 交易日」之前的讀數，缺漏日不算在內
    const previousTfss = row.tfssBp === null ? null : tfssSeries.at(-(TFSS_CHANGE_LAG + 1)) ?? null
    const volWindow = rows
      .slice(Math.max(0, index - VOL_WINDOW + 1), index + 1)
      .map(item => item.usdTwd)
      .filter((value): value is number => value !== null)

    return {
      date: row.date,
      status,
      eventFlags: eventFlags(row.date),
      tfssBp: row.tfssBp,
      tfssChange5dBp: row.tfssBp === null || previousTfss === null ? null : bpDiff(row.tfssBp, previousTfss),
      taibir90Primary: row.taibir90Primary,
      taibir90Secondary: row.taibir90Secondary,
      primarySecondaryBp: row.primarySecondaryBp,
      taibirSlopeBp: row.taibirSlopeBp,
      taibor3m: row.taibor3m,
      taiborSlopeBp: row.taiborSlopeBp,
      overnightRate: row.overnightRate,
      corridorPosition: row.corridorPosition,
      ncdNetIssuance: row.ncdNetIssuance,
      ncdNetIssuance5d: ncd5d,
      ncdOutstanding: row.ncdOutstanding,
      repoOperation: row.repoOperation,
      foreignNet: row.foreignNet,
      foreignNet5d: windowSum(foreignDaily, index, FOREIGN_WINDOW),
      usdTwd: row.usdTwd,
      usdTwdVol20: annualisedVolatility(volWindow),
      sofr90: row.sofr90,
      fxNominalSpreadBp: row.fxNominalSpreadBp,
      stats,
      compositeInputs,
      compositeDispersion,
      excludedInputs: composite.excluded,
      compositeZ,
      compositeZ5d,
      guardApplied
    }
  })
}
