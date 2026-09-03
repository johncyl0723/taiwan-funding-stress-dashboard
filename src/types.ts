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
  ncdNetIssuance5d: number | null
  stats: StressStats
  sourceStatus: Record<string, string>
  sources: SourceRef[]
}

export interface AiInsight {
  marketState: string
  indicatorInterpretations: Array<{ indicator: string; interpretation: string }>
  pressureSource: string
  policyObservation: string
  researchView: string
  risksAndLimits: string[]
  generatedAt: string
  isFallback?: boolean
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
  insight: AiInsight | null
  bankMetrics: BankQuarterlyMetric[]
  isSeedData?: boolean
}
