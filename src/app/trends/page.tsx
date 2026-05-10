'use client'

import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { ACWRChart } from '@/components/charts/ACWRChart'
import { useTrends } from '@/lib/hooks'

export default function TrendsPage() {
  const { data, loading } = useTrends()
  const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }

  return (
    <div className="min-h-screen px-4 pt-[env(safe-area-inset-top)]">
      <div className="py-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} className="text-green-400" />
          <p className="text-sm text-white/40">90 days</p>
        </div>
        <h1 className="text-2xl font-bold">Trends</h1>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} className="h-48" />)}
        </div>
      ) : !data?.length ? (
        <EmptyState title="No trend data" description="After 7+ days of syncing, your health trends will appear here." />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 pb-6">
          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Sleep Score</p>
              </div>
              <TrendLineChart data={data} dataKey="sleep" color="#6366f1" />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Recovery Score</p>
              </div>
              <TrendLineChart data={data} dataKey="recovery" color="#22c55e" />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Strain Score</p>
              </div>
              <TrendLineChart data={data} dataKey="strain" color="#f59e0b" />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Total Calories</p>
              </div>
              <TrendLineChart data={data} dataKey="calories" color="#d97706" />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">ACWR — Training Load Ratio</p>
                <p className="text-xs text-white/20 mt-0.5">Green zone: 0.8–1.5 optimal</p>
              </div>
              <ACWRChart data={data} />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">HRV Baseline</p>
              </div>
              <TrendLineChart data={data} dataKey="hrv" color="#3b82f6" />
            </GlassCard>
          </motion.div>

          <motion.div variants={item}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 pb-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Resting Heart Rate</p>
              </div>
              <TrendLineChart data={data} dataKey="resting_hr" color="#ec4899" invertGood />
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
