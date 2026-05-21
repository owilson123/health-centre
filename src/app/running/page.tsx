'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, X, Trash2, Clock,
  TrendingUp, Activity, Zap, Heart, MapPin, RotateCcw,
  Trophy, ChevronRight, Calendar, CheckCircle,
} from 'lucide-react'
import {
  api, RunType, RunningProfile, RunSuggestion, RunPlan, RunLog,
  ActiveProgram, PlanDay,
} from '@/lib/api'

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtPace(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h) return `${h}h ${(m % 60).toString().padStart(2, '0')}m`
  return `${m}m ${(s % 60).toString().padStart(2, '0')}s`
}

function fmtDate(dt: string): string {
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function parseDuration(str: string): number | null {
  // Accept "45:30" (mm:ss), "1:23:45" (h:mm:ss), or plain minutes "45"
  const parts = str.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 1) return parts[0] * 60
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

// ─── Run type config ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  long:     { label: 'Long Run',  color: 'text-blue-300',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   dot: 'bg-blue-400' },
  tempo:    { label: 'Tempo',     color: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  interval: { label: 'Intervals', color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    dot: 'bg-red-400' },
  recovery: { label: 'Recovery',  color: 'text-emerald-300',bg: 'bg-emerald-500/15',border: 'border-emerald-500/30',dot: 'bg-emerald-400' },
  easy:     { label: 'Easy',      color: 'text-teal-300',   bg: 'bg-teal-500/15',   border: 'border-teal-500/30',   dot: 'bg-teal-400' },
}

const RUN_TYPES: RunType[] = ['long', 'tempo', 'interval', 'recovery']

const DEFAULT_DISTANCES: Record<RunType, number[]> = {
  long:     [12, 16, 20, 24],
  tempo:    [5,  8,  10, 12],
  interval: [5,  6,  8,  10],
  recovery: [4,  5,  6,  8],
  easy:     [5,  8,  10, 12],
}

// ─── PaceDisplay ──────────────────────────────────────────────────────────────

function PaceDisplay({ zone, color }: {
  zone: { label: string; pace_low_s_km: number; pace_high_s_km: number } | null
  color: string
}) {
  if (!zone) {
    return (
      <div className="text-center py-4">
        <p className="text-white/30 text-sm">Log more runs to unlock pace targets</p>
      </div>
    )
  }
  return (
    <div className="text-center">
      <div className={`text-4xl font-bold tabular-nums tracking-tight ${color}`}>
        {fmtPace(zone.pace_low_s_km)}
        <span className="text-2xl mx-1 opacity-60">–</span>
        {fmtPace(zone.pace_high_s_km)}
      </div>
      <p className="text-white/40 text-xs mt-1 font-medium tracking-wider">MIN / KM</p>
    </div>
  )
}

// ─── WorkoutStructure ─────────────────────────────────────────────────────────

function WorkoutStructure({ structure, color }: { structure: string; color: string }) {
  if (!structure) return null
  const parts = structure.split('→').map(s => s.trim()).filter(Boolean)

  // Detect warm-up / cool-down segments by keyword — these get a dim dot
  const isTransition = (s: string) => {
    const l = s.toLowerCase()
    return (
      l.includes('warm-up') || l.includes('warm up') || l.includes('cool-down') ||
      l.includes('cool down') || l.startsWith('walk')
    )
  }

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        const transition = isTransition(part)
        return (
          <div key={i} className={`flex items-start gap-2.5 ${transition ? 'opacity-60' : ''}`}>
            <div
              className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 flex-shrink-0 ${
                transition
                  ? 'bg-white/25'
                  : (TYPE_CONFIG[color]?.dot ?? 'bg-indigo-400')
              }`}
            />
            <p className={`text-sm leading-snug ${transition ? 'text-white/55' : 'text-white/80 font-medium'}`}>
              {part}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ─── Log Run Modal ────────────────────────────────────────────────────────────

function LogRunModal({
  runType,
  plannedDistance,
  onClose,
  onSaved,
}: {
  runType: RunType
  plannedDistance: number
  onClose: () => void
  onSaved: () => void
}) {
  const cfg = TYPE_CONFIG[runType]
  const [distance, setDistance] = useState(String(plannedDistance))
  const [duration, setDuration] = useState('')
  const [avgHr, setAvgHr]       = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const save = async () => {
    const distNum = parseFloat(distance)
    if (!distNum || distNum <= 0) { setError('Enter a valid distance'); return }
    const durSec = duration ? parseDuration(duration) : null
    if (duration && !durSec) { setError('Enter duration as mm:ss or hh:mm:ss'); return }
    setSaving(true)
    setError('')
    try {
      await api.running.createLog({
        type: runType,
        planned_distance_km: plannedDistance,
        actual_distance_km:  distNum,
        actual_duration_s:   durSec ?? undefined,
        actual_avg_hr:       avgHr ? parseInt(avgHr) : undefined,
        notes:               notes.trim() || undefined,
      })
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save run')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/80 flex items-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="w-full bg-[#141414] rounded-t-3xl border-t border-white/10"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.bg}`}>
              <span className="text-base">{runType === 'long' ? '🛣️' : runType === 'tempo' ? '🔥' : runType === 'interval' ? '⚡' : '🌿'}</span>
            </div>
            <div>
              <h3 className="text-base font-bold">Log {cfg.label}</h3>
              <p className="text-xs text-white/40">How did it go?</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs text-white/40 mb-1.5">Distance (km)</p>
              <input
                type="number" inputMode="decimal"
                value={distance} onChange={e => setDistance(e.target.value)}
                placeholder={String(plannedDistance)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              />
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1.5">Duration (mm:ss or h:mm:ss)</p>
              <input
                type="text" inputMode="numeric"
                value={duration} onChange={e => setDuration(e.target.value)}
                placeholder="e.g. 42:30"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              />
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1.5">Avg heart rate (optional)</p>
              <input
                type="number" inputMode="numeric"
                value={avgHr} onChange={e => setAvgHr(e.target.value)}
                placeholder="e.g. 155"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              />
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1.5">Notes (optional)</p>
              <input
                type="text"
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="How did it feel?"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className={`w-full mt-4 py-3.5 rounded-2xl text-sm font-bold disabled:opacity-50 ${cfg.bg} ${cfg.color} border ${cfg.border}`}
          >
            {saving ? 'Saving…' : 'Save Run'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── New Run Sheet ────────────────────────────────────────────────────────────

function NewRunSheet({
  onClose,
  initialType,
  onLogged,
}: {
  onClose: () => void
  initialType?: RunType
  onLogged: () => void
}) {
  const [type, setType]           = useState<RunType>(initialType ?? 'easy')
  const [distIdx, setDistIdx]     = useState(1)
  const [plan, setPlan]           = useState<RunPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [showLog, setShowLog]     = useState(false)

  const distances = DEFAULT_DISTANCES[type] ?? [5, 8, 10]
  const distance  = distances[Math.min(distIdx, distances.length - 1)]

  useEffect(() => {
    setPlanLoading(true)
    api.running.getPlan(type, distance)
      .then(setPlan)
      .catch(() => setPlan(null))
      .finally(() => setPlanLoading(false))
  }, [type, distance])

  const cfg = TYPE_CONFIG[type]

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/75 flex items-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full bg-[#111111] rounded-t-3xl border-t border-white/10 max-h-[92vh] flex flex-col"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          {/* Handle + header */}
          <div className="flex-shrink-0 px-5 pt-4 pb-0">
            <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">New Run</h3>
              <button onClick={onClose} className="p-2 text-white/40 active:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Run type selector */}
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {RUN_TYPES.map(t => {
                const c = TYPE_CONFIG[t]
                const active = type === t
                return (
                  <button
                    key={t}
                    onClick={() => { setType(t); setDistIdx(1) }}
                    className={`flex flex-col items-center gap-1 py-3 rounded-2xl border transition-all ${
                      active
                        ? `${c.bg} ${c.border} ${c.color}`
                        : 'bg-white/[0.04] border-white/8 text-white/40'
                    }`}
                  >
                    <span className="text-lg leading-none">
                      {t === 'long' ? '🛣️' : t === 'tempo' ? '🔥' : t === 'interval' ? '⚡' : '🌿'}
                    </span>
                    <span className="text-[10px] font-semibold tracking-wide">{c.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Distance selector */}
            <div className="flex gap-2 mb-4">
              {distances.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setDistIdx(i)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    distIdx === i
                      ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                      : 'bg-white/[0.04] border-white/8 text-white/35'
                  }`}
                >
                  {d} km
                </button>
              ))}
            </div>
          </div>

          {/* Plan content — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 pb-2">
            <AnimatePresence mode="wait">
              {planLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3 pt-2"
                >
                  <div className="h-24 bg-white/[0.04] rounded-2xl animate-pulse" />
                  <div className="h-16 bg-white/[0.04] rounded-2xl animate-pulse" />
                </motion.div>
              ) : plan ? (
                <motion.div
                  key={`${type}-${distance}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 pt-2"
                >
                  {/* Pace target */}
                  <div className={`rounded-2xl p-4 border ${cfg.bg} ${cfg.border}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${cfg.color}`}>
                      Target Pace
                    </p>
                    <PaceDisplay zone={plan.pace_zone} color={cfg.color} />

                    {plan.hr_zone && plan.hr_zone[0] > 0 && (
                      <div className="flex items-center justify-center gap-1.5 mt-3">
                        <Heart size={12} className="text-white/30" />
                        <span className="text-xs text-white/40">
                          {plan.hr_zone[0]}–{plan.hr_zone[1]} bpm
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Workout structure */}
                  {plan.workout_structure && (
                    <div className="bg-white/[0.04] rounded-2xl p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">
                        Workout Structure
                      </p>
                      <WorkoutStructure structure={plan.workout_structure} color={type} />
                    </div>
                  )}

                  {/* Coach note */}
                  <div className="bg-white/[0.03] rounded-2xl p-4 border border-white/[0.06]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2">
                      Coach Note
                    </p>
                    <p className="text-sm text-white/55 leading-relaxed">{plan.coach_note}</p>
                  </div>

                  {/* Basis */}
                  {plan.basis && (
                    <p className="text-[11px] text-white/25 text-center leading-relaxed px-2">
                      {plan.basis}
                    </p>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* CTA */}
          <div className="flex-shrink-0 px-5 pt-3 space-y-2">
            <button
              onClick={() => setShowLog(true)}
              className={`w-full py-4 rounded-2xl text-sm font-bold transition-all active:scale-98 ${cfg.bg} ${cfg.color} border ${cfg.border}`}
            >
              Log This Run
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Log modal */}
      <AnimatePresence>
        {showLog && (
          <LogRunModal
            runType={type}
            plannedDistance={distance}
            onClose={() => setShowLog(false)}
            onSaved={() => { setShowLog(false); onLogged(); onClose() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── SuggestionCard ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onStart,
}: {
  suggestion: RunSuggestion
  onStart: (type: RunType) => void
}) {
  const cfg = TYPE_CONFIG[suggestion.type]
  const urgencyColor =
    suggestion.urgency === 'high'   ? 'text-red-400' :
    suggestion.urgency === 'medium' ? 'text-orange-400' :
    'text-white/40'

  return (
    <div className="mx-4 mb-5">
      <div className={`rounded-3xl border overflow-hidden ${cfg.border}`}
           style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)' }}>

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">{suggestion.meta.icon}</span>
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${cfg.color}`}>
                  Coach Suggests
                </p>
                <h3 className="text-base font-bold text-white">{suggestion.meta.label}</h3>
              </div>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${urgencyColor}`}>
              {suggestion.urgency} priority
            </span>
          </div>
          <p className="text-sm text-white/50 leading-snug">{suggestion.reason}</p>
        </div>

        {/* Pace + HR */}
        {suggestion.pace_zone && (
          <div className="px-4 py-3 flex items-center gap-4 border-b border-white/[0.06]">
            <div className="flex-1">
              <p className="text-[10px] text-white/30 font-semibold uppercase tracking-wider mb-0.5">Target Pace</p>
              <p className={`text-xl font-bold tabular-nums ${cfg.color}`}>
                {fmtPace(suggestion.pace_zone.pace_low_s_km)}
                <span className="text-sm opacity-60 mx-0.5">–</span>
                {fmtPace(suggestion.pace_zone.pace_high_s_km)}
                <span className="text-sm text-white/30 ml-1 font-normal">/km</span>
              </p>
            </div>
            {suggestion.hr_zone[0] > 0 && (
              <div>
                <p className="text-[10px] text-white/30 font-semibold uppercase tracking-wider mb-0.5">HR Zone</p>
                <div className="flex items-center gap-1">
                  <Heart size={12} className="text-red-400" />
                  <span className="text-sm font-semibold text-white">
                    {suggestion.hr_zone[0]}–{suggestion.hr_zone[1]}
                  </span>
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] text-white/30 font-semibold uppercase tracking-wider mb-0.5">Distance</p>
              <p className="text-sm font-semibold text-white">{suggestion.target_distance_km} km</p>
            </div>
          </div>
        )}

        {/* Workout structure preview */}
        {suggestion.workout_structure && (
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] text-white/25 font-semibold uppercase tracking-wider mb-2">Structure</p>
            <WorkoutStructure structure={suggestion.workout_structure} color={suggestion.type} />
          </div>
        )}

        {/* CTA */}
        <div className="px-4 py-3">
          <button
            onClick={() => onStart(suggestion.type)}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all active:scale-98 ${cfg.bg} ${cfg.color} border ${cfg.border}`}
          >
            <Play size={14} />
            Start {suggestion.meta.label}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── FitnessStats ─────────────────────────────────────────────────────────────

function FitnessStats({ profile }: { profile: RunningProfile }) {
  const est5kStr = profile.estimated_5k_s
    ? `${Math.floor(profile.estimated_5k_s / 60)}:${(profile.estimated_5k_s % 60).toString().padStart(2, '0')}`
    : '—'

  const stats = [
    { label: 'VDOT', value: profile.vdot ? profile.vdot.toFixed(1) : '—', icon: TrendingUp, color: 'text-indigo-400' },
    { label: 'Est. 5K', value: est5kStr, icon: Clock, color: 'text-orange-400' },
    { label: 'This week', value: `${profile.weekly_km} km`, icon: MapPin, color: 'text-emerald-400' },
    { label: 'Monthly', value: `${profile.monthly_km} km`, icon: Activity, color: 'text-blue-400' },
  ]

  return (
    <div className="px-4 mb-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-3">Fitness Overview</p>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white/[0.04] rounded-2xl p-3 text-center border border-white/[0.06]">
            <Icon size={13} className={`mx-auto mb-1.5 ${color}`} />
            <p className="text-base font-bold text-white leading-none">{value}</p>
            <p className="text-[9px] text-white/30 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {!profile.vdot && (
        <div className="mt-3 p-3 bg-white/[0.03] rounded-2xl border border-white/[0.06]">
          <p className="text-xs text-white/40 text-center leading-relaxed">
            Sync your Garmin or log a run to unlock personalised pace targets based on your fitness level.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── RunHistoryCard ───────────────────────────────────────────────────────────

function RunHistoryCard({
  run,
  onDelete,
}: {
  run: RunLog
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cfg = TYPE_CONFIG[run.type] ?? TYPE_CONFIG.easy

  const pace = run.actual_avg_pace_s_km
  const dist = run.actual_distance_km

  return (
    <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
          <span className="text-sm">
            {run.type === 'long' ? '🛣️' : run.type === 'tempo' ? '🔥' : run.type === 'interval' ? '⚡' : '🌿'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
            <span className="text-[10px] text-white/25">{fmtDate(run.started_at)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {dist && <span className="text-sm font-semibold text-white">{dist.toFixed(1)} km</span>}
            {pace && (
              <span className="text-xs text-white/50 flex items-center gap-1">
                <Zap size={10} />
                {fmtPace(pace)}/km
              </span>
            )}
            {run.actual_duration_s && (
              <span className="text-xs text-white/50 flex items-center gap-1">
                <Clock size={10} />
                {fmtDuration(run.actual_duration_s)}
              </span>
            )}
            {run.actual_avg_hr && (
              <span className="text-xs text-white/50 flex items-center gap-1">
                <Heart size={10} />
                {run.actual_avg_hr} bpm
              </span>
            )}
          </div>
          {run.notes && (
            <p className="text-xs text-white/30 mt-1 italic">&ldquo;{run.notes}&rdquo;</p>
          )}
        </div>
        <button
          onClick={() => {
            if (confirmDelete) { onDelete(); return }
            setConfirmDelete(true)
            setTimeout(() => setConfirmDelete(false), 3000)
          }}
          className={`p-1.5 transition-colors flex-shrink-0 ${confirmDelete ? 'text-red-400' : 'text-white/20 active:text-red-400'}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── PaceZoneGuide ────────────────────────────────────────────────────────────

function PaceZoneGuide({ profile }: { profile: RunningProfile }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mx-4 mb-5">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between py-1 mb-2"
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">Pace Zones</p>
        <RotateCcw size={12} className={`text-white/20 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              {(Object.entries(TYPE_CONFIG) as [RunType, typeof TYPE_CONFIG[string]][])
                .filter(([t]) => t !== 'easy')
                .map(([rtype, cfg]) => {
                  const pz = profile.pace_zones?.[rtype]
                  const hr = profile.hr_zones?.[rtype]
                  return (
                    <div key={rtype} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                      <div className={`w-1.5 h-8 rounded-full ${cfg.dot}`} />
                      <div className="flex-1">
                        <p className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
                        {pz ? (
                          <p className="text-sm font-bold text-white">{pz.label}</p>
                        ) : (
                          <p className="text-xs text-white/30">Log runs to unlock</p>
                        )}
                      </div>
                      {hr && hr[0] > 0 && (
                        <div className="text-right">
                          <p className="text-[10px] text-white/30">HR</p>
                          <p className="text-xs font-semibold text-white">{hr[0]}–{hr[1]}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── VDOT info tooltip ────────────────────────────────────────────────────────

function VdotInfo({ vdot, est5kS }: { vdot: number; est5kS: number }) {
  const [open, setOpen] = useState(false)
  const m = Math.floor(est5kS / 60)
  const s = est5kS % 60
  const pacePerKm = Math.round(est5kS / 5)
  const pm = Math.floor(pacePerKm / 60)
  const ps = pacePerKm % 60

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-indigo-400/70 underline underline-offset-2 decoration-dotted"
      >
        How is this calculated?
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/80 flex items-end"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="w-full bg-[#131313] rounded-t-3xl border-t border-white/10 px-5 pt-5 pb-8"
            >
              <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <TrendingUp size={16} className="text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Your 5K Prediction</h3>
                  <p className="text-xs text-white/40">Based on Jack Daniels VDOT methodology</p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-white/60 leading-relaxed">
                <p>
                  <span className="text-white font-semibold">VDOT {vdot.toFixed(1)}</span> is your aerobic capacity
                  score, derived from your best-effort run in the last 30 days. It&apos;s a proxy for VO₂max
                  that accounts for running economy — not just raw oxygen uptake.
                </p>
                <p>
                  A 5K is typically run at <span className="text-white">~97% of your VO₂max</span>.
                  Working backwards from your VDOT, this gives an estimated 5K pace of{' '}
                  <span className="text-orange-400 font-semibold">{pm}:{ps.toString().padStart(2,'0')} /km</span>,
                  predicting a finish time of{' '}
                  <span className="text-orange-400 font-semibold">{m}:{s.toString().padStart(2,'0')}</span>.
                </p>
                <p>
                  All your training paces (easy, tempo, intervals) are calculated from the same VDOT
                  using Jack Daniels&apos; scientifically validated percentages. This ensures every session
                  is calibrated to your current fitness.
                </p>
                <p className="text-white/35 text-xs">
                  Pacing is based on your last 30 days of running. The more quality efforts you log,
                  the more accurate your predictions become.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Active program card ──────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  Base:  'text-emerald-400',
  Build: 'text-orange-400',
  Peak:  'text-red-400',
  Taper: 'text-blue-400',
  Race:  'text-yellow-400',
}
const PHASE_BG: Record<string, string> = {
  Base:  'bg-emerald-500/10 border-emerald-500/20',
  Build: 'bg-orange-500/10 border-orange-500/20',
  Peak:  'bg-red-500/10 border-red-500/20',
  Taper: 'bg-blue-500/10 border-blue-500/20',
  Race:  'bg-yellow-500/10 border-yellow-500/20',
}
const RUN_TYPE_EMOJI: Record<string, string> = {
  easy:     '🏃',
  long:     '🛣️',
  tempo:    '🔥',
  interval: '⚡',
  recovery: '🌿',
  race:     '🏆',
}

function ActiveProgramCard({
  program,
  onDelete,
  onCompleteDay,
  onNewRun,
}: {
  program: ActiveProgram
  onDelete: () => void
  onCompleteDay: (dayId: number) => void
  onNewRun: (type: RunType) => void
}) {
  const [showPlan, setShowPlan]       = useState(false)
  const [confirmDel, setConfirmDel]   = useState(false)
  const progressPct = program.total_days > 0
    ? Math.round((program.completed_days / program.total_days) * 100)
    : 0

  const todayStr = new Date().toISOString().split('T')[0]
  const todayDay = program.upcoming_days.find(d => d.plan_date === todayStr)
  const nextDays  = program.upcoming_days.filter(d => d.plan_date > todayStr).slice(0, 4)

  return (
    <div className="mx-4 mb-5">
      <div className="rounded-3xl border border-white/10 overflow-hidden"
           style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)' }}>

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
                <Trophy size={16} className="text-yellow-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-400/80 mb-0.5">
                  Active Program
                </p>
                <h3 className="text-sm font-bold text-white leading-tight">{program.name}</h3>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-bold text-white">{program.days_to_race}d</p>
              <p className="text-[10px] text-white/35">to race</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white/35">{program.completed_days} / {program.total_days} sessions done</span>
              <span className="text-[10px] font-bold text-white/50">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Today's session */}
        {todayDay && (
          <div className={`px-4 py-3 border-b border-white/[0.06] ${PHASE_BG[todayDay.phase] || 'bg-white/[0.03] border-white/10'}`}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Today</p>
            <div className="flex items-center gap-3">
              <span className="text-xl">{RUN_TYPE_EMOJI[todayDay.run_type] || '🏃'}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${PHASE_COLORS[todayDay.phase] || 'text-white'}`}>
                    {TYPE_CONFIG[todayDay.run_type as RunType]?.label ?? todayDay.run_type}
                  </span>
                  <span className="text-xs text-white/40">{todayDay.distance_km} km</span>
                  {todayDay.pace_target_s_km && (
                    <span className="text-xs text-white/30">@ {fmtPace(todayDay.pace_target_s_km)} /km</span>
                  )}
                </div>
                {todayDay.notes && (
                  <p className="text-xs text-white/40 mt-0.5 leading-snug">{todayDay.notes}</p>
                )}
              </div>
              <button
                onClick={() => onNewRun(todayDay.run_type as RunType)}
                className="flex items-center gap-1 px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 rounded-xl text-xs font-bold text-orange-300 active:bg-orange-500/35 flex-shrink-0"
              >
                <Play size={11} />
                Go
              </button>
            </div>
          </div>
        )}

        {/* Upcoming days */}
        {nextDays.length > 0 && (
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2">Upcoming</p>
            <div className="space-y-1.5">
              {nextDays.map(d => {
                const [y, mo, dy] = d.plan_date.split('-').map(Number)
                const dateLabel = new Date(y, mo - 1, dy).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                return (
                  <div key={d.id} className="flex items-center gap-2.5">
                    <span className="text-sm w-5 text-center">{RUN_TYPE_EMOJI[d.run_type] || '🏃'}</span>
                    <span className="text-xs text-white/50 w-20 flex-shrink-0">{dateLabel}</span>
                    <span className={`text-xs font-semibold ${PHASE_COLORS[d.phase] || 'text-white/60'}`}>
                      {TYPE_CONFIG[d.run_type as RunType]?.label ?? d.run_type}
                    </span>
                    <span className="text-xs text-white/30 ml-auto">{d.distance_km} km</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => setShowPlan(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-white/[0.05] border border-white/10 rounded-xl text-xs font-semibold text-white/60 active:bg-white/10"
          >
            <Calendar size={12} />
            Full Plan
          </button>
          <button
            onClick={() => {
              if (confirmDel) { onDelete(); return }
              setConfirmDel(true)
              setTimeout(() => setConfirmDel(false), 3000)
            }}
            className={`p-2.5 rounded-xl border text-xs font-semibold transition-colors ${
              confirmDel
                ? 'bg-red-500/20 border-red-500/30 text-red-400'
                : 'bg-white/[0.04] border-white/10 text-white/30'
            }`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Full plan sheet */}
      <AnimatePresence>
        {showPlan && (
          <PlanSheet program={program} onClose={() => setShowPlan(false)} onCompleteDay={onCompleteDay} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Full plan sheet ──────────────────────────────────────────────────────────

function PlanSheet({
  program,
  onClose,
  onCompleteDay,
}: {
  program: ActiveProgram
  onClose: () => void
  onCompleteDay: (dayId: number) => void
}) {
  const [days, setDays]     = useState<PlanDay[]>([])
  const [loading, setLoading] = useState(true)
  const todayStr = new Date().toISOString().split('T')[0]

  // Group days by week
  useEffect(() => {
    // Load all plan days for this program via the calendar endpoint
    const start = new Date().toISOString().split('T')[0]
    const end   = program.race_date
    api.running.programs.calendar(start, end)
      .then(setDays)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [program.race_date])

  // Group by week
  const byWeek = days.reduce<Record<number, PlanDay[]>>((acc, d) => {
    ;(acc[d.week_number] ??= []).push(d)
    return acc
  }, {})

  const weekNums = Object.keys(byWeek).map(Number).sort((a, b) => a - b)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/80 flex items-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="w-full bg-[#111111] rounded-t-3xl border-t border-white/10 max-h-[90vh] flex flex-col"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold">{program.name}</h3>
              <p className="text-xs text-white/35">{program.weeks_to_race} weeks to race · {program.days_to_race} days</p>
            </div>
            <button onClick={onClose} className="p-2 text-white/40">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-24 bg-white/[0.04] rounded-2xl animate-pulse" />)}
            </div>
          ) : weekNums.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-12">No upcoming sessions in your plan.</p>
          ) : (
            <div className="space-y-5 pb-4">
              {weekNums.map(wk => {
                const wkDays = byWeek[wk].sort((a, b) => a.plan_date.localeCompare(b.plan_date))
                const phase  = wkDays[0]?.phase ?? 'Base'
                return (
                  <div key={wk}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${PHASE_COLORS[phase] || 'text-white/40'}`}>
                        Week {wk} — {phase}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {wkDays.map(d => {
                        const isToday    = d.plan_date === todayStr
                        const isPast     = d.plan_date < todayStr
                        const isDone     = d.completed === 1
                        const [y, mo, dy] = d.plan_date.split('-').map(Number)
                        const dateLabel  = new Date(y, mo - 1, dy).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                        return (
                          <div
                            key={d.id}
                            className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                              isDone    ? 'bg-emerald-500/8 border-emerald-500/15 opacity-60' :
                              isToday   ? 'bg-orange-500/10 border-orange-500/25' :
                              isPast    ? 'opacity-40 bg-white/[0.02] border-white/5' :
                              'bg-white/[0.04] border-white/[0.06]'
                            }`}
                          >
                            <span className="text-lg w-6 text-center flex-shrink-0">
                              {isDone ? '✅' : RUN_TYPE_EMOJI[d.run_type] || '🏃'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold ${
                                  isDone ? 'text-emerald-400' : PHASE_COLORS[d.phase] || 'text-white/70'
                                }`}>
                                  {TYPE_CONFIG[d.run_type as RunType]?.label ?? d.run_type}
                                </span>
                                <span className="text-[10px] text-white/30">{dateLabel}</span>
                                {isToday && (
                                  <span className="text-[9px] font-bold text-orange-400 bg-orange-500/15 px-1.5 py-0.5 rounded-full">TODAY</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-white/50">{d.distance_km} km</span>
                                {d.pace_target_s_km && (
                                  <span className="text-xs text-white/30">@ {fmtPace(d.pace_target_s_km)} /km</span>
                                )}
                              </div>
                            </div>
                            {!isDone && (isPast || isToday) && (
                              <button
                                onClick={() => onCompleteDay(d.id)}
                                className="p-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex-shrink-0"
                              >
                                <CheckCircle size={14} className="text-emerald-400" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── New Program Sheet ────────────────────────────────────────────────────────

const RACE_DISTANCES = [
  { label: '5K',           km: 5.0 },
  { label: '10K',          km: 10.0 },
  { label: 'Half Marathon', km: 21.1 },
  { label: 'Marathon',      km: 42.2 },
]

function NewProgramSheet({
  onClose,
  onCreated,
}: {
  onClose:   () => void
  onCreated: () => void
}) {
  const today = new Date()
  const minDate = new Date(today)
  minDate.setDate(minDate.getDate() + 28)   // at least 4 weeks away
  const minDateStr = minDate.toISOString().split('T')[0]

  const [name,         setName]         = useState('')
  const [raceDate,     setRaceDate]     = useState('')
  const [distIdx,      setDistIdx]      = useState(0)
  const [customDist,   setCustomDist]   = useState('')
  const [targetTime,   setTargetTime]   = useState('')
  const [runsPerWeek,  setRunsPerWeek]  = useState(4)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const selDist = distIdx < RACE_DISTANCES.length
    ? RACE_DISTANCES[distIdx].km
    : parseFloat(customDist) || 0

  // Auto-fill name
  useEffect(() => {
    const dist = distIdx < RACE_DISTANCES.length ? RACE_DISTANCES[distIdx].label : `${customDist}km`
    const yr   = raceDate ? ` ${raceDate.split('-')[0]}` : ''
    setName(`${dist} Training${yr}`)
  }, [distIdx, customDist, raceDate])

  const parseTargetTime = (): number | undefined => {
    if (!targetTime.trim()) return undefined
    const parts = targetTime.trim().split(':').map(Number)
    if (parts.some(isNaN)) return undefined
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return undefined
  }

  const handleCreate = async () => {
    if (!raceDate) { setError('Set your race date'); return }
    if (!selDist || selDist <= 0) { setError('Select a race distance'); return }
    setSaving(true)
    setError('')
    try {
      await api.running.programs.create({
        name:             name.trim() || 'Training Plan',
        race_date:        raceDate,
        race_distance_km: selDist,
        target_time_s:    parseTargetTime(),
        runs_per_week:    runsPerWeek,
      })
      onCreated()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create program')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/80 flex items-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="w-full bg-[#111111] rounded-t-3xl border-t border-white/10 max-h-[92vh] flex flex-col"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div className="flex-shrink-0 px-5 pt-4 pb-3">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-lg font-bold">New Training Program</h3>
              <p className="text-xs text-white/35">Expert running coach plan — built for you</p>
            </div>
            <button onClick={onClose} className="p-2 text-white/40"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-5">
          {/* Race distance */}
          <div>
            <p className="text-xs font-semibold text-white/40 mb-2">Race Distance</p>
            <div className="grid grid-cols-2 gap-2">
              {RACE_DISTANCES.map((d, i) => (
                <button
                  key={d.label}
                  onClick={() => setDistIdx(i)}
                  className={`py-3 rounded-xl border text-sm font-semibold transition-all ${
                    distIdx === i
                      ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                      : 'bg-white/[0.04] border-white/8 text-white/50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
              <button
                onClick={() => setDistIdx(RACE_DISTANCES.length)}
                className={`py-3 rounded-xl border text-sm font-semibold transition-all ${
                  distIdx === RACE_DISTANCES.length
                    ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                    : 'bg-white/[0.04] border-white/8 text-white/50'
                }`}
              >
                Other
              </button>
            </div>
            {distIdx === RACE_DISTANCES.length && (
              <input
                type="number" inputMode="decimal"
                value={customDist}
                onChange={e => setCustomDist(e.target.value)}
                placeholder="Distance in km"
                className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
              />
            )}
          </div>

          {/* Race date */}
          <div>
            <p className="text-xs font-semibold text-white/40 mb-2">Race Date</p>
            <input
              type="date"
              value={raceDate}
              min={minDateStr}
              onChange={e => setRaceDate(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25 [color-scheme:dark]"
            />
          </div>

          {/* Target time */}
          <div>
            <p className="text-xs font-semibold text-white/40 mb-1">Target Time <span className="text-white/25 font-normal">(optional)</span></p>
            <p className="text-[11px] text-white/25 mb-2">Format: mm:ss for 5K/10K · h:mm:ss for longer</p>
            <input
              type="text" inputMode="numeric"
              value={targetTime}
              onChange={e => setTargetTime(e.target.value)}
              placeholder="e.g. 25:00 or 1:55:00"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
            />
          </div>

          {/* Runs per week */}
          <div>
            <p className="text-xs font-semibold text-white/40 mb-2">Runs Per Week</p>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setRunsPerWeek(n)}
                  className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${
                    runsPerWeek === n
                      ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                      : 'bg-white/[0.04] border-white/8 text-white/50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-white/25 mt-1.5">
              {runsPerWeek <= 3 ? 'Great for beginners — quality over quantity.' :
               runsPerWeek <= 4 ? 'Balanced — the sweet spot for most runners.' :
               runsPerWeek <= 5 ? 'Intermediate — solid aerobic base required.' :
               'Advanced — suits runners with strong base mileage.'}
            </p>
          </div>

          {/* Program name */}
          <div>
            <p className="text-xs font-semibold text-white/40 mb-2">Program Name</p>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 5K Training 2026"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-white/25"
            />
          </div>

          {/* Expert methodology note */}
          <div className="bg-indigo-500/8 border border-indigo-500/15 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400/70 mb-2">Coach Methodology</p>
            <ul className="space-y-1">
              {[
                '80/20 polarised training — 80% easy, 20% quality',
                'VDOT-calibrated pace targets for every session',
                'Periodised phases: Base → Build → Peak → Taper',
                '3-week loading cycles with built-in recovery weeks',
                'Race-appropriate long run caps and taper protocol',
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-white/45">
                  <span className="text-indigo-400 mt-0.5 flex-shrink-0">·</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && <p className="px-5 text-xs text-red-400 py-1">{error}</p>}

        <div className="flex-shrink-0 px-5 pt-3">
          <button
            onClick={handleCreate}
            disabled={saving || !raceDate || !selDist}
            className="w-full py-4 rounded-2xl text-sm font-bold bg-orange-500/20 border border-orange-500/40 text-orange-300 disabled:opacity-40 active:bg-orange-500/30"
          >
            {saving ? 'Building your plan…' : 'Create Training Program'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Main Running Page ─────────────────────────────────────────────────────────

export default function RunningPage() {
  const [profile,       setProfile]       = useState<RunningProfile | null>(null)
  const [suggestion,    setSuggestion]    = useState<RunSuggestion | null>(null)
  const [logs,          setLogs]          = useState<RunLog[]>([])
  const [activeProgram, setActiveProgram] = useState<ActiveProgram | null | undefined>(undefined)
  const [loading,       setLoading]       = useState(true)

  const [showNewRun,         setShowNewRun]         = useState(false)
  const [showNewProgram,     setShowNewProgram]      = useState(false)
  const [newRunType,         setNewRunType]          = useState<RunType | undefined>()
  const [suggestionLoading,  setSuggestionLoading]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s, l, prog] = await Promise.all([
        api.running.getProfile(),
        api.running.getSuggest(),
        api.running.getLogs(20),
        api.running.programs.getActive().catch(() => null),
      ])
      setProfile(p)
      setSuggestion(s)
      setLogs(l)
      setActiveProgram(prog)
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const refreshSuggestion = () => {
    setSuggestionLoading(true)
    api.running.getSuggest()
      .then(setSuggestion)
      .catch(() => {})
      .finally(() => setSuggestionLoading(false))
  }

  const openNewRun = (type?: RunType) => {
    setNewRunType(type)
    setShowNewRun(true)
  }

  const handleDeleteLog = async (id: number) => {
    try {
      await api.running.deleteLog(id)
      setLogs(prev => prev.filter(l => l.id !== id))
    } catch {}
  }

  const handleDeleteProgram = async () => {
    if (!activeProgram) return
    try {
      await api.running.programs.delete(activeProgram.id)
      setActiveProgram(null)
    } catch {}
  }

  const handleCompleteDay = async (dayId: number) => {
    if (!activeProgram) return
    try {
      await api.running.programs.complete(activeProgram.id, dayId)
      // Refresh active program to update completion counts + upcoming list
      const updated = await api.running.programs.getActive().catch(() => null)
      setActiveProgram(updated)
    } catch {}
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-28">
      {/* Header */}
      <div className="px-4 pt-14 pb-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-white/30 font-medium uppercase tracking-widest mb-1">Personal Coach</p>
            <h1 className="text-2xl font-bold tracking-tight">Running</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openNewRun()}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 rounded-2xl text-sm font-bold text-black active:scale-95 transition-transform"
            >
              <Play size={13} />
              New Run
            </button>
          </div>
        </div>
      </div>

      {/* Training program banner — always shown, above the loading skeleton */}
      {!loading && !activeProgram && (
        <div className="px-4 mb-4">
          <button
            onClick={() => setShowNewProgram(true)}
            className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border active:scale-[0.98] transition-transform"
            style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.12) 0%, rgba(249,115,22,0.10) 100%)', borderColor: 'rgba(234,179,8,0.25)' }}
          >
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                 style={{ background: 'rgba(234,179,8,0.18)' }}>
              <Trophy size={20} className="text-yellow-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-bold text-white">Start a Training Program</p>
              <p className="text-xs text-white/45 mt-0.5">Race-specific plan · VDOT paced · Built by your coach</p>
            </div>
            <ChevronRight size={18} className="text-white/30 flex-shrink-0" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3 px-4">
          <div className="h-52 bg-white/[0.04] rounded-3xl animate-pulse" />
          <div className="h-24 bg-white/[0.04] rounded-2xl animate-pulse" />
          <div className="h-16 bg-white/[0.04] rounded-2xl animate-pulse" />
        </div>
      ) : (
        <>
          {/* Active training program */}
          {activeProgram && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <ActiveProgramCard
                program={activeProgram}
                onDelete={handleDeleteProgram}
                onCompleteDay={handleCompleteDay}
                onNewRun={openNewRun}
              />
            </motion.div>
          )}

          {/* Coach suggestion */}
          <AnimatePresence mode="wait">
            {suggestion && !suggestionLoading ? (
              <motion.div key="suggestion" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <SuggestionCard
                  suggestion={suggestion}
                  onStart={type => openNewRun(type)}
                />
              </motion.div>
            ) : suggestionLoading ? (
              <motion.div key="skel" className="mx-4 mb-5 h-52 bg-white/[0.04] rounded-3xl animate-pulse" />
            ) : null}
          </AnimatePresence>

          {/* Fitness stats */}
          {profile && (
            <div>
              <FitnessStats profile={profile} />
              {profile.vdot && profile.estimated_5k_s && (
                <div className="px-4 -mt-2 mb-4 text-center">
                  <VdotInfo vdot={profile.vdot} est5kS={profile.estimated_5k_s} />
                </div>
              )}
            </div>
          )}

          {/* Pace zone guide */}
          {profile && <PaceZoneGuide profile={profile} />}

          {/* Recent runs */}
          <div className="px-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">Recent Runs</p>
              <button
                onClick={refreshSuggestion}
                className="text-[10px] text-white/25 active:text-white/50 flex items-center gap-1"
              >
                <RotateCcw size={10} />
                Refresh
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-3xl mb-3">🏃</p>
                <p className="text-sm text-white/30 mb-1">No runs logged yet</p>
                <p className="text-xs text-white/20">
                  Start your first run or sync Garmin to see your history
                </p>
                <button
                  onClick={() => openNewRun()}
                  className="mt-4 px-5 py-2.5 bg-orange-500/20 border border-orange-500/30 rounded-xl text-sm font-semibold text-orange-300 active:bg-orange-500/30"
                >
                  Log a Run
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map(run => (
                  <RunHistoryCard
                    key={run.id}
                    run={run}
                    onDelete={() => handleDeleteLog(run.id)}
                  />
                ))}
              </div>
            )}
          </div>

        </>
      )}

      {/* New run sheet */}
      <AnimatePresence>
        {showNewRun && (
          <NewRunSheet
            initialType={newRunType}
            onClose={() => { setShowNewRun(false); setNewRunType(undefined) }}
            onLogged={() => { load(); setShowNewRun(false) }}
          />
        )}
      </AnimatePresence>

      {/* New program sheet */}
      <AnimatePresence>
        {showNewProgram && (
          <NewProgramSheet
            onClose={() => setShowNewProgram(false)}
            onCreated={() => { setShowNewProgram(false); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
