import { generateInsight } from './ai'
import { bp, computeStats, stressStatus } from './metrics'
import { fetchMarketSources } from './sources'
import { getBankMetrics, getHistory, saveDashboard, saveHistory, saveRaw, setRefreshLog } from './storage'
import type { DashboardPayload, MarketSnapshot } from './types'

export async function refreshDashboard(trigger: 'manual' | 'scheduled'): Promise<void> {
  const startedAt = new Date().toISOString()
  try {
    const raw = await fetchMarketSources()
    const previous = await getHistory()
    const withoutSameDate = previous.filter(item => item.date !== raw.date)
    const provisionalTfss = bp(raw.taibir90Primary - raw.taibor3m)
    const values = [...withoutSameDate, { tfssBp: provisionalTfss }].map(item => item.tfssBp).filter((value): value is number => value !== null)
    const stats = computeStats(values)
    const fiveBack = withoutSameDate.at(-5)?.tfssBp ?? null
    const recentNcd = [...withoutSameDate.slice(-4).map(item => item.ncdNetIssuance5d ?? 0), raw.ncdNetIssuance]
    const market: MarketSnapshot = {
      date: raw.date, updatedAt: new Date().toISOString(), status: stressStatus(stats), tfssBp: provisionalTfss,
      tfssChange5dBp: fiveBack === null ? null : bp(provisionalTfss / 100 - fiveBack / 100), taibir90Primary: raw.taibir90Primary,
      taibir90Secondary: raw.taibir90Secondary, primarySecondaryBp: bp(raw.taibir90Primary - raw.taibir90Secondary), taibor3m: raw.taibor3m,
      overnightRate: raw.overnightRate, ncdNetIssuance5d: recentNcd.length === 5 ? recentNcd.reduce((sum, value) => sum + value, 0) : null,
      stats, sourceStatus: raw.sourceStatus, sources: raw.sources
    }
    const insight = await generateInsight(market)
    const bankMetrics = await getBankMetrics()
    const payload: DashboardPayload = { market, insight, bankMetrics }
    await saveRaw(raw.date, raw.raw)
    await saveHistory([...withoutSameDate, market])
    await saveDashboard(payload)
    await setRefreshLog({ trigger, startedAt, completedAt: new Date().toISOString(), outcome: 'success', date: raw.date })
  } catch (error) {
    await setRefreshLog({ trigger, startedAt, completedAt: new Date().toISOString(), outcome: 'failed', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
