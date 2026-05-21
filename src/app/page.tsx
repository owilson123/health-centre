'use client'

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, Clock, Zap, TrendingUp, TrendingDown, Minus, Settings, X, ChevronRight, Flame, Brain, Heart, Battery, Wind, Dumbbell, Bike, PersonStanding, Timer, Target, Moon, Activity } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonRing, SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDashboard } from '@/lib/hooks'
import { getGreeting, scoreColor, scoreLabel } from '@/lib/utils'
import type { RecoveryScore, StrainScore, WorkoutPrescription, SleepScore } from '@/lib/types'
import { SleepStageBar } from '@/components/charts/SleepStageBar'
import { formatDuration } from '@/lib/utils'

function CalorieArc({ current, predicted }: { current: number; predicted: number }) {
  const pct = Math.min(current / Math.max(predicted, 1), 1)
  const r = 52, sw = 8
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  return (
    <svg width="120" height="120" className="-rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
      <circle cx="60" cy="60" r={r} fill="none" stroke="url(#calGrad)" strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
      <defs>
        <linearGradient id="calGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function ACWRBadge({ acwr, label }: { acwr: number; label: string }) {
  const color = acwr > 1.5 ? '#ef4444' : acwr < 0.8 ? '#3b82f6' : '#22c55e'
  const Icon = acwr > 1.5 ? TrendingUp : acwr < 0.8 ? TrendingDown : Minus
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <Icon size={14} style={{ color }} />
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
      <span className="text-xs text-white/30">ACWR {acwr.toFixed(2)}</span>
    </div>
  )
}

