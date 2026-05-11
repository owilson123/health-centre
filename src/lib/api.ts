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

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `API error ${res.status}`)
  return data
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || `API error ${res.status}`)
  return data
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
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

  // Training
  training: {
    getExercises:  (q = '', category = '') =>
      get<TrainingExercise[]>(`/training/exercises?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`),
    getTemplates:  () => get<WorkoutTemplate[]>('/training/templates'),
    createTemplate: (body: { name: string; exercise_ids: number[] }) =>
      post<{ id: number; name: string }>('/training/templates', body),
    updateTemplate: (tid: number, body: { name?: string; exercise_ids?: number[] }) =>
      put('/training/templates/' + tid, body),
    deleteTemplate: (tid: number) => del('/training/templates/' + tid),

    startSession:  (body: { template_id?: number; name?: string }) =>
      post<{ session_id: number; name: string; exercises: TrainingExercise[] }>('/training/sessions', body),
    getSessions:   (limit = 20) => get<SessionSummary[]>(`/training/sessions?limit=${limit}`),
    getSession:    (sid: number) => get<SessionDetail>('/training/sessions/' + sid),
    finishSession: (sid: number) => patch('/training/sessions/' + sid + '/finish'),
    logSet:        (sid: number, body: SetLog) =>
      post<{ set_id: number }>('/training/sessions/' + sid + '/sets', body),
    deleteSet:     (setId: number) => del('/training/sets/' + setId),

    lastPerformance: (exerciseId: number) =>
      get<LastPerformance>('/training/exercises/' + exerciseId + '/last-performance'),
  },
}

// ─── Training types ───────────────────────────────────────────────────────────

export interface TrainingExercise {
  id: number
  name: string
  category: string
  equipment: string
}

export interface WorkoutTemplate {
  id: number
  name: string
  created_at: string
  exercises: TrainingExercise[]
}

export interface SessionSummary {
  id: number
  name: string
  template_id: number | null
  started_at: string
  finished_at: string
  total_sets: number
  total_volume_kg: number
  exercise_count: number
}

export interface SessionDetail {
  id: number
  name: string
  started_at: string
  finished_at: string | null
  exercises: {
    exercise_id: number
    exercise_name: string
    category: string
    equipment: string
    sets: { id: number; set_number: number; weight_kg: number | null; reps: number }[]
  }[]
}

export interface SetLog {
  exercise_id: number
  set_number: number
  weight_kg?: number
  reps: number
}

export interface LastPerformance {
  summary: string | null
  sets: { set_number: number; weight_kg: number | null; reps: number }[]
  session_date: string | null
}
