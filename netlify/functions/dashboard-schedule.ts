import type { Config, Context } from '@netlify/functions'

export default async (_request: Request, context: Context) => {
  const url = new URL('/api/internal/dashboard-refresh', context.site.url)
  const refresh = await fetch(url, { method: 'POST', headers: { 'x-internal-refresh-secret': Netlify.env.get('INTERNAL_REFRESH_SECRET') || '', 'x-refresh-trigger': 'scheduled' } })
  if (!refresh.ok) throw new Error(`背景更新未能啟動：${refresh.status}`)
  return new Response(null, { status: 202 })
}
export const config: Config = { schedule: '0 4 * * 1-5' }
