'use client'

import { useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Clock, Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonRing, SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDashboard } from '@/lib/hooks'
import { getGreeting, scoreColor, scoreLabel } from '@/lib/utils'

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

export default function OverviewPage() {
  const { data, loading, syncing, error, refresh } = useDashboard()
  const touchStartY = useRef(0)

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
        <button
          onClick={refresh}
          disabled={syncing}
          className="w-10 h-10 flex items-center justify-center rounded-full glass active:scale-95 transition-transform"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin text-white/60' : 'text-white/60'} />
        </button>
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
            <GlassCard>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Training Load</p>
                  <p className="text-sm text-white/70">Acute:Chronic Workload</p>
                </div>
                <ACWRBadge acwr={data.recovery.acwr} label={data.recovery.acwr_label} />
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
    </div>
  )
}
