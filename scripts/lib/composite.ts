import { MIN_SAMPLE, mean, round } from './metrics.js'
import type { CompositeInputs, Status } from '../../src/types.js'

/**
 * composite 燈號的門檻，以 5 日均 z-score 判定。
 * 初值為等權下的常態近似（約 84／93／98 百分位），
 * 待 scripts/backtest.ts 以歷史校準後再調整。
 */
export const THRESHOLDS = { tightening: 1.0, tight: 1.5, stress: 2.0 }

/** 五個輸入等權；未來若回測顯示某一項資訊量特別高，改這裡即可 */
export const WEIGHTS: Record<keyof CompositeInputs, number> = {
  tfss: 1,
  primarySecondary: 1,
  taiborSlope: 1,
  corridor: 1,
  ncdNetIssuance: 1
}

/**
 * 材料性門檻：子指標 120 日標準差低於此值就不進 composite。
 *
 * z-score 是尺度無關的，序列再平也能算出 2σ —— 台灣的 TAIBOR 報價極為僵固，
 * 實測 120 日標準差只有 0.08 bp，若照樣等權納入，0.2 bp 的擺動就會主導頭條燈號。
 * 門檻以各指標自身單位表示（bp、走廊比例、百萬元）。
 */
export const MATERIALITY: Record<keyof CompositeInputs, number> = {
  tfss: 0.25,
  primarySecondary: 0.25,
  taiborSlope: 0.25,
  corridor: 0.01,
  ncdNetIssuance: 5000
}

/** 至少要有這麼多個通過材料性檢定的子指標才給合成值 */
const MIN_INPUTS = 2

export type Dispersion = Partial<Record<keyof CompositeInputs, number | null>>

export interface CompositeResult {
  score: number | null
  /** 因樣本不足或未達材料性門檻而未納入的子指標 */
  excluded: { key: keyof CompositeInputs; reason: string }[]
  /**
   * true 代表資料是完整的，只是每個子指標的變異都低於材料性門檻。
   * 台灣的短率長期由央行主導、極為黏著，這種「市場真的很平靜」的狀態
   * 必須與「樣本不足」分開，否則會把安靜誤報成資料有問題。
   */
  quietMarket: boolean
}

const LABELS: Record<keyof CompositeInputs, string> = {
  tfss: 'TFSS',
  primarySecondary: '初次級利差',
  taiborSlope: 'TAIBOR 斜率',
  corridor: 'O/N 走廊位置',
  ncdNetIssuance: 'NCD 淨發行'
}

export function compositeScore(inputs: CompositeInputs, dispersion: Dispersion = {}): CompositeResult {
  const keys = Object.keys(WEIGHTS) as (keyof CompositeInputs)[]
  const excluded: CompositeResult['excluded'] = []
  const included: { weight: number; value: number }[] = []
  let immaterial = 0
  let available = 0

  for (const key of keys) {
    const value = inputs[key]
    if (value === null) {
      excluded.push({ key, reason: `${LABELS[key]}：樣本不足` })
      continue
    }
    available++
    const spread = dispersion[key]
    if (spread !== undefined && spread !== null && spread < MATERIALITY[key]) {
      immaterial++
      excluded.push({
        key,
        reason: `${LABELS[key]}：120 日標準差 ${spread < 0.01 ? spread.toExponential(1) : spread.toFixed(2)} 低於材料性門檻 ${MATERIALITY[key]}，變動幅度不具經濟意義`
      })
      continue
    }
    included.push({ weight: WEIGHTS[key], value })
  }

  // 有資料、但每一項都平到不具意義 → 市場平靜，而非資料不足
  const quietMarket = included.length < MIN_INPUTS && available > 0 && immaterial === available

  if (included.length < MIN_INPUTS) return { score: null, excluded, quietMarket }
  const totalWeight = included.reduce((sum, entry) => sum + entry.weight, 0)
  const score = included.reduce((sum, entry) => sum + entry.weight * entry.value, 0) / totalWeight
  return { score: round(score, 3), excluded, quietMarket: false }
}

export const smooth5 = (series: (number | null)[]): number | null => {
  const recent = series.slice(-5).filter((value): value is number => value !== null)
  const value = recent.length >= 3 ? mean(recent) : null
  return value === null ? null : round(value, 3)
}

export interface GuardContext {
  tfssBp: number | null
  corridorPosition: number | null
  sample: number
}

/**
 * 判讀修正器。
 *
 * ① 絕對水準 guard：純相對分位在升息週期會系統性誤報 —— TFSS 仍在低檔、
 *    O/N 仍貼著走廊下限時，不論 z-score 多高都最多給「開始偏緊」。
 * ② 5 日均值：燈號用 composite 的 5 日均判定，日值只顯示。
 * ③ 事件旗標在 insight 文字標註，不改變燈號（見 calendar.ts）。
 */
export function classify(
  score: number | null,
  guard: GuardContext,
  quietMarket = false
): { status: Status; guardApplied: string | null } {
  if (score === null) {
    return guard.sample >= MIN_SAMPLE && quietMarket
      ? { status: 'normal', guardApplied: '所有子指標的 120 日變異都低於材料性門檻，市場無明顯波動' }
      : { status: 'unavailable', guardApplied: null }
  }
  if (guard.sample < MIN_SAMPLE) return { status: 'unavailable', guardApplied: null }

  let status: Status = 'normal'
  if (score >= THRESHOLDS.stress) status = 'stress'
  else if (score >= THRESHOLDS.tight) status = 'tight'
  else if (score >= THRESHOLDS.tightening) status = 'tightening'

  const lowLevel = guard.tfssBp !== null && guard.tfssBp < 30
  const lowCorridor = guard.corridorPosition !== null && guard.corridorPosition < 0.5
  if (lowLevel && lowCorridor && (status === 'tight' || status === 'stress')) {
    return {
      status: 'tightening',
      guardApplied: `絕對水準 guard：TFSS ${guard.tfssBp!.toFixed(1)} bp 仍在低檔且 O/N 貼近走廊下限，燈號自 ${status === 'stress' ? '異常壓力' : '明顯緊俏'} 下修`
    }
  }
  return { status, guardApplied: null }
}
