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
  wipeMyData: () => del<{ status: string }>('/admin/wipe-my-data'),

  // Data
  getDashboard:  () => get<DashboardData>('/dashboard'),
  sync:          () => post('/sync'),
  getActivities: (days = 14) => get<Activity[]>(`/activities?days=${days}`),
  getTrends:     (days = 90) => get<TrendDataPoint[]>(`/trends?days=${days}`),

  // Training
  training: {
    getExercises:  (q = '', category = '') =>
      get<TrainingExercise[]>(`/training/exercises?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`),
    createExercise: (body: { name: string; category: string; equipment: string }) =>
      post<TrainingExercise>('/training/exercises', body),
    deleteExercise: (id: number) => del('/training/exercises/' + id),
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
    deleteSession: (sid: number) => del('/training/sessions/' + sid),

    lastPerformance: (exerciseId: number) =>
      get<LastPerformance>('/training/exercises/' + exerciseId + '/last-performance'),

    getMaxes: () => get<{ bench_1rm: number | null; row_5rm: number | null; squat_1rm: number | null }>('/training/maxes'),
    updateMaxes: (body: { bench_1rm?: number; row_5rm?: number; squat_1rm?: number }) =>
      put('/training/maxes', body),

    smartSuggest: () => get<SmartSuggest>('/training/smart-suggest'),
  },

  // Nutrition
  nutrition: {
    getGoals:   () => get<NutritionGoals>('/nutrition/goals'),
    updateGoals:(body: Partial<NutritionGoals>) => put<{ status: string }>('/nutrition/goals', body),
    getDiary:   (date?: string) => get<DiaryDay>(`/nutrition/diary${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    addFood:    (body: {
      meal: string; food_name: string; brand?: string | null;
      quantity_g: number; calories_per_100g: number;
      protein_per_100g?: number; carbs_per_100g?: number;
      fat_per_100g?: number; fiber_per_100g?: number;
      log_date?: string
    }) => post<{ id: number; status: string; calories: number }>('/nutrition/diary', body),
    deleteFood: (id: number) => del<{ status: string }>('/nutrition/diary/' + id),
    searchFood:    (q: string) => get<FoodSearchResult[]>(`/nutrition/search?q=${encodeURIComponent(q)}`),
    lookupBarcode: (code: string) => get<FoodSearchResult>(`/nutrition/barcode/${encodeURIComponent(code)}`),
    suggest:    (date?: string) => get<SuggestResponse>(`/nutrition/suggest${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  },

  // Running
  running: {
    getProfile:  () => get<RunningProfile>('/running/profile'),
    getSuggest:  () => get<RunSuggestion>('/running/suggest'),
    getPlan:     (type: RunType, distance_km: number) =>
      get<RunPlan>(`/running/plan?type=${type}&distance_km=${distance_km}`),
    getLogs:     (limit = 30) => get<RunLog[]>(`/running/logs?limit=${limit}`),
    createLog:   (body: {
      type: RunType
      planned_distance_km?: number
      actual_distance_km?: number
      actual_duration_s?: number
      actual_avg_hr?: number
      notes?: string
    }) => post<{ id: number; status: string }>('/running/logs', body),
    deleteLog:   (id: number) => del<{ status: string }>('/running/logs/' + id),

    programs: {
      create: (body: {
        name: string
        race_date: string
        race_distance_km: number
        target_time_s?: number
        runs_per_week: number
      }) => post<{ id: number; name: string; race_date: string; race_distance_km: number; total_weeks: number; total_days: number }>(
        '/running/programs', body
      ),
      list:      () => get<TrainingProgram[]>('/running/programs'),
      getActive: () => get<ActiveProgram | null>('/running/programs/active'),
      calendar:  (start: string, end: string) =>
        get<PlanDay[]>(`/running/programs/calendar?start=${start}&end=${end}`),
      complete:  (programId: number, dayId: number) =>
        patch<{ status: string }>(`/running/programs/${programId}/days/${dayId}/complete`),
      delete:    (id: number) => del<{ status: string }>('/running/programs/' + id),
    },
  },
}

// ─── Training types ───────────────────────────────────────────────────────────

export interface TrainingExercise {
  id: number
  name: string
  category: string
  equipment: string
  is_custom?: number
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
  strength_strain: number
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

export interface DupRecommendation {
  phase: 'Hypertrophy' | 'Strength' | 'Power'
  sets: number
  reps_low: number
  reps_high: number
  weight_kg: number | null
  per_hand: boolean
  anchor_name: string | null
  anchor_1rm: number | null
  note: string
}

export interface FreshnesEntry {
  category: string
  muscles: string[]
  days_since: number | null
  status: 'today' | 'yesterday' | 'recovering' | 'ready' | 'overdue' | 'never'
  urgency: number
  recovery_target_days: number
}

export interface SmartSuggest {
  freshness: FreshnesEntry[]
  priority_categories: string[]
  this_week_categories: string[]
  suggested_workout: {
    name: string
    reason: string
    categories: string[]
    template: { id: number; name: string; exercises: TrainingExercise[] } | null
    exercises: TrainingExercise[]
  }
}

export interface LastPerformance {
  summary: string | null
  sets: { set_number: number; weight_kg: number | null; reps: number }[]
  session_date: string | null
  recommendation: DupRecommendation | null
}

// ─── Running types ────────────────────────────────────────────────────────────

export type RunType = 'long' | 'tempo' | 'interval' | 'recovery' | 'easy'

export interface PaceZone {
  pace_s_km:      number
  pace_low_s_km:  number
  pace_high_s_km: number
  label:          string
}

export interface RunningProfile {
  vdot:             number | null
  vdot_source:      string
  estimated_5k_s:   number | null
  pace_zones:       Partial<Record<RunType, PaceZone>>
  max_hr_observed:  number | null
  hr_zones:         Partial<Record<RunType, [number, number]>>
  weekly_km:        number
  weekly_runs:      number
  monthly_km:       number
  longest_run_km:   number
  total_runs_90d:   number
}

export interface RunSuggestion {
  type:                RunType
  reason:              string
  urgency:             'high' | 'medium' | 'low'
  coach_note:          string
  target_distance_km:  number
  pace_zone:           PaceZone | null
  hr_zone:             [number, number]
  workout_structure:   string
  meta:                { label: string; description: string; icon: string }
}

export interface RunPlan {
  type:                RunType
  distance_km:         number
  pace_zone:           PaceZone | null
  hr_zone:             [number, number]
  workout_structure:   string
  coach_note:          string
  description:         string
  basis:               string
  max_hr_used:         number | null
  vdot:                number | null
}

export interface RunLog {
  id:                   number
  type:                 string
  planned_distance_km:  number | null
  actual_distance_km:   number | null
  actual_duration_s:    number | null
  actual_avg_pace_s_km: number | null
  actual_avg_hr:        number | null
  notes:                string | null
  started_at:           string
  finished_at:          string | null
}

// ─── Training program types ───────────────────────────────────────────────────

export interface TrainingProgram {
  id:               number
  name:             string
  race_date:        string
  race_distance_km: number
  target_time_s:    number | null
  runs_per_week:    number
  created_at:       string
  active:           number
  total_days:       number
  completed_days:   number
}

export interface PlanDay {
  id:               number
  program_id:       number
  plan_date:        string
  week_number:      number
  phase:            'Base' | 'Build' | 'Peak' | 'Taper' | 'Race'
  run_type:         string
  distance_km:      number
  pace_target_s_km: number | null
  notes:            string | null
  completed:        number
  actual_log_id:    number | null
  program_name?:    string
  race_distance_km?: number
}

export interface ActiveProgram extends TrainingProgram {
  days_to_race:   number
  weeks_to_race:  number
  upcoming_days:  PlanDay[]
  last_completed: string | null
}

// ─── Nutrition types ──────────────────────────────────────────────────────────

export interface NutritionGoals {
  id:             number
  calories:       number
  protein_g:      number
  carbs_g:        number
  fat_g:          number
  goal_type:      string
  activity_level: string
  updated_at:     string | null
}

export interface FoodLogEntry {
  id:         number
  log_date:   string
  meal:       string
  food_name:  string
  brand:      string | null
  quantity_g: number
  calories:   number
  protein_g:  number
  carbs_g:    number
  fat_g:      number
  fiber_g:    number | null
  logged_at:  string
}

export interface DiaryTotals {
  calories:  number
  protein_g: number
  carbs_g:   number
  fat_g:     number
  fiber_g:   number
}

export interface CalorieBalance {
  goal:      number
  consumed:  number
  burned:    number
  remaining: number
}

export interface DiaryDay {
  date:             string
  meals:            Record<string, FoodLogEntry[]>
  totals:           DiaryTotals
  calorie_balance:  CalorieBalance
}

export interface FoodSearchResult {
  name:           string
  brand:          string | null
  serving_size_g: number
  calories_100g:  number
  protein_100g:   number
  carbs_100g:     number
  fat_100g:       number
  fiber_100g:     number
  image_url:      string | null
}

export interface FoodSuggestion {
  name:       string
  serving_g:  number
  calories:   number
  protein_g:  number
  carbs_g:    number
  fat_g:      number
  fiber_g:    number
  per_100g:   { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
  reason:     string
}

export interface SuggestResponse {
  date:        string
  remaining:   { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  suggestions: FoodSuggestion[]
}
