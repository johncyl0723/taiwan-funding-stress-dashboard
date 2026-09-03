import { getStore } from '@netlify/blobs'
import { seedDashboard } from './seed'
import type { DashboardPayload, MarketSnapshot, BankQuarterlyMetric } from './types'

const store = () => getStore({ name: 'taiwan-funding-dashboard', consistency: 'strong' })
export async function getDashboard(): Promise<DashboardPayload> { return (await store().get('dashboard/latest', { type: 'json' }) as DashboardPayload | null) ?? seedDashboard }
export async function saveDashboard(payload: DashboardPayload) { await store().setJSON('dashboard/latest', payload) }
export async function getHistory(): Promise<MarketSnapshot[]> { return (await store().get('market/history', { type: 'json' }) as MarketSnapshot[] | null) ?? [] }
export async function saveHistory(history: MarketSnapshot[]) { await store().setJSON('market/history', history.slice(-260)) }
export async function saveRaw(date: string, raw: Record<string, string>) { await store().setJSON(`raw/${date}`, raw) }
export async function getBankMetrics(): Promise<BankQuarterlyMetric[]> { return (await store().get('banks/latest', { type: 'json' }) as BankQuarterlyMetric[] | null) ?? [] }
export async function setRefreshLog(data: object) { await store().setJSON('refresh/latest', data) }
