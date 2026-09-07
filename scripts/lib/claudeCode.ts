import { execFile } from 'node:child_process'

/**
 * 用 Claude Code 訂閱（而非計量計費的 Anthropic API）跑文字生成。
 *
 * 官方文件（code.claude.com/docs/en/authentication「Generate a long-lived
 * token」＋ code.claude.com/docs/en/github-actions「Run on a schedule」）
 * 明確示範了這個用法：`claude setup-token` 產生一年期 OAuth token，
 * 綁定 Pro/Max/Team/Enterprise 訂閱，設成 CLAUDE_CODE_OAUTH_TOKEN 環境變數，
 * 排程任務（含非程式相關的摘要生成）即可用訂閱額度執行，不計入 API 帳單。
 *
 * 刻意不加 --bare：官方文件明講 bare 模式不讀 CLAUDE_CODE_OAUTH_TOKEN
 * （只認 ANTHROPIC_API_KEY），加了反而會驗證失敗。
 *
 * 2026-09-06 用這個 repo 所在環境的 claude 2.1.177 實測過一次呼叫
 * （該環境的登入已過期，但藉此確認了失敗時的 JSON 結構：
 * type/subtype/is_error/result/total_cost_usd/session_id）；
 * --permission-prompts 是 2.1.259+ 才有的參數，這裡用不到就不加。
 */
const TIMEOUT_MS = 90_000
const MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_MODEL = 'haiku'

interface ClaudeCodeResponse {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  structured_output?: unknown
  total_cost_usd?: number
}

export interface ClaudeCodeResult {
  /** 純文字回覆；有 jsonSchema 時可能為 undefined，改看 structured */
  text?: string
  /** 只有帶 jsonSchema 呼叫時才有值 */
  structured?: unknown
  model: string
  costUsd: number | null
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('claude', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message))
        return
      }
      resolve(stdout.toString())
    })
  })
}

export async function runClaudeCode(
  system: string,
  user: string,
  options: { model?: string; jsonSchema?: object } = {}
): Promise<ClaudeCodeResult> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('未設定 CLAUDE_CODE_OAUTH_TOKEN')

  const model = options.model || process.env.CLAUDE_CODE_MODEL || DEFAULT_MODEL
  const args = ['-p', user, '--output-format', 'json', '--model', model, '--append-system-prompt', system]
  if (options.jsonSchema) args.push('--json-schema', JSON.stringify(options.jsonSchema))

  const stdout = await run(args)

  let payload: ClaudeCodeResponse
  try {
    payload = JSON.parse(stdout)
  } catch {
    throw new Error(`claude CLI 輸出不是有效 JSON：${stdout.slice(0, 200)}`)
  }

  // 實測過的失敗訊號：is_error true 時 result 欄位是錯誤訊息，不是內容
  if (payload.is_error || (payload.subtype && payload.subtype !== 'success')) {
    throw new Error(payload.result || `claude CLI 回應失敗（subtype: ${payload.subtype}）`)
  }

  if (options.jsonSchema) {
    if (payload.structured_output === undefined) throw new Error('claude CLI 未回傳 structured_output')
    return { structured: payload.structured_output, model, costUsd: payload.total_cost_usd ?? null }
  }

  const text = payload.result?.trim()
  if (!text) throw new Error('claude CLI 回應沒有文字內容')
  return { text, model, costUsd: payload.total_cost_usd ?? null }
}
