import { DashboardData, Activity, TrendDataPoint } from './types'
import { getToken } from './auth'

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

function authHeaders(): HeadersInit {
  const token = getToken()
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate: 0 },
    headers: authHeaders(),
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `API error ${res.status}`)
  return data
}

export const api = {
  // App auth
  login: (userId: string, password: string) =>
    post<{ token: string; user_id: string; display: string }>('/login', { user_id: userId, password }),
  me: () => get<{ user_id: string; display: string }>('/me'),

  // Garmin auth
  getAuthStatus: () => get<{ connected: boolean; email?: string; connected_at?: string }>('/auth/status'),
  connectGarmin: (email: string, password: string) =>
    post<{ status: string; email: string }>('/auth/connect', { email, password }),
  disconnectGarmin: () => post('/auth/disconnect'),

  // Data
  getDashboard:  () => get<DashboardData>('/dashboard'),
  sync:          () => post('/sync'),
  getActivities: (days = 14) => get<Activity[]>(`/activities?days=${days}`),
  getTrends:     (days = 90) => get<TrendDataPoint[]>(`/trends?days=${days}`),
}
