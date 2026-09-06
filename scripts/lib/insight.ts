import { hasSeasonalFlag } from './calendar.js'
import { THRESHOLDS } from './composite.js'
import type { CompositeInputs, HistoryPoint, Insight, PolicyRate, Status } from '../../src/types.js'

const STATUS_TEXT: Record<Status, { marketState: string; pressureSource: string; policyObservation: string }> = {
  normal: {
    marketState: '資金面正常，綜合指數落在近一年常態區間。',
    pressureSource: '短端與 1–3 個月資金成本皆未見明顯壓力。',
    policyObservation: '央行公開市場操作維持例行步調。'
  },
  tightening: {
    marketState: '資金面轉緊，綜合指數站上近一年偏高區間。',
    pressureSource: '1–3 個月企業資金成本相對銀行間報價走升，供給端出現初步壓力。',
    policyObservation: '留意後續 NCD 淨發行與初級／次級利差是否持續擴大。'
  },
  tight: {
    marketState: '資金面明顯緊俏，多項子指標同向走高。',
    pressureSource: '中期資金供給吃緊，初級市場定價明顯高於次級市場。',
    policyObservation: '若持續數日未收斂，留意央行是否調整 NCD 發行或附買回操作節奏。'
  },
  stress: {
    marketState: '資金面出現異常壓力，綜合指數位於極端高檔。',
    pressureSource: '短中期資金供需明顯失衡，非單日雜訊可解釋。',
    policyObservation: '對照央行操作與銀行間拆款動態，確認是否為系統性事件。'
  },
  unavailable: {
    marketState: '樣本數尚不足以判斷資金面狀態。',
    pressureSource: '統計窗格尚未累積足夠交易日，或當日核心指標未同步定盤。',
    policyObservation: '待資料持續累積後，燈號判讀將趨於穩定。'
  }
}

const INPUT_LABELS: Record<keyof CompositeInputs, string> = {
  tfss: 'TFSS',
  primarySecondary: '初次級利差',
  taiborSlope: 'TAIBOR 斜率',
  corridor: 'O/N 走廊位置',
  ncdNetIssuance: 'NCD 淨發行'
}

const fixed = (value: number | null, digits = 1, suffix = '') =>
  value === null ? '—' : `${value.toFixed(digits)}${suffix}`

