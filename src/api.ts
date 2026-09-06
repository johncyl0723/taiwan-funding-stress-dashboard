import type { DashboardPayload } from './types'

export async function getDashboard(): Promise<DashboardPayload> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/dashboard.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error('無法取得儀表板資料')
  return response.json() as Promise<DashboardPayload>
}
