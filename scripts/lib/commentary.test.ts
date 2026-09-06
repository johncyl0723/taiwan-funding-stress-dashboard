import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAiCommentary } from './commentary'
import type { HistoryPoint, NewsItem } from '../../src/types'

const market = {
  date: '2026-09-04',
  status: 'normal',
  eventFlags: ['營所稅暫繳'],
  tfssBp: 41.11,
  tfssChange5dBp: 0.31,
  taibir90Primary: 2.0943,
  taibir90Secondary: 1.8515,
  primarySecondaryBp: 24.28,
  taibirSlopeBp: 33.44,
  taibor3m: 1.68322,
  taiborSlopeBp: 30.04,
  overnightRate: 0.822,
  corridorPosition: -0.0026,
  ncdNetIssuance: -30650,
  ncdNetIssuance5d: 114800,
  ncdOutstanding: 6595270,
  repoOperation: false,
  foreignNet: 56213,
  foreignNet5d: -70972,
  usdTwd: 31.63,
  usdTwdVol20: 3.83,
  sofr90: 3.64571,
  fxNominalSpreadBp: 196.25,
  stats: { percentile60: 70, percentile120: 85, zScore60: 0.5, zScore120: 1.03, sample60: 60, sample120: 120, provisional: false },
  compositeInputs: { tfss: 1.03, primarySecondary: 0.68, taiborSlope: null, corridor: null, ncdNetIssuance: null },
  compositeDispersion: {},
  excludedInputs: [{ key: 'taiborSlope' as const, reason: 'TAIBOR 斜率：120 日標準差 0.08 低於材料性門檻' }],
  compositeZ: 0.852,
  compositeZ5d: 0.831,
  guardApplied: null
} as unknown as HistoryPoint

const news: NewsItem[] = [
  { title: '115年9月364天期定期存單開標結果', url: 'https://example.tw/a', source: '中央銀行新聞稿', date: '2026-09-03', official: true }
]

const okResponse = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  })

afterEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
  vi.unstubAllGlobals()
})

describe('AI 短評', () => {
  it('skips entirely without an API key, and never throws', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('未設定 OPENAI_API_KEY')
    expect(spy).not.toHaveBeenCalled()
  })

  it('posts the documented request shape and reads the reply', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return okResponse('今日資金面平穩。\n\n值得留意 NCD 淨吸收。')
    }))

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.text).toContain('今日資金面平穩')
    expect(result.commentary?.model).toBe('gpt-5-mini')

    const call = captured!
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions')
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(call.init.body as string)
    // GPT-5 系列只接受 max_completion_tokens，且不支援 temperature
    expect(body.max_completion_tokens).toBeGreaterThan(0)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(body.messages).toHaveLength(2)
  })

  it('feeds the model the real numbers, the exclusions and the news', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    let prompt = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      prompt = JSON.parse(init.body as string).messages[1].content
      return okResponse('ok')
    }))

    await buildAiCommentary(market, undefined, news)
    expect(prompt).toContain('41.1 bp')
    expect(prompt).toContain('0.83')
    expect(prompt).toContain('材料性門檻')
    expect(prompt).toContain('364天期定期存單開標結果')
    expect(prompt).toContain('營所稅暫繳')
  })

  it('honours OPENAI_MODEL so a deprecated default cannot break the job', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_MODEL = 'gpt-5-nano'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('gpt-5-nano')
      return okResponse('ok')
    }))
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.model).toBe('gpt-5-nano')
  })

  it('degrades to null instead of failing the whole refresh', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 })
    ))
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('rate limit')
  })

  it('treats an empty reply as a failure rather than publishing blank commentary', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('   ')))
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('沒有文字內容')
  })
})
