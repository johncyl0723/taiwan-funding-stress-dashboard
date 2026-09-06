import { hasSeasonalFlag } from './calendar.js'
import type { CompositeInputs, HistoryPoint, Insight, Status } from '../../src/types.js'

const STATUS_TEXT: Record<Status, { marketState: string; pressureSource: string; policyObservation: string }> = {
  normal: {
    marketState: '資金面正常，綜合指標落在近期常態區間。',
    pressureSource: '短端與 1–3 個月資金成本皆未見明顯壓力。',
    policyObservation: '央行公開市場操作維持例行步調。'
  },
  tightening: {
    marketState: '資金面轉緊，綜合指標站上近一年偏高區間。',
    pressureSource: '1–3 個月企業資金成本相對銀行間報價走升，供給端出現初步壓力。',
    policyObservation: '留意後續 NCD 淨發行與初級／次級利差是否持續擴大。'
  },
  tight: {
    marketState: '資金面明顯緊俏，多項子指標同向走高。',
    pressureSource: '中期資金供給吃緊，初級市場定價明顯高於次級市場。',
    policyObservation: '若持續數日未收斂，留意央行是否調整 NCD 發行或附買回操作節奏。'
  },
  stress: {
    marketState: '資金面出現異常壓力，綜合指標位於極端高檔。',
    pressureSource: '短中期資金供需明顯失衡，非單日雜訊可解釋。',
    policyObservation: '對照央行操作與銀行間拆款動態，確認是否為系統性事件。'
  },
  unavailable: {
    marketState: '樣本數尚不足以判斷資金面狀態。',
    pressureSource: '統計窗格尚未累積足夠交易日，或當日核心指標未同步定盤。',
    policyObservation: '待資料持續累積後，燈號判讀將趨於穩定。'
  }
}

const fixed = (value: number | null, digits = 1, suffix = '') =>
  value === null ? '—' : `${value.toFixed(digits)}${suffix}`

function trendLine(change: number | null): string {
  if (change === null) return 'TFSS 的 5 日變化尚無足夠資料比較。'
  if (change > 0) return `TFSS 較 5 個交易日前擴大 ${change.toFixed(1)} bp。`
  if (change < 0) return `TFSS 較 5 個交易日前收斂 ${Math.abs(change).toFixed(1)} bp。`
  return 'TFSS 與 5 個交易日前持平。'
}

const INPUT_LABELS: Record<keyof CompositeInputs, string> = {
  tfss: 'TFSS',
  primarySecondary: '初次級利差',
  taiborSlope: 'TAIBOR 斜率',
  corridor: 'O/N 走廊位置',
  ncdNetIssuance: 'NCD 淨發行'
}

function compositeLine(market: HistoryPoint): string {
  if (market.compositeZ5d === null) return '綜合指標樣本不足，尚未給出合成讀數。'
  // 只描述真正進入合成的子指標；被排除者另外交代原因
  const dropped = new Set((market.excludedInputs ?? []).map(entry => entry.key))
  const included = (Object.keys(INPUT_LABELS) as (keyof CompositeInputs)[])
    .filter(key => !dropped.has(key))
    .map(key => [INPUT_LABELS[key], market.compositeInputs[key]] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)

  const top = [...included].sort((a, b) => b[1] - a[1]).slice(0, 2)
  const detail = top.length
    ? `貢獻最大的是 ${top.map(entry => `${entry[0]}（z ${entry[1].toFixed(2)}）`).join('、')}。`
    : ''
  const excluded = market.excludedInputs?.length
    ? `未納入：${market.excludedInputs.map(entry => entry.reason).join('；')}。`
    : ''
  return `綜合 z-score 5 日均 ${market.compositeZ5d.toFixed(2)}（當日 ${fixed(market.compositeZ, 2)}），由 ${included.length} 個子指標合成。${detail}${excluded}`
}

function seasonalLine(market: HistoryPoint): string {
  if (!market.eventFlags.length) return ''
  const label = market.eventFlags.join('、')
  return hasSeasonalFlag(market.eventFlags)
    ? `本日落在${label}，資金偏緊屬季節性常態，燈號不因此升級。`
    : `本日落在${label}，市場可能提前反映利率決議預期。`
}

function fxLine(market: HistoryPoint): string {
  if (market.sofr90 === null || market.taibor3m === null) {
    return '外幣通道資料不足，本日無法比較美元與台幣資金成本。'
  }
  const spread = market.fxNominalSpreadBp
  const vol = market.usdTwdVol20
  return [
    `SOFR 90 日均 ${market.sofr90.toFixed(3)}%，3M TAIBOR ${market.taibor3m.toFixed(3)}%，名目利差 ${fixed(spread, 1, ' bp')}。`,
    market.usdTwd === null ? '' : `USD/TWD ${market.usdTwd.toFixed(3)}${vol === null ? '' : `，20 日年化波動 ${vol.toFixed(1)}%`}。`,
    '名目利差不等於實際成本：避險後的隱含台幣利率要加上換匯點年化，該資料目前未接上，此處僅供方向參考。'
  ].filter(Boolean).join('')
}

export function buildInsight(market: HistoryPoint): Insight {
  const base = STATUS_TEXT[market.status]
  const spread = market.primarySecondaryBp === null
    ? '初級／次級利差當日無有效報價。'
    : `90 天期初級較次級高 ${market.primarySecondaryBp.toFixed(1)} bp。`
  const ncd = market.ncdNetIssuance5d === null
    ? '央行近 5 個交易日 NCD 淨發行資料尚不完整。'
    : `央行近 5 個交易日 NCD ${market.ncdNetIssuance5d > 0 ? '淨吸收' : market.ncdNetIssuance5d < 0 ? '淨釋出' : '大致持平'} ${Math.abs(market.ncdNetIssuance5d).toLocaleString('zh-TW')} 百萬元` +
      `${market.ncdOutstanding === null ? '' : `，未到期餘額 ${Math.round(market.ncdOutstanding / 100).toLocaleString('zh-TW')} 億元`}。`
  const repo = market.repoOperation ? '公告出現附買回／附賣回操作，屬非例行動作，需優先確認原因。' : ''
  const guard = market.guardApplied ? `${market.guardApplied}。` : ''

  return {
    marketState: base.marketState,
    pressureSource: `${base.pressureSource}${spread}`,
    policyObservation: `${base.policyObservation}${ncd}${repo}`,
    researchView: `${compositeLine(market)}${trendLine(market.tfssChange5dBp)}${guard}${seasonalLine(market)}本觀點為規則式模板自動產生，僅供公開市場研究參考。`,
    fxView: fxLine(market),
    risksAndLimits: [
      '本摘要為規則式模板文字，非 AI 或人工分析生成。',
      'TFSS 以票券初級市場利率減銀行間定盤利率，價差同時含信用溢酬與流動性溢酬，非純粹的資金鬆緊指標。',
      '綜合燈號的門檻為常態近似初值，尚未以歷史回測校準；子指標採等權，權重亦未經最適化。',
      '子指標須通過材料性檢定（120 日標準差門檻）才納入合成：z-score 尺度無關，台灣的 TAIBOR 報價與隔拆走廊位置變動極小，不設門檻會讓雜訊主導燈號。',
      '外幣通道缺少換匯點，無法計算避險後的隱含台幣成本。',
      '公開資料可能有發布與擷取延遲，指標判讀不構成投資、融資或交易建議。'
    ],
    generatedAt: new Date().toISOString()
  }
}
