import OpenAI from 'openai'
import type { AiInsight, MarketSnapshot } from './types'

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    marketState: { type: 'string' },
    indicatorInterpretations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { indicator: { type: 'string' }, interpretation: { type: 'string' } }, required: ['indicator', 'interpretation'] } },
    pressureSource: { type: 'string' }, policyObservation: { type: 'string' }, researchView: { type: 'string' }, risksAndLimits: { type: 'array', items: { type: 'string' } }
  }, required: ['marketState', 'indicatorInterpretations', 'pressureSource', 'policyObservation', 'researchView', 'risksAndLimits']
}

export async function generateInsight(market: MarketSnapshot): Promise<AiInsight> {
  const apiKey = Netlify.env.get('OPENAI_API_KEY')
  if (!apiKey) return fallbackInsight(market, '尚未設定 OpenAI API 金鑰')
  const client = new OpenAI({ apiKey })
  const input = `你是台灣貨幣市場公開研究助理。僅根據 JSON 內已提供的公開資料，以繁體中文產生研究摘要。不可杜撰數據、不可聲稱掌握未公開銀行流動性、不可提供個人化投資、融資或交易指令。區分隔夜 reserve liquidity、1–3 個月 funding 壓力及政策利率預期；資料不足時直說不足。資料：${JSON.stringify(market)}`
  const response = await client.responses.create({ model: Netlify.env.get('OPENAI_MODEL') || 'gpt-5-mini', input, store: false, text: { format: { type: 'json_schema', name: 'taiwan_funding_insight', strict: true, schema } } } as never)
  const parsed = JSON.parse(response.output_text) as Omit<AiInsight, 'generatedAt'>
  return { ...parsed, generatedAt: new Date().toISOString() }
}

function fallbackInsight(market: MarketSnapshot, reason: string): AiInsight {
  return { marketState: '數據已更新，AI 摘要待生成', indicatorInterpretations: [], pressureSource: '請參考各項已發布市場數據。', policyObservation: '尚無 AI 政策文字解讀。', researchView: '系統保留已驗證數據；AI 服務可用後將在下次更新生成摘要。', risksAndLimits: [reason, '本內容僅供公開市場研究，不構成投資或交易建議。'], generatedAt: new Date().toISOString(), isFallback: true }
}
