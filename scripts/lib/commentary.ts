import type { AiCommentary, HistoryPoint, NewsItem } from '../../src/types.js'

/**
 * AI 評論：在 GitHub Action 裡呼叫一次 OpenAI，把產生的文字存進 dashboard.json，
 * 頁面本身仍是純靜態。沒有金鑰就整段跳過，規則式摘要照常運作。
 *
 * 模型可用 OPENAI_MODEL 覆寫 —— 模型 ID 會隨時間汰換，寫死會讓專案在某天突然壞掉。
 */
const DEFAULT_MODEL = 'gpt-5-mini'
const ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const TIMEOUT_MS = 60_000

const SYSTEM_PROMPT = `你是台灣貨幣市場的研究員，替一位上市公司財務長撰寫每日資金行情短評。

寫作要求：
- 繁體中文，300 字以內，直接說重點，不要開場白與結語。
- 只依據使用者提供的數據與新聞標題，不得引入任何未提供的數字或事件。
- 數據不足或指標被排除時要如實說明，不要假裝有結論。
- 不得提供投資、融資或交易建議，不得預測特定價位。
- 用「觀察」「顯示」「反映」這類描述性動詞，避免命令語氣。

輸出格式（純文字，不要 Markdown 標題）：
第一段：今天資金面的狀態與最主要的驅動因素。
第二段：值得留意的變化或風險，若新聞與數據互相印證或矛盾請點出。`

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

function buildUserPrompt(market: HistoryPoint, previous: HistoryPoint | undefined, news: NewsItem[]): string {
  const fmt = (value: number | null, digits = 2, unit = '') =>
    value === null ? '無資料' : `${value.toFixed(digits)}${unit}`

  const excluded = market.excludedInputs?.length
    ? market.excludedInputs.map(entry => entry.reason).join('；')
    : '無'

  const delta = (current: number | null, before: number | null | undefined, unit: string) => {
    if (current === null || before === null || before === undefined) return '無法比較'
    const diff = current - before
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}${unit}`
  }

  return [
    `資料日：${market.date}`,
    `燈號：${market.status}`,
    `TSS 綜合指數（5 日均 z-score）：${fmt(market.compositeZ5d)}，當日 ${fmt(market.compositeZ)}，較前一日 ${delta(market.compositeZ5d, previous?.compositeZ5d, '')}`,
    `門檻：1.0 開始偏緊、1.5 明顯緊俏、2.0 異常壓力`,
    '',
    '子指標（120 日 z-score）：',
    `- TFSS 票券相對銀行間溢酬：${fmt(market.tfssBp, 1, ' bp')}，z ${fmt(market.compositeInputs.tfss)}，5 日變化 ${fmt(market.tfssChange5dBp, 1, ' bp')}`,
    `- 初級－次級利差：${fmt(market.primarySecondaryBp, 1, ' bp')}，z ${fmt(market.compositeInputs.primarySecondary)}`,
    `- TAIBOR 1W–3M 斜率：${fmt(market.taiborSlopeBp, 1, ' bp')}，z ${fmt(market.compositeInputs.taiborSlope)}`,
    `- O/N 走廊位置：${fmt(market.corridorPosition, 4)}，z ${fmt(market.compositeInputs.corridor)}`,
    `- NCD 近 5 日淨發行：${market.ncdNetIssuance5d === null ? '無資料' : `${market.ncdNetIssuance5d.toLocaleString('zh-TW')} 百萬元`}，z ${fmt(market.compositeInputs.ncdNetIssuance)}`,
    `未納入合成的子指標：${excluded}`,
    '',
    '其他讀數：',
    `- 隔夜拆款利率：${fmt(market.overnightRate, 3, '%')}`,
    `- 3M TAIBOR：${fmt(market.taibor3m, 3, '%')}`,
    `- NCD 未到期餘額：${market.ncdOutstanding === null ? '無資料' : `${Math.round(market.ncdOutstanding / 100).toLocaleString('zh-TW')} 億元`}`,
    `- 外資近 5 日買賣超：${market.foreignNet5d === null ? '無資料' : `${market.foreignNet5d.toLocaleString('zh-TW')} 百萬元`}`,
    `- USD/TWD：${fmt(market.usdTwd, 3)}，20 日年化波動 ${fmt(market.usdTwdVol20, 1, '%')}`,
    `- SOFR 90 日均：${fmt(market.sofr90, 3, '%')}`,
    `當日事件旗標：${market.eventFlags.length ? market.eventFlags.join('、') : '無'}`,
    market.guardApplied ? `判讀修正：${market.guardApplied}` : '',
    '',
    news.length ? `近期相關新聞標題（僅供參考，不要當成已證實的事實）：\n${news.slice(0, 8).map(item => `- [${item.date}] ${item.title}（${item.source}）`).join('\n')}` : '近期無相關新聞。'
  ].filter(Boolean).join('\n')
}

export async function buildAiCommentary(
  market: HistoryPoint,
  previous: HistoryPoint | undefined,
  news: NewsItem[]
): Promise<{ commentary: AiCommentary | null; status: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { commentary: null, status: 'AI 評論 已跳過（未設定 OPENAI_API_KEY）' }
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // GPT-5 系列用 max_completion_tokens，且不支援 temperature
      body: JSON.stringify({
        model,
        max_completion_tokens: 800,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(market, previous, news) }
        ]
      }),
      signal: controller.signal
    })

    const payload = (await response.json()) as ChatResponse
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
    }
    const text = payload.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('回應沒有文字內容')

    return {
      commentary: { text, model, generatedAt: new Date().toISOString() },
      status: `AI 評論 已生成（${model}）`
    }
  } catch (error) {
    // 評論失敗絕不能擋住資料更新：規則式摘要仍會照常發布
    return {
      commentary: null,
      status: `AI 評論 生成失敗：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}
