export type Status = 'normal' | 'tightening' | 'tight' | 'stress' | 'unavailable'

export interface SourceRef {
  label: string
  url: string
  asOf: string
}

/** 單一滾動窗格的統計量 */
export interface WindowStats {
  percentile: number | null
  zScore: number | null
  sample: number
  full: boolean
}

export interface StressStats {
  percentile60: number | null
  percentile120: number | null
  zScore60: number | null
  zScore120: number | null
  sample60: number
  sample120: number
  /** true 代表樣本未滿完整窗格，僅以最低樣本數暫定計算 */
  provisional: boolean
}

/** composite 燈號的五個輸入，各自的 120 日 z-score */
export interface CompositeInputs {
  tfss: number | null
  primarySecondary: number | null
  taiborSlope: number | null
  corridor: number | null
  ncdNetIssuance: number | null
}

export type EventFlag =
  | '綜所稅期'
  | '營所稅暫繳'
  | '除息旺季'
  | '季底'
  | '年底'
  | '農曆年前'
  | '理監事會前後'

/** TAIBIR 天期（日）；TAIBOR 天期以字串鍵表示 */
export const TAIBIR_TERMS = [10, 20, 30, 60, 90, 120, 150, 180, 365] as const
export const TAIBOR_TERMS = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y'] as const
export type TaibirTerm = (typeof TAIBIR_TERMS)[number]
export type TaiborTerm = (typeof TAIBOR_TERMS)[number]

export type TermCurve = Partial<Record<string, number>>

/** 每日原始觀測；任一欄位可能因來源缺漏而不存在 */
export interface DailyObservation {
  date: string
  taibirPrimary: TermCurve
  taibirSecondary: TermCurve
  taibor: TermCurve
  overnightRate: number | null
  /** 當日 NCD 淨發行（百萬元，正值＝淨吸收） */
  ncdNetIssuance: number | null
  /** NCD 未到期餘額（百萬元） */
  ncdOutstanding: number | null
  /** 當日各天期 NCD 發行利率，7 天期作為走廊下限 */
  ncdRates: TermCurve
  /** 公告中出現附買回／附賣回操作 */
  repoOperation: boolean
  /** 外資及陸資買賣超（百萬元，正值＝淨買超） */
  foreignNet: number | null
  usdTwd: number | null
  sofr30: number | null
  sofr90: number | null
  sofr180: number | null
}

/** 央行貼放利率，理監事會決議時才變動 */
export interface PolicyRate {
  effectiveFrom: string
  rediscount: number
  securedAccommodation: number
  shortTermAccommodation: number
}

/** 每日衍生指標與判讀 */
export interface HistoryPoint {
  date: string
  status: Status
  eventFlags: EventFlag[]

  // 價格層
  tfssBp: number | null
  tfssChange5dBp: number | null
  taibir90Primary: number | null
  taibir90Secondary: number | null
  primarySecondaryBp: number | null
  /** TAIBIR 180D − 30D，票券期限溢酬 */
  taibirSlopeBp: number | null
  taibor3m: number | null
  /** TAIBOR 3M − 1W，銀行間對未來鬆緊的預期 */
  taiborSlopeBp: number | null
  overnightRate: number | null
  /** O/N 在走廊中的位置，0＝貼著下限、1＝觸及重貼現率 */
  corridorPosition: number | null

  // 數量層
  ncdNetIssuance: number | null
  ncdNetIssuance5d: number | null
  ncdOutstanding: number | null
  repoOperation: boolean
  foreignNet: number | null
  foreignNet5d: number | null

  // 外幣通道
  usdTwd: number | null
  /** USD/TWD 20 日年化波動率（%） */
  usdTwdVol20: number | null
  sofr90: number | null
  /** SOFR 90 日均 − 3M TAIBOR，名目利差（bp） */
  fxNominalSpreadBp: number | null

  // 合成
  stats: StressStats
  compositeInputs: CompositeInputs
  /** 各子指標的 120 日標準差，用於材料性檢定 */
  compositeDispersion: Partial<Record<keyof CompositeInputs, number | null>>
  /** 未納入合成的子指標與原因 */
  excludedInputs: { key: keyof CompositeInputs; reason: string }[]
  compositeZ: number | null
  compositeZ5d: number | null
  /** guard 觸發時記錄原因 */
  guardApplied: string | null
}

export interface Insight {
  marketState: string
  pressureSource: string
  policyObservation: string
  researchView: string
  fxView: string
  risksAndLimits: string[]
  generatedAt: string
}

/** 月頻背景指標，單位依 series 而定 */
export interface MonthlySeries {
  key: string
  label: string
  unit: string
  hint: string
  sourceUrl: string
  points: { period: string; value: number }[]
}

/** 週頻票券市場數量 */
export interface WeeklyBillPoint {
  week: string
  primaryIssue: number
  primaryRedeem: number
  secondaryOutright: number
  secondaryRepo: number
}

/** 364 天期 NCD 標售結果 */
export interface NcdAuction {
  date: string
  issueAmount: number
  bidAmount: number
  bidToCover: number
  awardRate: number
}

export interface BackgroundPayload {
  monthly: MonthlySeries[]
  weeklyBills: WeeklyBillPoint[]
  ncdAuctions: NcdAuction[]
  updatedAt: string
  sources: SourceRef[]
}

export interface DashboardPayload {
  market: HistoryPoint & {
    updatedAt: string
    sources: SourceRef[]
    sourceStatus: Record<string, string>
    policyRate: PolicyRate | null
  }
  insight: Insight | null
}

export interface MarketFetchResult {
  observations: DailyObservation[]
  policyRate: PolicyRate | null
  sources: SourceRef[]
  sourceStatus: Record<string, string>
}
