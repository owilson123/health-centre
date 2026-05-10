'use client'

import { motion } from 'framer-motion'
import { Flame, Zap } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalorieHourlyChart } from '@/components/charts/CalorieHourlyChart'
import { CalorieSplitDonut } from '@/components/charts/CalorieSplitDonut'
import { useDashboard } from '@/lib/hooks'

function ProgressArc({ current, total }: { current: number; total: number }) {
  const pct = Math.min(current / Math.max(total, 1), 1)
  const r = 70, sw = 12, size = 160
  const circ = 2 * Math.PI * r
  const dash = circ * pct

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#calArcGrad)" strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
        <defs>
          <linearGradient id="calArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold">{Math.round(current)}</span>
        <span className="text-xs text-white/40">kcal burned</span>
        <span className="text-xs text-amber-400 mt-0.5">of {Math.round(total)}</span>
      </div>
    </div>
  )
}

export default function CaloriesPage() {
  const { data, loading } = useDashboard()
  const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }

  return (
    <div className="min-h-screen px-4 pt-[env(safe-area-inset-top)]">
      <div className="py-5">
        <div className="flex items-center gap-2 mb-1">
          <Flame size={16} className="text-amber-400" />
          <p className="text-sm text-white/40">Today</p>
        </div>
        <h1 className="text-2xl font-bold">Calories</h1>
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard className="h-48" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !data ? (
        <EmptyState title="No calorie data" description="Sync your Garmin to see your calorie breakdown." />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 pb-6">
          {/* Hero arc */}
          <motion.div variants={item}>
            <GlassCard className="flex flex-col items-center py-6">
              <ProgressArc current={data.calories.total_burned} total={data.calories.predicted_total} />
              <div className="grid grid-cols-3 gap-4 mt-4 w-full pt-4 border-t border-white/10">
                <div className="text-center">
                  <p className="text-xs text-white/40">Active</p>
                  <p className="text-lg font-bold text-amber-400">{Math.round(data.calories.active_calories)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-white/40">BMR (today)</p>
                  <p className="text-lg font-bold">{Math.round(data.calories.bmr_prorated)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-white/40">7-day avg</p>
                  <p className="text-lg font-bold">{Math.round(data.calories.weekly_avg)}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Hourly chart */}
          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Hourly burn today</p>
              </div>
              <CalorieHourlyChart data={data.calories.hourly_burn} />
            </GlassCard>
          </motion.div>

          {/* BMR vs Active split */}
          <motion.div variants={item}>
            <GlassCard>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">BMR vs Active split</p>
              <CalorieSplitDonut bmr={data.calories.bmr_prorated} active={data.calories.active_calories} />
            </GlassCard>
          </motion.div>

          {/* Activity breakdown */}
          {data.calories.activity_breakdown.length > 0 && (
            <motion.div variants={item}>
              <GlassCard>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Activity breakdown</p>
                <div className="space-y-3">
                  {data.calories.activity_breakdown.map((a, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-base">
                        {a.type === 'running' ? '🏃' : a.type === 'cycling' ? '🚴' : '⚡'}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{a.name}</p>
                        <div className="h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${(a.calories / Math.max(...data.calories.activity_breakdown.map(x => x.calories))) * 100}%` }}
                            transition={{ duration: 0.8, delay: i * 0.1 }}
                          />
                        </div>
                      </div>
                      <span className="text-sm font-semibold">{Math.round(a.calories)}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  )
}
