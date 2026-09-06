import type { Insight, MarketSnapshot, Status } from '../../src/types.js'

const STATUS_TEXT: Record<Status, { marketState: string; pressureSource: string; policyObservation: string }> = {
  normal: {
    marketState: '資金面正常，TFSS 落在近期常態區間。',
    pressureSource: '短端與 1–3 個月資金成本皆未見明顯壓力。',
    policyObservation: '央行公開市場操作維持例行步調，無需額外關注。'
  },
  tightening: {
    marketState: '資金面轉緊，TFSS 站上近期偏高區間（60–85 百分位）。',
    pressureSource: '1–3 個月企業資金成本相對隔夜利率走升，供給端出現初步壓力。',
    policyObservation: '建議留意後續 NCD 發行量與初級/次級利差是否持續擴大。'
  },
  tight: {
    marketState: '資金面明顯緊俏，TFSS 落在近期高檔區間（85–95 百分位）。',
    pressureSource: '中期資金供給吃緊，初級市場定價明顯高於次級市場。',
    policyObservation: '若持續數日未收斂，需留意央行是否調整 NCD 發行或附買回操作節奏。'
  },
  stress: {
    marketState: '資金面出現異常壓力，TFSS 位於近期極端高檔（95 百分位以上）。',
    pressureSource: '短中期資金供需明顯失衡，非單日雜訊可解釋。',
    policyObservation: '建議對照央行操作與銀行間拆款動態，確認是否為系統性事件。'
  },
  unavailable: {
    marketState: '樣本數尚不足以判斷資金面狀態。',
    pressureSource: '統計窗格（60/120 日）尚未累積足夠交易日資料。',
    policyObservation: '待資料持續累積後，燈號判讀將趨於穩定。'
  }
}

function trendLine(change: number | null): string {
  if (change === null) return '5 日變化尚無足夠資料比較。'
  if (change > 0) return `TFSS 較 5 日前擴大 ${change.toFixed(1)} bp，壓力持續累積。`
  if (change < 0) return `TFSS 較 5 日前收斂 ${Math.abs(change).toFixed(1)} bp，壓力略為緩解。`
  return 'TFSS 與 5 日前持平。'
}

export function buildInsight(market: MarketSnapshot): Insight {
  const base = STATUS_TEXT[market.status]
  return {
    marketState: base.marketState,
    pressureSource: base.pressureSource,
    policyObservation: base.policyObservation,
    researchView: `${trendLine(market.tfssChange5dBp)}本觀點為規則式模板依 TFSS 百分位與 5 日變化自動產生，僅供公開市場研究參考。`,
    risksAndLimits: [
      '本摘要為規則式模板文字，非 AI 或人工分析生成。',
      '公開資料可能有發布與擷取延遲，指標判讀不構成投資、融資或交易建議。'
    ],
    generatedAt: new Date().toISOString()
  }
}
