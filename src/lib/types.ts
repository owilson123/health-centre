export interface SleepData {
  date: string
  total_sleep_seconds: number
  efficiency: number
  deep_sleep_seconds: number
  rem_sleep_seconds: number
  light_sleep_seconds: number
  awake_seconds: number
  hrv_overnight: number | null
  resting_hr: number | null
  sleep_start: string
  sleep_end: string
}

export interface SleepScore {
  score: number
  components: {
    duration: number
    efficiency: number
    deep_sleep: number
    rem_sleep: number
    awake_penalty: number
    hrv: number
    resting_hr: number
  }
  insight: string
  data: SleepData
}

export interface RecoveryScore {
  score: number
  components: {
    hrv: number
    resting_hr: number
    sleep: number
    body_battery: number
    stress: number
  }
  acwr: number
  acwr_label: string
  acute_load: number
  chronic_load: number
  target_strain: number
  insight: string
}

export interface WorkoutPrescription {
  type: string
  label: string
  zone: string
  avg_hr_bpm: number
  duration_minutes: number
  strain: number
  description: string
}

export interface StrainScore {
  score: number
  target: number
  remaining_to_target: number
  zones: {
    zone1_minutes: number
    zone2_minutes: number
    zone3_minutes: number
    zone4_minutes: number
    zone5_minutes: number
  }
  insight: string
  label: string
  load_breakdown: {
    activities: number
    steps: number
    calories: number
    stress: number
    background_today: number
    background_baseline: number
    background_context: string
    activity_list: Array<{ name: string; type: string; strain: number; duration_seconds: number; avg_hr: number | null }>
  }
  prescriptions: WorkoutPrescription[]
  activity_target: number
  exercise_remaining: number
  background_baseline: number
  background_today: number
}

export interface CalorieData {
  bmr: number
  active_calories: number
  total_burned: number
  predicted_total: number
  weekly_avg: number
  hourly_burn: Array<{ hour: number; calories: number }>
  activity_breakdown: Array<{ name: string; calories: number; type: string }>
  bmr_prorated: number
}

export interface DashboardData {
  sleep: SleepScore
  recovery: RecoveryScore
  strain: StrainScore
  calories: CalorieData
  last_synced: string
  date: string
}

export interface Activity {
  id: number
  date: string
  type: string
  name: string
  duration_seconds: number
  distance_meters: number | null
  avg_hr: number | null
  max_hr: number | null
  calories: number
  strain: number
  training_effect: number | null
  hr_zones: {
    zone1: number
    zone2: number
    zone3: number
    zone4: number
    zone5: number
  }
}

export interface TrendDataPoint {
  date: string
  sleep: number | null
  recovery: number | null
  strain: number | null
  calories: number | null
  hrv: number | null
  resting_hr: number | null
  acwr: number | null
}
