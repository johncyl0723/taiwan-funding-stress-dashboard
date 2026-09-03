import type { Config } from '@netlify/functions'
import { refreshDashboard } from './_shared/refresh'

export default async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const supplied = request.headers.get('x-internal-refresh-secret')
  if (!supplied || supplied !== Netlify.env.get('INTERNAL_REFRESH_SECRET')) return new Response('Unauthorized', { status: 401 })
  const trigger = request.headers.get('x-refresh-trigger') === 'scheduled' ? 'scheduled' : 'manual'
  await refreshDashboard(trigger)
  return Response.json({ ok: true })
}
export const config: Config = { path: '/api/internal/dashboard-refresh' }
