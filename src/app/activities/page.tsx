'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, ChevronDown, ChevronUp, Heart, Flame, Timer, RefreshCw, AlertCircle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { HRZoneChart } from '@/components/charts/HRZoneChart'
import { useActivities } from '@/lib/hooks'
import { formatDuration, formatDistance, activityIcon, scoreColor } from '@/lib/utils'

function ActivityCard({ activity }: { activity: import('@/lib/types').Activity }) {
  const [open, setOpen] = useState(false)
  const icon = activityIcon(activity.type)
  const date = new Date(activity.date)

  return (
    <GlassCard className="!p-0 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 text-left active:bg-white/5 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-xl shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{activity.name}</p>
          <p className="text-xs text-white/40">
            {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}
            {formatDuration(activity.duration_seconds)}
            {activity.distance_meters ? ` · ${formatDistance(activity.distance_meters)}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-sm font-bold" style={{ color: scoreColor(activity.strain) }}>
            {Math.round(activity.strain)} strain
          </span>
          {activity.avg_hr && (
            <span className="text-xs text-white/40">{Math.round(activity.avg_hr)} bpm avg</span>
          )}
        </div>
        <div className="ml-1 text-white/30">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 space-y-3 border-t border-white/5">
              <div className="grid grid-cols-3 gap-2 pt-3">
                {[
                  { icon: Flame, label: 'Calories', value: `${Math.round(activity.calories)} kcal` },
                  { icon: Heart, label: 'Max HR', value: activity.max_hr ? `${activity.max_hr} bpm` : '—' },
                  { icon: Timer, label: 'Duration', value: formatDuration(activity.duration_seconds) },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="text-center">
                    <Icon size={14} className="text-white/30 mx-auto mb-1" />
                    <p className="text-xs text-white/40">{label}</p>
                    <p className="text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-2">HR Zones</p>
                <HRZoneChart zones={activity.hr_zones} />
              </div>
              {activity.training_effect != null && (
                <p className="text-xs text-white/40">
                  Training Effect: <span className="text-white/70 font-semibold">{activity.training_effect.toFixed(1)}</span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

export default function ActivitiesPage() {
  const { data, loading, error, refresh } = useActivities(30)
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }
  const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }

  return (
    <div className="min-h-screen px-4 pt-[env(safe-area-inset-top)]">
      <div className="py-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-green-400" />
            <p className="text-sm text-white/40">Last 30 days</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="p-2 text-white/30 active:text-white disabled:opacity-30"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <h1 className="text-2xl font-bold">Activities</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <AlertCircle size={28} className="text-red-400 opacity-60" />
          <p className="text-sm text-white/50">{error}</p>
          <button
            onClick={refresh}
            className="mt-1 px-5 py-2.5 bg-white/8 rounded-xl text-sm text-white/70 active:bg-white/12"
          >
            Try again
          </button>
        </div>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <EmptyState title="No activities" description="No Garmin activities found in the last 30 days." />
          <button
            onClick={refresh}
            className="mt-1 px-5 py-2.5 bg-white/8 rounded-xl text-sm text-white/70 active:bg-white/12"
          >
            Refresh
          </button>
        </div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-3 pb-6">
          {data.map(a => (
            <motion.div key={a.id} variants={item}>
              <ActivityCard activity={a} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}