function SleepModal({ sleep, onClose }: { sleep: SleepScore; onClose: () => void }) {
  const components = [
    { label: 'Duration',     value: sleep.components.duration,       color: '#6366f1' },
    { label: 'Efficiency',   value: sleep.components.efficiency,     color: '#8b5cf6' },
    { label: 'Deep Sleep',   value: sleep.components.deep_sleep,     color: '#4f46e5' },
    { label: 'REM Sleep',    value: sleep.components.rem_sleep,      color: '#7c3aed' },
    { label: 'Awake Time',   value: sleep.components.awake_penalty,  color: scoreColor(sleep.components.awake_penalty) },
    { label: 'HRV',          value: sleep.components.hrv,            color: '#3b82f6' },
    { label: 'Resting HR',   value: sleep.components.resting_hr,     color: '#ec4899' },
  ]

  const stats = [
    { icon: Clock,    label: 'Duration',     value: formatDuration(sleep.data.total_sleep_seconds),          color: 'text-indigo-400' },
    { icon: Activity, label: 'Efficiency',   value: `${Math.round(sleep.data.efficiency)}%`,                  color: 'text-violet-400' },
    { icon: Brain,    label: 'HRV',          value: sleep.data.hrv_overnight ? `${Math.round(sleep.data.hrv_overnight)} ms` : '—', color: 'text-blue-400' },
    { icon: Heart,    label: 'Resting HR',   value: sleep.data.resting_hr ? `${Math.round(sleep.data.resting_hr)} bpm` : '—', color: 'text-pink-400' },
  ]

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />

        <motion.div
          className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}>

          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="px-5 pb-12 pt-2 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Last night</p>
                <h2 className="text-xl font-bold">Sleep Analysis</h2>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 mt-1">
                <X size={14} className="text-white/60" />
              </button>
            </div>

            {/* Score hero */}
            <div className="rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-900/10 border border-indigo-500/20 p-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(99,102,241,0.15)' }}>
                <Moon size={28} className="text-indigo-400" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">Sleep score</p>
                <p className="text-4xl font-bold" style={{ color: scoreColor(sleep.score) }}>{sleep.score}</p>
                <p className="text-sm text-white/50 mt-0.5">{formatDuration(sleep.data.total_sleep_seconds)} total</p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="rounded-2xl bg-white/5 border border-white/8 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={12} className={color} />
                    <span className="text-xs text-white/40">{label}</span>
                  </div>
                  <span className="text-xl font-bold">{value}</span>
                </div>
              ))}
            </div>

            {/* Sleep stages */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Sleep Stages</p>
              <SleepStageBar data={sleep.data} />
            </div>

            {/* Component breakdown */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-4">Score Breakdown</p>
              <div className="space-y-3">
                {components.map(({ label, value, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-white/50 w-24 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${value}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-white/70 w-8 text-right">{Math.round(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Insight */}
            <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4">
              <p className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Insight</p>
              <p className="text-sm text-white/80 leading-relaxed">{sleep.insight}</p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

const STATUS_CONFIG = {
  'Overreaching': {
    color: '#ef4444',
    gradient: 'from-red-500/20 to-red-900/10',
    border: 'border-red-500/20',
    Icon: TrendingUp,
    headline: 'Training load is too high',
    description: 'Your recent training (last 7 days) is significantly higher than your 4-week average. This raises injury risk and impairs adaptation.',
    causes: [
      'You trained harder than normal this week',
      'Your chronic fitness base is still catching up',
      'Insufficient recovery between hard sessions',
    ],
    actions: [
      'Take 1–2 full rest days before your next hard session',
      'Keep intensity low — Zone 1–2 only for the next 3 days',
      'Prioritise 8+ hours of sleep to accelerate recovery',
      'Target strain well below your current level tomorrow',
    ],
  },
  'Detraining': {
    color: '#3b82f6',
    gradient: 'from-blue-500/20 to-blue-900/10',
    border: 'border-blue-500/20',
    Icon: TrendingDown,
    headline: 'Training load is too low',
    description: 'Your recent training is well below your usual level. Fitness adaptations require consistent progressive overload.',
    causes: [
      'Reduced training volume this week',
      'Extended rest or recovery period',
      'High chronic base from previous hard weeks',
    ],
    actions: [
      'Gradually increase training volume over 1–2 weeks',
      'Add a moderate workout today — aim for your target strain',
      'Avoid jumping back to full load — build up progressively',
      'Focus on quality sessions over quantity right now',
    ],
  },
  'On Track': {
    color: '#22c55e',
    gradient: 'from-green-500/20 to-green-900/10',
    border: 'border-green-500/20',
    Icon: Minus,
    headline: 'Training load is optimal',
    description: 'Your acute-to-chronic workload ratio sits in the sweet spot. You\'re building fitness without accumulating excessive fatigue.',
    causes: [
      'Consistent training volume over the past month',
      'Good balance between hard days and recovery',
      'Progressive overload applied sustainably',
    ],
    actions: [
      'Maintain your current training rhythm',
      'Continue hitting your daily target strain',
      'Don\'t skip rest days — they\'re part of the plan',
      'Monitor how your body feels and adjust if needed',
    ],
  },
}

function TrainingLoadModal({ recovery, onClose }: { recovery: RecoveryScore; onClose: () => void }) {
  const label = (recovery.acwr_label as keyof typeof STATUS_CONFIG) in STATUS_CONFIG
    ? recovery.acwr_label as keyof typeof STATUS_CONFIG
    : 'On Track'
  const cfg = STATUS_CONFIG[label]
  const { Icon } = cfg

  const recFactors = [
    { icon: Brain, label: 'HRV', value: recovery.components.hrv },
    { icon: Heart, label: 'Resting HR', value: recovery.components.resting_hr },
    { icon: Wind, label: 'Sleep', value: recovery.components.sleep },
    { icon: Battery, label: 'Body Battery', value: recovery.components.body_battery },
    { icon: Flame, label: 'Stress', value: recovery.components.stress },
  ]

  const acwrPct = Math.min((recovery.acwr / 2) * 100, 100)
  const optimalLeft = (0.8 / 2) * 100
  const optimalRight = (1.5 / 2) * 100

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="px-5 pb-10 pt-2 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Training Load</p>
                <h2 className="text-xl font-bold">Acute:Chronic Workload</h2>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 mt-1">
                <X size={14} className="text-white/60" />
              </button>
            </div>

            {/* Status card */}
            <div className={`rounded-2xl bg-gradient-to-br ${cfg.gradient} border ${cfg.border} p-4`}>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cfg.color}22` }}>
                  <Icon size={18} style={{ color: cfg.color }} />
                </div>
                <div>
                  <p className="font-bold text-base" style={{ color: cfg.color }}>{label}</p>
                  <p className="text-xs text-white/40">ACWR {recovery.acwr.toFixed(2)}</p>
                </div>
              </div>
              <p className="text-sm text-white/70 leading-relaxed">{cfg.headline}. {cfg.description}</p>
            </div>

            {/* ACWR gauge */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-4">Workload Ratio</p>
              <div className="relative h-3 rounded-full bg-white/10 overflow-hidden mb-2">
                {/* Optimal zone */}
                <div
                  className="absolute top-0 h-full rounded-full bg-green-500/25"
                  style={{ left: `${optimalLeft}%`, width: `${optimalRight - optimalLeft}%` }}
                />
                {/* Needle */}
                <motion.div
                  className="absolute top-0 w-3 h-3 rounded-full border-2 border-white"
                  style={{ backgroundColor: cfg.color, left: `calc(${acwrPct}% - 6px)` }}
                  initial={{ left: '50%' }}
                  animate={{ left: `calc(${acwrPct}% - 6px)` }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-xs text-white/30 mb-3">
                <span>0</span>
                <span className="text-green-400/60">Optimal 0.8–1.5</span>
                <span>2.0+</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2 rounded-xl bg-white/5">
                  <p className="text-xs text-white/40 mb-0.5">7-day load</p>
                  <p className="text-lg font-bold">{recovery.acute_load}</p>
                </div>
                <div className="text-center p-2 rounded-xl bg-white/5">
                  <p className="text-xs text-white/40 mb-0.5">4-week avg</p>
                  <p className="text-lg font-bold">{recovery.chronic_load}</p>
                </div>
              </div>
            </div>

            {/* What's causing it */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Contributing factors</p>
              <ul className="space-y-2">
                {cfg.causes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/60">
                    <span style={{ color: cfg.color }} className="mt-0.5 shrink-0">·</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recovery readiness breakdown */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Recovery readiness</p>
              <div className="space-y-3">
                {recFactors.map(({ icon: FactorIcon, label: fl, value }) => (
                  <div key={fl} className="flex items-center gap-3">
                    <FactorIcon size={14} className="text-white/30 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-white/50">{fl}</span>
                        <span className="text-xs font-semibold" style={{ color: scoreColor(value) }}>{Math.round(value)}</span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: scoreColor(value) }}
                          initial={{ width: 0 }}
                          animate={{ width: `${value}%` }}
                          transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How to improve */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">What to do</p>
              <ul className="space-y-3">
                {cfg.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                      style={{ backgroundColor: `${cfg.color}22`, color: cfg.color }}>
                      {i + 1}
                    </span>
                    <span className="text-sm text-white/70 leading-relaxed">{a}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Target strain */}
            <div className={`rounded-2xl bg-gradient-to-br ${cfg.gradient} border ${cfg.border} p-4 flex items-center justify-between`}>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">Recommended strain today</p>
                <p className="text-sm text-white/60">Based on your recovery score</p>
              </div>
              <div className="text-3xl font-bold" style={{ color: cfg.color }}>{recovery.target_strain}</div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

const WORKOUT_ICONS: Record<string, React.ElementType> = {
  run: PersonStanding,
  gym: Dumbbell,
  cycling: Bike,
}

const ZONE_COLORS: Record<string, string> = {
  'Zone 2': '#22c55e',
  'Zone 3': '#f59e0b',
  'Zone 2–3': '#84cc16',
  'Zone 4': '#ef4444',
}

function WorkoutCard({ w, accent }: { w: WorkoutPrescription; accent: string }) {
  const Icon = WORKOUT_ICONS[w.type] ?? Timer
  const zoneColor = ZONE_COLORS[w.zone] ?? '#f59e0b'
  return (
    <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accent}22` }}>
          <Icon size={17} style={{ color: accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{w.label}</p>
          <p className="text-xs text-white/40">{w.description}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-xl bg-white/5">
          <p className="text-xs text-white/40 mb-0.5">Duration</p>
          <p className="text-sm font-bold">{w.duration_minutes}m</p>
        </div>
        <div className="text-center p-2 rounded-xl bg-white/5">
          <p className="text-xs text-white/40 mb-0.5">Avg HR</p>
          <p className="text-sm font-bold">{w.avg_hr_bpm} <span className="text-xs font-normal text-white/40">bpm</span></p>
        </div>
        <div className="text-center p-2 rounded-xl bg-white/5">
          <p className="text-xs text-white/40 mb-0.5">Zone</p>
          <p className="text-sm font-bold" style={{ color: zoneColor }}>{w.zone}</p>
        </div>
      </div>
    </div>
  )
}

function StrainModal({ strain, onClose }: { strain: StrainScore; onClose: () => void }) {
  const accent = '#f59e0b'
  const remaining = strain.remaining_to_target

  const zoneData = [
    { label: 'Z1', minutes: strain.zones.zone1_minutes, color: '#3b82f6' },
    { label: 'Z2', minutes: strain.zones.zone2_minutes, color: '#22c55e' },
    { label: 'Z3', minutes: strain.zones.zone3_minutes, color: '#f59e0b' },
    { label: 'Z4', minutes: strain.zones.zone4_minutes, color: '#ef4444' },
    { label: 'Z5', minutes: strain.zones.zone5_minutes, color: '#7c3aed' },
  ]
  const maxZone = Math.max(...zoneData.map(z => z.minutes), 1)

  const breakdown = [
    { label: 'Workouts', value: strain.load_breakdown.activities, color: '#f59e0b' },
    { label: 'Steps', value: strain.load_breakdown.steps, color: '#22c55e' },
    { label: 'Active cals', value: strain.load_breakdown.calories, color: '#f97316' },
    { label: 'Stress', value: strain.load_breakdown.stress, color: '#a78bfa' },
  ]

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />

        <motion.div
          className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}>

          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="px-5 pb-12 pt-2 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Today</p>
                <h2 className="text-xl font-bold">Strain Breakdown</h2>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 mt-1">
                <X size={14} className="text-white/60" />
              </button>
            </div>

            {/* Score + target hero */}
            <div className="rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-900/10 border border-amber-500/20 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Current strain</p>
                  <p className="text-4xl font-bold" style={{ color: accent }}>{strain.score}</p>
                  <p className="text-sm text-white/50 mt-0.5">{strain.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Target</p>
                  <p className="text-4xl font-bold text-white/70">{strain.target}</p>
                  <p className="text-sm mt-0.5" style={{ color: remaining <= 0 ? '#22c55e' : accent }}>
                    {remaining <= 0 ? '✓ Target hit' : `${remaining} remaining`}
                  </p>
                </div>
              </div>
              {/* Progress bar */}
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full"
                  style={{ backgroundColor: remaining <= 0 ? '#22c55e' : accent }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((strain.score / Math.max(strain.target, 1)) * 100, 100)}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }} />
              </div>
            </div>

            {/* How target is calculated */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target size={13} className="text-white/40" />
                <p className="text-xs text-white/40 uppercase tracking-wider">How your target is set</p>
              </div>
              <p className="text-sm text-white/70 leading-relaxed mb-3">
                Your target strain is based on your <span className="text-white font-semibold">recovery score ({strain.target} target today)</span>.
                Higher recovery → higher target. Lower recovery → your body needs an easier day.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded-xl bg-white/5">
                  <p className="text-white/40 mb-1">Low recovery</p>
                  <p className="font-semibold text-blue-400">≤ 33</p>
                  <p className="text-white/30 mt-0.5">Rest day</p>
                </div>
                <div className="p-2 rounded-xl bg-white/5 border border-amber-500/20">
                  <p className="text-white/40 mb-1">Good recovery</p>
                  <p className="font-semibold text-amber-400">34–66</p>
                  <p className="text-white/30 mt-0.5">Moderate</p>
                </div>
                <div className="p-2 rounded-xl bg-white/5">
                  <p className="text-white/40 mb-1">Peak recovery</p>
                  <p className="font-semibold text-green-400">67–100</p>
                  <p className="text-white/30 mt-0.5">Push hard</p>
                </div>
              </div>
            </div>

            {/* Background load intelligence */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Daily life load</p>
              <div className="flex items-center justify-between mb-3">
                <div className="text-center flex-1">
                  <p className="text-xs text-white/40 mb-1">Today</p>
                  <p className="text-2xl font-bold text-white">{strain.background_today}</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="text-center flex-1">
                  <p className="text-xs text-white/40 mb-1">Your 30-day avg</p>
                  <p className="text-2xl font-bold text-white/50">{strain.background_baseline}</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="text-center flex-1">
                  <p className="text-xs text-white/40 mb-1">Exercise target</p>
                  <p className="text-2xl font-bold" style={{ color: accent }}>{strain.activity_target}</p>
                </div>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">
                Background load is {strain.load_breakdown.background_context}. Your exercise target
                is <span className="text-white font-semibold">{strain.activity_target}</span> strain
                ({strain.target} total − {strain.background_today} background).
              </p>
              <div className="space-y-2 mt-3">
                {breakdown.filter(b => b.value > 0).map(b => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="text-xs text-white/40 w-20 shrink-0">{b.label}</span>
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div className="h-full rounded-full"
                        style={{ backgroundColor: b.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(b.value / Math.max(strain.target, 1)) * 100}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut' }} />
                    </div>
                    <span className="text-xs text-white/50 w-5 text-right">{b.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Load breakdown — activities */}
            {strain.load_breakdown.activity_list.length > 0 && (
              <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Workouts today</p>
                <div className="space-y-2.5">
                  {strain.load_breakdown.activity_list.map((a, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />
                        <span className="text-sm text-white/70 truncate max-w-[150px]">{a.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        {a.avg_hr && <span>{a.avg_hr} bpm</span>}
                        <span>{formatDuration(a.duration_seconds)}</span>
                        <span className="font-bold text-amber-400 text-sm">{a.strain}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HR zone breakdown */}
            {zoneData.some(z => z.minutes > 0) && (
              <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-4">HR zones today</p>
                <div className="space-y-2">
                  {zoneData.map(z => (
                    <div key={z.label} className="flex items-center gap-3">
                      <span className="text-xs text-white/40 w-5">{z.label}</span>
                      <div className="flex-1 h-2.5 bg-white/10 rounded-full overflow-hidden">
                        <motion.div className="h-full rounded-full"
                          style={{ backgroundColor: z.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(z.minutes / maxZone) * 100}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut' }} />
                      </div>
                      <span className="text-xs text-white/50 w-10 text-right">{z.minutes}m</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workout prescriptions — calibrated to exercise gap */}
            {strain.exercise_remaining > 0 && strain.prescriptions.length > 0 && (
              <div>
                <div className="mb-3">
                  <p className="text-xs text-white/40 uppercase tracking-wider">To hit your exercise target</p>
                  <p className="text-xs text-white/30 mt-0.5">
                    {strain.exercise_remaining} strain still needed from exercise
                  </p>
                </div>
                <div className="space-y-3">
                  {strain.prescriptions.map((w, i) => (
                    <WorkoutCard key={i} w={w} accent={accent} />
                  ))}
                </div>
              </div>
            )}

            {strain.exercise_remaining <= 0 && (
              <div className="rounded-2xl bg-green-500/10 border border-green-500/20 p-4 text-center">
                <p className="text-green-400 font-semibold mb-1">Exercise target reached 🎯</p>
                <p className="text-sm text-white/50">You&apos;ve covered your exercise strain for today. Focus on recovery.</p>
              </div>
            )}

            {/* Insight */}
            <div className="rounded-2xl bg-white/5 border border-white/8 p-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Insight</p>
              <p className="text-sm text-white/70 leading-relaxed">{strain.insight}</p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function OverviewPage() {
  const router = useRouter()
  const { data, loading, syncing, error, refresh } = useDashboard()
  const touchStartY = useRef(0)
  const [showTrainingLoad, setShowTrainingLoad] = useState(false)
  const [showStrain, setShowStrain] = useState(false)
  const [showSleep, setShowSleep] = useState(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (dy > 80 && window.scrollY === 0) refresh()
  }, [refresh])

  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }
  const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

  return (
    <div
      className="min-h-screen px-4 pt-[env(safe-area-inset-top)]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between py-5">
        <div>
          <p className="text-sm text-white/40">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-2xl font-bold mt-0.5">{getGreeting()}, Olly</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={syncing}
            className="w-10 h-10 flex items-center justify-center rounded-full glass active:scale-95 transition-transform"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin text-white/60' : 'text-white/60'} />
          </button>
          <button
            onClick={() => router.push('/settings')}
            className="w-10 h-10 flex items-center justify-center rounded-full glass active:scale-95 transition-transform"
          >
            <Settings size={16} className="text-white/60" />
          </button>
        </div>
      </div>


{error && (
        <div className="glass-card p-4 mb-4 border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="flex justify-around py-6">
            <SkeletonRing />
            <SkeletonRing />
            <SkeletonRing />
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !data ? (
        <EmptyState />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 pb-6">
          {/* Score Rings */}
          <motion.div variants={item}>
            <GlassCard className="py-6">
              <div className="flex justify-around items-center">
                <button
                  className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
                  onClick={() => setShowSleep(true)}
                >
                  <ScoreRing score={data.sleep.score} size={100} strokeWidth={8} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Sleep</div>
                    <div className="text-xs mt-0.5" style={{ color: scoreColor(data.sleep.score) }}>{scoreLabel(data.sleep.score)}</div>
                  </div>
                </button>
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={data.recovery.score} size={120} strokeWidth={10} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Recovery</div>
                    <div className="text-xs mt-0.5" style={{ color: scoreColor(data.recovery.score) }}>{scoreLabel(data.recovery.score)}</div>
                  </div>
                </div>
                <button
                  className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
                  onClick={() => setShowStrain(true)}
                >
                  <ScoreRing score={data.strain.score} size={100} strokeWidth={8} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Strain</div>
                    <div className="text-xs mt-0.5 text-white/40">Target {data.strain.target}</div>
                  </div>
                </button>
              </div>
            </GlassCard>
          </motion.div>

          {/* Insights */}
          <motion.div variants={item} className="grid grid-cols-1 gap-3">
            <GlassCard>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Sleep insight</p>
              <p className="text-sm text-white/80 leading-relaxed">{data.sleep.insight}</p>
            </GlassCard>
            <GlassCard>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Recovery insight</p>
              <p className="text-sm text-white/80 leading-relaxed">{data.recovery.insight}</p>
            </GlassCard>
          </motion.div>

          {/* Calories */}
          <motion.div variants={item}>
            <GlassCard>
              <div className="flex items-center gap-4">
                <div className="relative flex items-center justify-center">
                  <CalorieArc current={data.calories.total_burned} predicted={data.calories.predicted_total} />
                  <div className="absolute flex flex-col items-center">
                    <span className="text-base font-bold">{Math.round(data.calories.total_burned)}</span>
                    <span className="text-[10px] text-white/40">kcal</span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Calories</p>
                  <p className="text-2xl font-bold">{Math.round(data.calories.total_burned)}</p>
                  <p className="text-sm text-white/40">of {Math.round(data.calories.predicted_total)} predicted</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Zap size={12} className="text-amber-400" />
                    <span className="text-xs text-white/50">{Math.round(data.calories.active_calories)} active</span>
                    <span className="text-xs text-white/20">+</span>
                    <span className="text-xs text-white/50">{Math.round(data.calories.bmr_prorated)} BMR</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ACWR */}
          <motion.div variants={item}>
            <GlassCard
              className="cursor-pointer active:scale-[0.98] transition-transform"
              onClick={() => setShowTrainingLoad(true)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Training Load</p>
                  <p className="text-sm text-white/70">Acute:Chronic Workload</p>
                </div>
                <div className="flex items-center gap-2">
                  <ACWRBadge acwr={data.recovery.acwr} label={data.recovery.acwr_label} />
                  <ChevronRight size={14} className="text-white/20" />
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Last synced */}
          {data.last_synced && (
            <motion.div variants={item} className="flex items-center justify-center gap-1.5 py-2">
              <Clock size={11} className="text-white/20" />
              <span className="text-xs text-white/20">
                Synced {new Date(data.last_synced).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </motion.div>
          )}
        </motion.div>
      )}

      {showSleep && data && (
        <SleepModal sleep={data.sleep} onClose={() => setShowSleep(false)} />
      )}
      {showTrainingLoad && data && (
        <TrainingLoadModal recovery={data.recovery} onClose={() => setShowTrainingLoad(false)} />
      )}
      {showStrain && data && (
        <StrainModal strain={data.strain} onClose={() => setShowStrain(false)} />
      )}
    </div>
  )
}
