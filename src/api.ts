import type { DashboardPayload, HistoryPoint } from './types'

async function getJson<T>(file: string, message: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(message)
  return response.json() as Promise<T>
}

export const getDashboard = () => getJson<DashboardPayload>('dashboard.json', '無法取得儀表板資料')

/** 歷史序列僅供繪圖，載入失敗時不應阻擋主畫面 */
export const getHistory = () => getJson<HistoryPoint[]>('history.json', '無法取得歷史序列')
