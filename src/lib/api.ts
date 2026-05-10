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
  getAuthStatus: () => get<{ connected: boolean; email?: string; connected_at?: string }>('/auth/status'),
  connectGarmin: (email: string, password: string) =>
    fetch(`${BASE}/auth/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async r => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Connection failed')
      return data
    }),
  disconnectGarmin: () => fetch(`${BASE}/auth/disconnect`, { method: 'POST' }).then(r => r.json()),
}
