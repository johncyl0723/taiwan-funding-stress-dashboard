export type Status = 'normal' | 'tightening' | 'tight' | 'stress' | 'unavailable'

export interface SourceRef {
  label: string
  url: string
  asOf: string
}

export interface StressStats {
  percentile60: number | null
  percentile120: number | null
  zScore60: number | null
  zScore120: number | null
  sample60: number
  sample120: number
  /** true 代表樣本未滿完整窗格，僅以最低樣本數（30 個交易日）暫定計算 */
  provisional: boolean
}

export interface MarketSnapshot {
  date: string
  updatedAt: string
  status: Status
  tfssBp: number | null
  tfssChange5dBp: number | null
  taibir90Primary: number | null
  taibir90Secondary: number | null
  primarySecondaryBp: number | null
  taibor3m: number | null
  overnightRate: number | null
  /** 當日央行 NCD 淨發行（百萬元，正值＝淨吸收流動性） */
  ncdNetIssuance: number | null
  /** 近 5 個交易日 NCD 淨發行合計（百萬元） */
  ncdNetIssuance5d: number | null
  stats: StressStats
  sourceStatus: Record<string, string>
  sources: SourceRef[]
}

/** history.json 的單筆紀錄：與快照同結構，但省略每日重複的來源清單 */
export type HistoryPoint = Omit<MarketSnapshot, 'sources' | 'sourceStatus' | 'updatedAt'>

export interface Insight {
  marketState: string
  pressureSource: string
  policyObservation: string
  researchView: string
  risksAndLimits: string[]
  generatedAt: string
}

export interface BankQuarterlyMetric {
  bank: string
  isIrb: boolean
  period: string
  lcr: number | null
  cet1: number | null
  car: number | null
  loanGrowth: number | null
  depositGrowth: number | null
  sourceUrl: string
}

export interface DashboardPayload {
  market: MarketSnapshot
  insight: Insight | null
  /** 尚未接上自動抓取，目前恆為空陣列（見 README「尚未實作」） */
  bankMetrics: BankQuarterlyMetric[]
}

/** 單一交易日的原始觀測值，任一欄位可能因來源缺漏而為 null */
export interface DailyObservation {
  date: string
  taibir90Primary: number | null
  taibir90Secondary: number | null
  taibor3m: number | null
  overnightRate: number | null
  ncdNetIssuance: number | null
}

export interface MarketFetchResult {
  /** 依日期遞增排序 */
  observations: DailyObservation[]
  sources: SourceRef[]
  sourceStatus: Record<string, string>
}
