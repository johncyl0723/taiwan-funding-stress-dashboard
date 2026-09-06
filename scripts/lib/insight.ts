import type { Insight, MarketSnapshot, Status } from '../../src/types.js'

const STATUS_TEXT: Record<Status, { marketState: string; pressureSource: string; policyObservation: string }> = {
  normal: {
    marketState: '資金面正常，TFSS 落在近期常態區間。',
    pressureSource: '短端與 1–3 個月資金成本皆未見明顯壓力。',
    policyObservation: '央行公開市場操作維持例行步調，無需額外關注。'
  },
  tightening: {
    marketState: '資金面轉緊，TFSS 站上近期偏高區間（60–85 百分位）。',
    pressureSource: '1–3 個月企業資金成本相對銀行間報價走升，供給端出現初步壓力。',
    policyObservation: '建議留意後續 NCD 淨發行與初級／次級利差是否持續擴大。'
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
    pressureSource: '統計窗格尚未累積足夠交易日資料，或當日 TAIBIR 與 TAIBOR 未同步定盤。',
    policyObservation: '待資料持續累積後，燈號判讀將趨於穩定。'
  }
}

function trendLine(change: number | null): string {
  if (change === null) return '5 日變化尚無足夠資料比較。'
  if (change > 0) return `TFSS 較 5 個交易日前擴大 ${change.toFixed(1)} bp，壓力持續累積。`
  if (change < 0) return `TFSS 較 5 個交易日前收斂 ${Math.abs(change).toFixed(1)} bp，壓力略為緩解。`
  return 'TFSS 與 5 個交易日前持平。'
}

function spreadLine(market: MarketSnapshot): string {
  if (market.primarySecondaryBp === null) return '初級／次級利差當日無有效報價，供給壓力方向待確認。'
  return `90 天期初級較次級高 ${market.primarySecondaryBp.toFixed(1)} bp，反映新資金供給的相對定價壓力。`
}

function ncdLine(market: MarketSnapshot): string {
  if (market.ncdNetIssuance5d === null) return '央行近 5 個交易日 NCD 淨發行資料尚不完整。'
  const value = market.ncdNetIssuance5d
  const direction = value > 0 ? '淨吸收' : value < 0 ? '淨釋出' : '大致持平'
  return `央行近 5 個交易日 NCD ${direction} ${Math.abs(value).toLocaleString('zh-TW')} 百萬元。`
}

function sampleLine(market: MarketSnapshot): string {
  if (market.status === 'unavailable') return `目前僅累積 ${market.stats.sample60} 個有效交易日，尚未達判讀門檻。`
  if (market.stats.provisional) return `統計窗格尚未填滿（目前 ${market.stats.sample60} 個交易日），燈號為暫定值。`
  return ''
}

export function buildInsight(market: MarketSnapshot): Insight {
  const base = STATUS_TEXT[market.status]
  const sample = sampleLine(market)
  return {
    marketState: base.marketState,
    pressureSource: `${base.pressureSource}${spreadLine(market)}`,
    policyObservation: `${base.policyObservation}${ncdLine(market)}`,
    researchView: `${trendLine(market.tfssChange5dBp)}${sample}本觀點為規則式模板依 TFSS 百分位與 5 日變化自動產生，僅供公開市場研究參考。`,
    risksAndLimits: [
      '本摘要為規則式模板文字，非 AI 或人工分析生成。',
      'TFSS 以票券初級市場利率減銀行間定盤利率，價差同時含信用溢酬與流動性溢酬，非純粹的資金鬆緊指標。',
      '燈號為相對百分位，利率趨勢性走升期間可能同時推高分位，判讀需併看絕對水準與初級／次級利差。',
      '公開資料可能有發布與擷取延遲，指標判讀不構成投資、融資或交易建議。'
    ],
    generatedAt: new Date().toISOString()
  }
}
