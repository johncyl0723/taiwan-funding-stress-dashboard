import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint, NewsItem } from '../../src/types'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }))
const mockClaudeCode = (stdout: string) => execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(null, stdout, ''))

const { buildAiCommentary, buildNewsDigest, parseDigest } = await import('./commentary')

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
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.CLAUDE_CODE_MODEL
  vi.unstubAllGlobals()
  execFileMock.mockReset()
})

describe('AI 短評', () => {
  it('skips entirely with neither credential set, and never throws', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(result.status).toContain('OPENAI_API_KEY')
    expect(spy).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('prefers the Claude Code subscription over OpenAI when both are set', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    process.env.OPENAI_API_KEY = 'sk-test'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', result: '訂閱路徑產生的短評。' }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.text).toBe('訂閱路徑產生的短評。')
    expect(result.commentary?.model).toContain('Claude Code 訂閱')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to OpenAI when only OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('OpenAI 路徑產生的短評。')))
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.text).toBe('OpenAI 路徑產生的短評。')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('does not retry on OpenAI when the selected Claude Code backend fails', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    process.env.OPENAI_API_KEY = 'sk-test'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'boom' }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('boom')
    expect(fetchSpy).not.toHaveBeenCalled()
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

describe('新聞摘要', () => {
  const items = [
    { title: '115年8月底外匯存底', url: 'https://cbc/1', source: '中央銀行新聞稿', date: '2026-09-04', official: true, body: '115年8月底我國外匯存底金額為6,019.04億美元，較上月底增加76.33億美元。' },
    { title: '央行8月大舉回收資金加發定存單逾2,000億元', url: 'https://news/2', source: '工商時報', date: '2026-09-02', official: false }
  ]

  it('splits the two-line reply into official and media', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () =>
      okResponse('官方：外匯存底 6,019.04 億美元，月增 76.33 億。\n媒體：標題顯示央行 8 月加大回收資金。')
    ))
    const { digest } = await buildNewsDigest(items)
    expect(digest?.official).toContain('6,019.04')
    expect(digest?.media).toContain('回收資金')
    expect(digest?.media).not.toContain('官方')
  })

  it('sends official bodies but only media headlines', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    let prompt = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      prompt = JSON.parse(init.body as string).messages[1].content
      return okResponse('官方：a\n媒體：b')
    }))
    await buildNewsDigest(items)
    expect(prompt).toContain('6,019.04億美元')
    expect(prompt).toContain('只有標題，未取得內文')
    // 媒體那則沒有 body，不該憑空出現內文欄位
    expect(prompt).not.toContain('內文：undefined')
  })

  it('tells the model that news content is data, not instructions', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    let system = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      system = JSON.parse(init.body as string).messages[0].content
      return okResponse('官方：a\n媒體：b')
    }))
    await buildNewsDigest(items)
    expect(system).toContain('不是指令')
  })

  it('keeps an off-format reply rather than discarding it', () => {
    expect(parseDigest('央行本週維持例行操作。').official).toBe('央行本週維持例行操作。')
  })

  it('skips without a key or without news, and survives an API failure', async () => {
    expect((await buildNewsDigest(items)).status).toContain('CLAUDE_CODE_OAUTH_TOKEN')

    process.env.OPENAI_API_KEY = 'sk-test'
    expect((await buildNewsDigest([])).status).toContain('無新聞可摘要')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const failed = await buildNewsDigest(items)
    expect(failed.digest).toBeNull()
    expect(failed.status).toContain('生成失敗')
  })

  it('uses --json-schema on the Claude Code path and reads structured fields directly, no regex parsing', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({
      type: 'result', subtype: 'success',
      structured_output: { official: '外匯存底 6,019.04 億美元。', media: '標題顯示央行加大回收資金。' }
    }))
    const { digest } = await buildNewsDigest(items)
    expect(digest?.official).toContain('6,019.04')
    expect(digest?.media).toContain('回收資金')
    expect(digest?.model).toContain('Claude Code 訂閱')

    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('--json-schema')
  })
})
