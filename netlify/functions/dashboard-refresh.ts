import { getUser } from '@netlify/identity'
import type { Config, Context } from '@netlify/functions'

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const user = await getUser()
  const roles = (user?.appMetadata?.roles as string[] | undefined) ?? []
  if (!roles.includes('admin')) return new Response('Forbidden', { status: 403 })
  const url = new URL('/api/internal/dashboard-refresh', context.site.url)
  const refresh = await fetch(url, { method: 'POST', headers: { 'x-internal-refresh-secret': Netlify.env.get('INTERNAL_REFRESH_SECRET') || '', 'x-refresh-trigger': 'manual' } })
  if (!refresh.ok) return new Response('Unable to start refresh', { status: 502 })
  return new Response(null, { status: 202 })
}
export const config: Config = { path: '/api/dashboard/refresh', method: ['POST'] }
