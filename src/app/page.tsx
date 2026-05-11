'use client'

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, Clock, Zap, TrendingUp, TrendingDown, Minus, Settings, LogOut, X, ChevronRight, Flame, Brain, Heart, Battery, Wind } from 'lucide-react'
import { api } from '@/lib/api'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonRing, SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDashboard } from '@/lib/hooks'
import { getGreeting, scoreColor, scoreLabel } from '@/lib/utils'
import type { RecoveryScore } from '@/lib/types'

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
    { icon: Brain, label: 'HRV', value: recovery.components.hrv, desc: 'Heart rate variability vs baseline' },
    { icon: Heart, label: 'Resting HR', value: recovery.components.resting_hr, desc: 'Resting heart rate vs baseline' },
    { icon: Wind, label: 'Sleep', value: recovery.components.sleep, desc: 'Last night\'s sleep quality' },
    { icon: Battery, label: 'Body Battery', value: recovery.components.body_battery, desc: 'Garmin body battery on wake' },
    { icon: Flame, label: 'Stress', value: recovery.components.stress, desc: 'Yesterday\'s stress level' },
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
                {recFactors.map(({ icon: FactorIcon, label: fl, value, desc }) => (
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

export default function OverviewPage() {
  const { data, loading, syncing, error, refresh } = useDashboard()
  const touchStartY = useRef(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showTrainingLoad, setShowTrainingLoad] = useState(false)

  const handleDisconnect = useCallback(async () => {
    await api.disconnectGarmin()
    window.location.reload()
  }, [])

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
            onClick={() => setShowSettings(s => !s)}
            className="w-10 h-10 flex items-center justify-center rounded-full glass active:scale-95 transition-transform"
          >
            <Settings size={16} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Settings drawer */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="glass-card p-4 mb-4"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 uppercase tracking-wider">Settings</p>
              <button onClick={() => setShowSettings(false)} className="text-white/30 active:text-white/60">
                <X size={16} />
              </button>
            </div>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-3 w-full p-3 rounded-xl bg-red-500/10 border border-red-500/20 active:bg-red-500/20 transition-colors"
            >
              <LogOut size={15} className="text-red-400" />
              <div className="text-left">
                <p className="text-sm font-medium text-red-400">Disconnect Garmin</p>
                <p className="text-xs text-white/30">Remove stored credentials and sign out</p>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={data.sleep.score} size={100} strokeWidth={8} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Sleep</div>
                    <div className="text-xs mt-0.5" style={{ color: scoreColor(data.sleep.score) }}>{scoreLabel(data.sleep.score)}</div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={data.recovery.score} size={120} strokeWidth={10} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Recovery</div>
                    <div className="text-xs mt-0.5" style={{ color: scoreColor(data.recovery.score) }}>{scoreLabel(data.recovery.score)}</div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={data.strain.score} size={100} strokeWidth={8} />
                  <div className="text-center">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-widest">Strain</div>
                    <div className="text-xs mt-0.5 text-white/40">Target {data.strain.target}</div>
                  </div>
                </div>
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

      {showTrainingLoad && data && (
        <TrainingLoadModal recovery={data.recovery} onClose={() => setShowTrainingLoad(false)} />
      )}
    </div>
  )
}
