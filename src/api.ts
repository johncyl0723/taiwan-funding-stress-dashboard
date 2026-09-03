import type { DashboardPayload } from './types'

export async function getDashboard(): Promise<DashboardPayload> {
  const response = await fetch('/api/dashboard/latest')
  if (!response.ok) throw new Error('無法取得儀表板資料')
  return response.json() as Promise<DashboardPayload>
}

export async function requestRefresh(): Promise<void> {
  const response = await fetch('/api/dashboard/refresh', { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(response.status === 403 ? '你沒有更新權限' : '更新要求未成功')
}
