'use client'

import { motion } from 'framer-motion'
import { Moon, Clock, Activity, Heart, Brain } from 'lucide-react'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonCard, SkeletonRing } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SleepTrendChart } from '@/components/charts/SleepTrendChart'
import { SleepStageBar } from '@/components/charts/SleepStageBar'
import { useDashboard } from '@/lib/hooks'
import { formatDuration, scoreColor } from '@/lib/utils'

function ComponentBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-white/50 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="text-xs font-semibold text-white/70 w-8 text-right">{Math.round(value)}</span>
    </div>
  )
}

export default function SleepPage() {
  const { data, loading } = useDashboard()
  const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }

  return (
    <div className="min-h-screen px-4 pt-[env(safe-area-inset-top)]">
      <div className="py-5">
        <div className="flex items-center gap-2 mb-1">
          <Moon size={16} className="text-indigo-400" />
          <p className="text-sm text-white/40">Last night</p>
        </div>
        <h1 className="text-2xl font-bold">Sleep</h1>
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonRing size={160} />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !data ? (
        <EmptyState title="No sleep data" description="Connect your Garmin to see your sleep analysis." />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 pb-6">
          {/* Hero ring */}
          <motion.div variants={item} className="flex justify-center py-4">
            <ScoreRing score={data.sleep.score} size={160} strokeWidth={12} />
          </motion.div>

          {/* Sleep stage timeline */}
          <motion.div variants={item}>
            <GlassCard>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Sleep Stages</p>
              <SleepStageBar data={data.sleep.data} />
            </GlassCard>
          </motion.div>

          {/* Key stats */}
          <motion.div variants={item} className="grid grid-cols-2 gap-3">
            {[
              { icon: Clock, label: 'Duration', value: formatDuration(data.sleep.data.total_sleep_seconds), color: 'text-indigo-400' },
              { icon: Activity, label: 'Efficiency', value: `${Math.round(data.sleep.data.efficiency)}%`, color: 'text-violet-400' },
              { icon: Brain, label: 'HRV', value: data.sleep.data.hrv_overnight ? `${Math.round(data.sleep.data.hrv_overnight)} ms` : '—', color: 'text-blue-400' },
              { icon: Heart, label: 'Resting HR', value: data.sleep.data.resting_hr ? `${Math.round(data.sleep.data.resting_hr)} bpm` : '—', color: 'text-pink-400' },
            ].map(({ icon: Icon, label, value, color }) => (
              <GlassCard key={label} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Icon size={13} className={color} />
                  <span className="text-xs text-white/40">{label}</span>
                </div>
                <span className="text-xl font-bold">{value}</span>
              </GlassCard>
            ))}
          </motion.div>

          {/* Component breakdown */}
          <motion.div variants={item}>
            <GlassCard>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-4">Score Breakdown</p>
              <div className="space-y-3">
                <ComponentBar label="Duration" value={data.sleep.components.duration} color={scoreColor(data.sleep.components.duration)} />
                <ComponentBar label="Efficiency" value={data.sleep.components.efficiency} color={scoreColor(data.sleep.components.efficiency)} />
                <ComponentBar label="Deep Sleep" value={data.sleep.components.deep_sleep} color="#6366f1" />
                <ComponentBar label="REM Sleep" value={data.sleep.components.rem_sleep} color="#8b5cf6" />
                <ComponentBar label="Awake Time" value={data.sleep.components.awake_penalty} color={scoreColor(data.sleep.components.awake_penalty)} />
                <ComponentBar label="HRV" value={data.sleep.components.hrv} color="#3b82f6" />
                <ComponentBar label="Resting HR" value={data.sleep.components.resting_hr} color="#ec4899" />
              </div>
            </GlassCard>
          </motion.div>

          {/* Trend chart */}
          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">30-Day Sleep Score</p>
              </div>
              <SleepTrendChart />
            </GlassCard>
          </motion.div>

          {/* Insight */}
          <motion.div variants={item}>
            <GlassCard className="border-indigo-500/20 bg-indigo-500/5">
              <p className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Insight</p>
              <p className="text-sm text-white/80 leading-relaxed">{data.sleep.insight}</p>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