const signed = (value: number, digits = 1, suffix = '') =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`

/** 與 n 個交易日前的同一欄位比較 */
function change(history: HistoryPoint[], key: keyof HistoryPoint, back: number): number | null {
  const current = history.at(-1)?.[key]
  const before = history.at(-(back + 1))?.[key]
  if (typeof current !== 'number' || typeof before !== 'number') return null
  return current - before
}

function includedInputs(market: HistoryPoint): [keyof CompositeInputs, number][] {
  const dropped = new Set((market.excludedInputs ?? []).map(entry => entry.key))
  return (Object.keys(INPUT_LABELS) as (keyof CompositeInputs)[])
    .filter(key => !dropped.has(key))
    .map(key => [key, market.compositeInputs[key]] as [keyof CompositeInputs, number | null])
    .filter((entry): entry is [keyof CompositeInputs, number] => entry[1] !== null)
}

/** 頭條摘要：先說結論，再說什麼在動，最後說距離門檻多遠 */
function headline(market: HistoryPoint, history: HistoryPoint[]): string {
  if (market.compositeZ5d === null) {
    return market.guardApplied
      ? `${market.guardApplied}。資料完整但變異太小，判定為常態。`
      : '綜合指數樣本不足，尚未給出合成讀數。'
  }

  const day = change(history, 'compositeZ5d', 1)
  const week = change(history, 'compositeZ5d', 5)
  const included = includedInputs(market)
  const top = [...included].sort((a, b) => b[1] - a[1])[0]
  const room = market.compositeZ5d < THRESHOLDS.tightening
    ? `距離「開始偏緊」門檻還有 ${(THRESHOLDS.tightening - market.compositeZ5d).toFixed(2)}。`
    : ''

  return [
    `TSS 綜合指數 5 日均 ${market.compositeZ5d.toFixed(2)}`,
    day === null ? '' : `，較前一交易日 ${signed(day, 2)}`,
    week === null ? '' : `、較一週前 ${signed(week, 2)}`,
    '。',
    top ? `目前由 ${INPUT_LABELS[top[0]]}（z ${top[1].toFixed(2)}）主導，合成共採用 ${included.length} 個子指標。` : '',
    room
  ].join('')
}

function seasonalLine(market: HistoryPoint): string {
  if (!market.eventFlags.length) return ''
  const label = market.eventFlags.join('、')
  return hasSeasonalFlag(market.eventFlags)
    ? `本日落在${label}，資金偏緊屬季節性常態，燈號不因此升級。`
    : `本日落在${label}，市場可能提前反映利率決議預期。`
}

/**
 * 每個指標「現在的數字說什麼」。與 src/definitions.ts 的靜態意義說明配對，
 * 由前端左圖右文的右欄呈現。
 */
function buildReadings(market: HistoryPoint, history: HistoryPoint[], policyRate: PolicyRate | null): Record<string, string> {
  const out: Record<string, string> = {}
  const excludedFor = (key: keyof CompositeInputs) =>
    (market.excludedInputs ?? []).find(entry => entry.key === key)?.reason

  out.tss = headline(market, history)

  // ---- 央行政策
  const ncd5d = market.ncdNetIssuance5d
  out.ncdNetIssuance = ncd5d === null
    ? `近 5 個交易日尚無完整資料。${excludedFor('ncdNetIssuance') ?? ''}`
    : `近 5 個交易日${ncd5d > 0 ? '淨吸收' : ncd5d < 0 ? '淨釋出' : '大致持平'} ${Math.abs(ncd5d).toLocaleString('zh-TW')} 百萬元，當日 ${market.ncdNetIssuance?.toLocaleString('zh-TW') ?? '—'} 百萬元。`
      + (excludedFor('ncdNetIssuance') ? `目前未進入 TSS 合成：${excludedFor('ncdNetIssuance')}。` : '')

  const outstandingChange = change(history, 'ncdOutstanding', 5)
  out.ncdOutstanding = market.ncdOutstanding === null
    ? '尚無資料。'
    : `未到期餘額 ${Math.round(market.ncdOutstanding / 100).toLocaleString('zh-TW')} 億元`
      + (outstandingChange === null ? '。' : `，較 5 個交易日前 ${signed(outstandingChange / 100, 0)} 億元。`)

  out.corridor = market.corridorPosition === null
    ? '尚無資料。'
    : `隔拆 ${fixed(market.overnightRate, 3, '%')} 位於走廊 ${(market.corridorPosition * 100).toFixed(1)}% 的位置`
      + (policyRate ? `（下限為 7 天期 NCD 發行利率、上限為重貼現率 ${policyRate.rediscount}%）` : '')
      + '。' + (excludedFor('corridor') ? `目前未進入 TSS 合成：${excludedFor('corridor')}。` : '')

  // ---- 銀行間價格
  const onChange = change(history, 'overnightRate', 5)
  out.overnight = market.overnightRate === null
    ? '尚無資料。'
    : `${market.overnightRate.toFixed(3)}%`
      + (onChange === null ? '。' : `，較 5 個交易日前 ${signed(onChange * 100, 1, ' bp')}。`)

  const taiborChange = change(history, 'taibor3m', 5)
  out.taibor = market.taibor3m === null
    ? '尚無資料。'
    : `${market.taibor3m.toFixed(3)}%`
      + (taiborChange === null ? '。' : `，較 5 個交易日前 ${signed(taiborChange * 100, 1, ' bp')}。`)
      + '授信合約若以此計息，這就是利息費用的直接變動。'

  out.taiborSlope = market.taiborSlopeBp === null
    ? '尚無資料。'
    : `${market.taiborSlopeBp.toFixed(1)} bp。`
      + (excludedFor('taiborSlope') ? `目前未進入 TSS 合成：${excludedFor('taiborSlope')}。` : '')

  // ---- 票券與企業融資
  out.tfss = market.tfssBp === null
    ? '當日 TAIBIR 與 TAIBOR 未同步定盤，無法計算。'
    : `${market.tfssBp.toFixed(1)} bp`
      + (market.tfssChange5dBp === null ? '。' : `，較 5 個交易日前 ${signed(market.tfssChange5dBp, 1, ' bp')}。`)
      + (market.compositeInputs.tfss === null ? '' : `120 日 z-score ${market.compositeInputs.tfss.toFixed(2)}。`)

  const spreadChange = change(history, 'primarySecondaryBp', 5)
  out.primarySecondary = market.primarySecondaryBp === null
    ? '當日無有效報價。'
    : `${market.primarySecondaryBp.toFixed(1)} bp`
      + (spreadChange === null ? '。' : `，較 5 個交易日前 ${signed(spreadChange, 1, ' bp')}。`)
      + (market.compositeInputs.primarySecondary === null ? '' : `120 日 z-score ${market.compositeInputs.primarySecondary.toFixed(2)}。`)

  out.taibirSlope = market.taibirSlopeBp === null
    ? '尚無資料。'
    : `${market.taibirSlopeBp.toFixed(1)} bp。`
      + (market.taibirSlopeBp > 25
        ? '曲線偏陡，短天期相對便宜。'
        : market.taibirSlopeBp < 5 ? '曲線接近平坦，拉長天期鎖定成本的代價較低。' : '')

  // ---- 外生驅動
  out.foreignNet = market.foreignNet5d === null
    ? '尚無完整 5 日資料。'
    : `近 5 個交易日${market.foreignNet5d >= 0 ? '淨買超' : '淨賣超'} ${Math.abs(market.foreignNet5d).toLocaleString('zh-TW')} 百萬元。`

  // ---- 外幣通道
  out.sofr = market.sofr90 === null ? '尚無資料。' : `90 日均 ${market.sofr90.toFixed(3)}%。`
  out.fxSpread = market.fxNominalSpreadBp === null
    ? '資料不足，無法比較。'
    : `${market.fxNominalSpreadBp.toFixed(1)} bp，美元名目上${market.fxNominalSpreadBp > 0 ? '較貴' : '較便宜'}。`
      + '避險後的隱含台幣成本需要換匯點，該資料尚未接上，因此無法據此做切換決策。'
  out.usdTwd = market.usdTwd === null
    ? '尚無資料。'
    : `${market.usdTwd.toFixed(3)}`
      + (market.usdTwdVol20 === null ? '。' : `，20 日年化波動 ${market.usdTwdVol20.toFixed(1)}%。`)

  return out
}

export function buildInsight(
  market: HistoryPoint,
  history: HistoryPoint[],
  policyRate: PolicyRate | null = null
): Insight {
  const base = STATUS_TEXT[market.status]
  const readings = buildReadings(market, history, policyRate)
  const spread = market.primarySecondaryBp === null
    ? '初級／次級利差當日無有效報價。'
    : `90 天期初級較次級高 ${market.primarySecondaryBp.toFixed(1)} bp。`
  const ncd = market.ncdNetIssuance5d === null
    ? '央行近 5 個交易日 NCD 淨發行資料尚不完整。'
    : `央行近 5 個交易日 NCD ${market.ncdNetIssuance5d > 0 ? '淨吸收' : market.ncdNetIssuance5d < 0 ? '淨釋出' : '大致持平'} ${Math.abs(market.ncdNetIssuance5d).toLocaleString('zh-TW')} 百萬元。`
  const repo = market.repoOperation ? '公告出現附買回／附賣回操作，屬非例行動作，需優先確認原因。' : ''
  // 完整排除理由已在子指標分解與各指標列出現，這裡只給計數，避免同一頁重複三次
  const excluded = market.excludedInputs?.length
    ? `另有 ${market.excludedInputs.length} 項子指標未納入合成，原因見下方子指標分解。`
    : ''

  return {
    marketState: base.marketState,
    pressureSource: `${base.pressureSource}${spread}`,
    policyObservation: `${base.policyObservation}${ncd}${repo}`,
    researchView: `${readings.tss}${excluded}${seasonalLine(market)}本摘要為規則式模板依當日數據自動產生，僅供公開市場研究參考。`,
    fxView: `${readings.sofr}${readings.fxSpread}`,
    readings,
    risksAndLimits: [
      '本區塊為規則式模板文字，依當日數據套用預寫規則產生，不經 AI 生成。',
      'TFSS 以票券初級市場利率減銀行間定盤利率，價差同時含信用溢酬與流動性溢酬，非純粹的資金鬆緊指標。',
      '綜合指數的門檻為常態近似初值，尚未以歷史回測校準；子指標採等權，權重亦未經最適化。',
      '子指標須通過材料性檢定（120 日標準差門檻）才納入合成：z-score 尺度無關，台灣的 TAIBOR 報價與隔拆走廊位置變動極小，不設門檻會讓雜訊主導燈號。',
      '外幣通道缺少換匯點，無法計算避險後的隱含台幣成本。',
      '公開資料可能有發布與擷取延遲，指標判讀不構成投資、融資或交易建議。'
    ],
    generatedAt: new Date().toISOString()
  }
}
