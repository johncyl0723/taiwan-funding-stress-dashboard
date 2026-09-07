import { useState } from 'react'

/**
 * 手動更新按鈕：原地觸發 GitHub Actions 的 workflow_dispatch，不跳頁。
 *
 * 靜態網站沒有能力代管有權限的 GitHub token，所以按鈕呼叫的是一支
 * Cloudflare Worker（worker/trigger-refresh.js）代為觸發，token 只存在
 * Worker 的環境變數裡。沒有部署這支 Worker（VITE_REFRESH_WORKER_URL
 * 未設定）時，按鈕退化成連到 Actions 頁面的純連結，仍然可以手動更新，
 * 只是要多跳一次頁。見 README「手動更新按鈕」。
 */
const WORKER_URL = import.meta.env.VITE_REFRESH_WORKER_URL as string | undefined
const ACTIONS_URL = 'https://github.com/johncyl0723/taiwan-funding-stress-dashboard/actions/workflows/update-and-deploy.yml'

type State = 'idle' | 'working' | 'done' | 'error'

export function RefreshButton() {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')

  if (!WORKER_URL) {
    return <a className="refresh-btn refresh-btn-link" href={ACTIONS_URL} target="_blank" rel="noreferrer noopener">
      手動更新資料 ↗
    </a>
  }

  const trigger = async () => {
    setState('working')
    setMessage('')
    try {
      const response = await fetch(WORKER_URL, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `伺服器回應 ${response.status}`)
      setState('done')
      setMessage('已觸發，資料更新完成後這頁會顯示新內容（約 1–2 分鐘）。')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '觸發失敗')
    }
  }

  return <div className="refresh-widget">
    <button
      className="refresh-btn"
      onClick={trigger}
      disabled={state === 'working'}
    >
      {state === 'working' ? '觸發中…' : '手動更新資料'}
    </button>
    {message && <p className={`refresh-msg ${state === 'error' ? 'is-error' : ''}`}>{message}</p>}
  </div>
}
