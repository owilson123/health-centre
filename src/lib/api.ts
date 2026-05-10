import { DashboardData, Activity, TrendDataPoint } from './types'

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

export const api = {
  getDashboard: () => get<DashboardData>('/dashboard'),
  sync: () => fetch(`${BASE}/sync`, { method: 'POST' }).then(r => r.json()),
  getActivities: (days = 14) => get<Activity[]>(`/activities?days=${days}`),
  getTrends: (days = 90) => get<TrendDataPoint[]>(`/trends?days=${days}`),
}
