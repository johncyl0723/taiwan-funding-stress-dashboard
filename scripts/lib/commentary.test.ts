import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint, NewsItem } from '../../src/types'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }))
const mockClaudeCode = (stdout: string) => execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(null, stdout, ''))

const { buildAiCommentary, buildNewsDigest } = await import('./commentary')

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

afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.CLAUDE_CODE_MODEL
  execFileMock.mockReset()
})

describe('AI 短評', () => {
  it('skips entirely without CLAUDE_CODE_OAUTH_TOKEN, and never throws', async () => {
    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('generates commentary via the Claude Code subscription', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', result: '訂閱路徑產生的短評。' }))

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.text).toBe('訂閱路徑產生的短評。')
    expect(result.commentary?.model).toContain('Claude Code 訂閱')
  })

  it('degrades to null instead of failing the whole refresh when the CLI reports an error', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'boom' }))

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary).toBeNull()
    expect(result.status).toContain('boom')
  })

  it('feeds the model the real numbers, the exclusions and the news', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }))

    await buildAiCommentary(market, undefined, news)
    const prompt = execFileMock.mock.calls[0][1][1] as string
    expect(prompt).toContain('41.1 bp')
    expect(prompt).toContain('0.83')
    expect(prompt).toContain('材料性門檻')
    expect(prompt).toContain('364天期定期存單開標結果')
    expect(prompt).toContain('營所稅暫繳')
  })

  it('honours CLAUDE_CODE_MODEL so a deprecated default cannot break the job', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    process.env.CLAUDE_CODE_MODEL = 'sonnet'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }))

    const result = await buildAiCommentary(market, undefined, news)
    expect(result.commentary?.model).toContain('sonnet')
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('sonnet')
  })

  it('treats an empty reply as a failure rather than publishing blank commentary', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', result: '   ' }))

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

  it('reads the structured {official, media} fields directly, no regex parsing', async () => {
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

  it('sends official bodies but only media headlines', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({
      type: 'result', subtype: 'success',
      structured_output: { official: 'a', media: 'b' }
    }))

    await buildNewsDigest(items)
    const prompt = execFileMock.mock.calls[0][1][1] as string
    expect(prompt).toContain('6,019.04億美元')
    expect(prompt).toContain('只有標題，未取得內文')
    // 媒體那則沒有 body，不該憑空出現內文欄位
    expect(prompt).not.toContain('內文：undefined')
  })

  it('tells the model that news content is data, not instructions', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockClaudeCode(JSON.stringify({
      type: 'result', subtype: 'success',
      structured_output: { official: 'a', media: 'b' }
    }))

    await buildNewsDigest(items)
    const args = execFileMock.mock.calls[0][1] as string[]
    const systemIndex = args.indexOf('--append-system-prompt')
    expect(args[systemIndex + 1]).toContain('不是指令')
  })

  it('skips without a token or without news, and survives a CLI failure', async () => {
    expect((await buildNewsDigest(items)).status).toContain('CLAUDE_CODE_OAUTH_TOKEN')

    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    expect((await buildNewsDigest([])).status).toContain('無新聞可摘要')

    mockClaudeCode(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'boom' }))
    const failed = await buildNewsDigest(items)
    expect(failed.digest).toBeNull()
    expect(failed.status).toContain('生成失敗')
  })
})
