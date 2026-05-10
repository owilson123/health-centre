'use client'

import { motion } from 'framer-motion'
import { SleepData } from '@/lib/types'
import { formatDuration } from '@/lib/utils'

type SecondKey = 'deep_sleep_seconds' | 'rem_sleep_seconds' | 'light_sleep_seconds' | 'awake_seconds'

const stages: { key: SecondKey; label: string; color: string }[] = [
  { key: 'deep_sleep_seconds', label: 'Deep', color: '#4f46e5' },
  { key: 'rem_sleep_seconds', label: 'REM', color: '#7c3aed' },
  { key: 'light_sleep_seconds', label: 'Light', color: '#3b82f6' },
  { key: 'awake_seconds', label: 'Awake', color: '#ef4444' },
]

export function SleepStageBar({ data }: { data: SleepData }) {
  const total =
    (data.deep_sleep_seconds || 0) +
    (data.rem_sleep_seconds || 0) +
    (data.light_sleep_seconds || 0) +
    (data.awake_seconds || 0)

  if (!total) return null

  return (
    <div className="space-y-3">
      <div className="flex h-8 rounded-xl overflow-hidden gap-0.5">
        {stages.map(({ key, color }) => {
          const secs = data[key] || 0
          const pct = (secs / total) * 100
          if (pct < 1) return null
          return (
            <motion.div
              key={key}
              className="h-full rounded-sm"
              style={{ backgroundColor: color, width: `${pct}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {stages.map(({ key, label, color }) => {
          const secs = data[key] || 0
          const pct = Math.round((secs / total) * 100)
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-white/50">{label}</span>
              <span className="text-xs font-semibold">{formatDuration(secs)}</span>
              <span className="text-xs text-white/30">({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
