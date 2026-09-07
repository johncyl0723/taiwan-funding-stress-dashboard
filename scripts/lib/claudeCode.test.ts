import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }))

const { runClaudeCode } = await import('./claudeCode')

/** 2026-09-06 對這個 repo 所在環境實測 `claude -p ... --output-format json`
 * 失敗時的真實回應（登入過期），用它當夾具，而不是憑印象編一個結構。 */
const REAL_AUTH_FAILURE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: true, api_error_status: 401,
  result: 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.',
  total_cost_usd: 0, session_id: '4168347c-9821-48d4-8e6d-31bc2e538f4f'
})

function mockExec(stdout: string, err: Error | null = null) {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(err, stdout, ''))
}

afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.CLAUDE_CODE_MODEL
  execFileMock.mockReset()
})

describe('Claude Code 訂閱後端', () => {
  it('refuses to shell out at all without the token', async () => {
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow('未設定 CLAUDE_CODE_OAUTH_TOKEN')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('never passes --bare, which the docs say ignores CLAUDE_CODE_OAUTH_TOKEN entirely', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0.001 }))
    await runClaudeCode('sys', 'user')
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).not.toContain('--bare')
    expect(args).toEqual(['-p', 'user', '--output-format', 'json', '--model', 'haiku', '--append-system-prompt', 'sys'])
  })

  it('defaults to haiku but honours CLAUDE_CODE_MODEL', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    process.env.CLAUDE_CODE_MODEL = 'sonnet'
    mockExec(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }))
    const result = await runClaudeCode('sys', 'user')
    expect(result.model).toBe('sonnet')
    expect((execFileMock.mock.calls[0][1] as string[])).toContain('sonnet')
  })

  it('parses the real 401 failure shape as a thrown error carrying the message', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(REAL_AUTH_FAILURE)
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow('OAuth access token has expired')
  })

  it('treats a non-success subtype as failure even when is_error is absent', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(JSON.stringify({ type: 'result', subtype: 'error_max_turns', result: 'gave up' }))
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow('gave up')
  })

  it('surfaces execFile failures (non-zero exit) using stderr', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec('', new Error('spawn claude ENOENT'))
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow(/ENOENT|spawn/)
  })

  it('rejects on unparseable stdout instead of returning garbage', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec('not json')
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow('不是有效 JSON')
  })

  it('rejects an empty result as a failure, not a blank success', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(JSON.stringify({ type: 'result', subtype: 'success', result: '   ' }))
    await expect(runClaudeCode('sys', 'user')).rejects.toThrow('沒有文字內容')
  })

  it('adds --json-schema and returns structured_output instead of text', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { official: 'a', media: 'b' } }))
    const schema = { type: 'object', properties: { official: { type: 'string' } } }
    const result = await runClaudeCode('sys', 'user', { jsonSchema: schema })
    expect(result.structured).toEqual({ official: 'a', media: 'b' })
    expect(result.text).toBeUndefined()
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('--json-schema')
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema))
  })

  it('rejects when --json-schema was requested but structured_output is missing', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok'
    mockExec(JSON.stringify({ type: 'result', subtype: 'success', result: 'plain text, no schema applied' }))
    await expect(runClaudeCode('sys', 'user', { jsonSchema: { type: 'object' } })).rejects.toThrow('structured_output')
  })
})
