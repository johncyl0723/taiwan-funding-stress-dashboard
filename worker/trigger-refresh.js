/**
 * Cloudflare Worker：讓儀表板頁面上的「手動更新」按鈕原地觸發
 * GitHub Actions 的 workflow_dispatch，不用另外開分頁去 Actions 頁面。
 *
 * 為什麼需要這支 Worker：靜態網站沒有能力代管有權限的 GitHub token —
 * 任何寫進前端 JS 的密鑰，任何人看原始碼或開發者工具就能拿走。
 * 這支 Worker 把 token 收在只有伺服器端看得到的環境變數裡，
 * 前端只知道這支 Worker 的公開網址，網址本身不帶任何機密。
 *
 * 部署方式（一次性，Cloudflare 免費方案）：
 *   1. wrangler login
 *   2. wrangler secret put GITHUB_TOKEN          ← 貼你建立的 fine-grained PAT
 *   3. wrangler deploy
 * 詳細步驟見 README「手動更新按鈕」一節。
 *
 * 這支程式在本機沒有 Cloudflare 帳號可測，是依 Cloudflare Workers 的
 * 標準 fetch handler 介面寫的，部署後請先手動按一次按鈕確認能觸發，
 * 我沒有辦法在你的帳號建立前先跑過。
 */

/** 只接受這個來源的請求，擋掉任何人直接打這支 Worker 的網址 */
const ALLOWED_ORIGIN = 'https://johncyl0723.github.io'

const OWNER = 'johncyl0723'
const REPO = 'taiwan-funding-stress-dashboard'
const WORKFLOW_FILE = 'update-and-deploy.yml'
const DASHBOARD_URL = `https://${OWNER}.github.io/${REPO}/data/dashboard.json`

/** 兩次觸發之間至少間隔這麼久，避免有人繞過按鈕直接洗 Worker 網址 */
const COOLDOWN_MS = 10 * 60 * 1000

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  }
}

async function lastUpdatedAt() {
  try {
    const response = await fetch(DASHBOARD_URL, { cf: { cacheTtl: 0 } })
    if (!response.ok) return null
    const payload = await response.json()
    const iso = payload?.market?.updatedAt
    return iso ? Date.parse(iso) : null
  } catch {
    // 讀不到資料日期就不擋，交給下面的 GitHub API 呼叫結果決定成敗
    return null
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const headers = corsHeaders(origin)

    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (origin !== ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ error: '來源不允許' }), { status: 403, headers })
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: '只接受 POST' }), { status: 405, headers })
    }

    const lastRun = await lastUpdatedAt()
    if (lastRun !== null) {
      const elapsed = Date.now() - lastRun
      if (elapsed < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000)
        return new Response(
          JSON.stringify({ error: `更新太頻繁，請 ${waitSec} 秒後再試`, cooldownRemainingSeconds: waitSec }),
          { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }
    }

    const dispatchUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`
    const response = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'taiwan-funding-stress-dashboard-refresh-button'
      },
      body: JSON.stringify({ ref: 'master' })
    })

    if (response.status === 204) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    // GitHub 對觸發失敗的說明放在回應內文，原樣帶回去方便除錯，
    // 但不附加任何我方憑證資訊
    const detail = await response.text()
    return new Response(JSON.stringify({ error: `GitHub 回應 ${response.status}`, detail }), {
      status: 502,
      headers: { ...headers, 'Content-Type': 'application/json' }
    })
  }
}
