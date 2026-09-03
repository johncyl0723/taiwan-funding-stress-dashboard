import type { DashboardPayload } from './types'

// Benchmark transcribed from the user-provided research note. It is visibly marked
// as seed data and is replaced after the first valid production refresh.
export const seedDashboard: DashboardPayload = {
  isSeedData: true,
  market: {
    date: '2026-09-02', updatedAt: '2026-09-03T00:00:00.000Z', status: 'unavailable',
    tfssBp: 40.8, tfssChange5dBp: null, taibir90Primary: 2.091, taibir90Secondary: 1.8482,
    primarySecondaryBp: 24.28, taibor3m: 1.683, overnightRate: 0.823, ncdNetIssuance5d: 152950,
    stats: { percentile60: null, percentile120: null, zScore60: null, zScore120: null, sample60: 1, sample120: 1 },
    sourceStatus: { seed: '初始基準值；待官方來源首次成功更新後取代。' },
    sources: [
      { label: 'TDCC TAIBIR', url: 'https://www.tdcc.com.tw/portal/zh/tcWeb/tc_05sat_main03_3', asOf: '2026-09-02' },
      { label: '銀行公會 TAIBOR', url: 'https://www.ba.org.tw/taiborDaily/index', asOf: '2026-08-28' },
      { label: '中央銀行 O/N 隔拆', url: 'https://www.cbc.gov.tw/tw/lp-641-1.html', asOf: '2026-09-01' }
    ]
  },
  insight: {
    marketState: '偏緊，但邊際改善（初始研究基準）',
    indicatorInterpretations: [], pressureSource: '隔夜拆款穩定，但 1–3 個月企業與票券資金成本仍偏高。',
    policyObservation: '目前較接近 balance-sheet funding 偏緊，而非系統性錢荒。', researchView: '等待同日官方資料更新後，產生正式的當日研究觀點。',
    risksAndLimits: ['這是初始基準，不是即時定盤資料。', '公開資料可能有發布與擷取延遲。'], generatedAt: '2026-09-03T00:00:00.000Z', isFallback: true
  }, bankMetrics: []
}
