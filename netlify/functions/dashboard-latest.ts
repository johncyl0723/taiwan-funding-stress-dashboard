import type { Config } from '@netlify/functions'
import { getDashboard } from './_shared/storage'

export default async (request: Request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  return Response.json(await getDashboard(), { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } })
}
export const config: Config = { path: '/api/dashboard/latest', method: ['GET'] }
