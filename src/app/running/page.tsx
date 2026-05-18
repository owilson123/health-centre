'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, X, Check, ChevronRight, Trash2, Clock,
  TrendingUp, Activity, Zap, Heart, MapPin, RotateCcw,
} from 'lucide-react'
import {
  api, RunType, RunningProfile, RunSuggestion, RunPlan, RunLog,
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
  return (
    <div className="space-y-1.5">
      {parts.map((part, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <div
            className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
              i === 0 ? 'bg-white/20' : i === parts.length - 1 ? 'bg-white/20' : TYPE_CONFIG[color]?.dot ?? 'bg-indigo-400'
            }`}
          />
          <p className="text-sm text-white/70 leading-snug">{part}</p>
        </div>
      ))}
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
    { label: 'VDOT', value: profile.vdot ? profile.vdot.toFixed(1) : '—', sub: 'fitness score', icon: TrendingUp, color: 'text-indigo-400' },
    { label: 'Est. 5K', value: est5kStr, sub: 'mm:ss', icon: Clock, color: 'text-orange-400' },
    { label: 'This week', value: `${profile.weekly_km}`, sub: 'km', icon: MapPin, color: 'text-emerald-400' },
    { label: 'Monthly', value: `${profile.monthly_km}`, sub: 'km', icon: Activity, color: 'text-blue-400' },
  ]

  return (
    <div className="px-4 mb-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-3">Fitness Overview</p>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ label, value, sub, icon: Icon, color }) => (
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
            <p className="text-xs text-white/30 mt-1 italic">"{run.notes}"</p>
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

// ─── Main Running Page ─────────────────────────────────────────────────────────

export default function RunningPage() {
  const [profile,    setProfile]    = useState<RunningProfile | null>(null)
  const [suggestion, setSuggestion] = useState<RunSuggestion | null>(null)
  const [logs,       setLogs]       = useState<RunLog[]>([])
  const [loading,    setLoading]    = useState(true)

  const [showNewRun,      setShowNewRun]      = useState(false)
  const [newRunType,      setNewRunType]      = useState<RunType | undefined>()
  const [suggestionLoading, setSuggestionLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s, l] = await Promise.all([
        api.running.getProfile(),
        api.running.getSuggest(),
        api.running.getLogs(20),
      ])
      setProfile(p)
      setSuggestion(s)
      setLogs(l)
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

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-28">
      {/* Header */}
      <div className="px-4 pt-14 pb-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-white/30 font-medium uppercase tracking-widest mb-1">Personal Coach</p>
            <h1 className="text-2xl font-bold tracking-tight">Running</h1>
          </div>
          <button
            onClick={() => openNewRun()}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 rounded-2xl text-sm font-bold text-black active:scale-95 transition-transform"
          >
            <Play size={13} />
            New Run
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3 px-4">
          <div className="h-52 bg-white/[0.04] rounded-3xl animate-pulse" />
          <div className="h-24 bg-white/[0.04] rounded-2xl animate-pulse" />
          <div className="h-16 bg-white/[0.04] rounded-2xl animate-pulse" />
        </div>
      ) : (
        <>
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
          {profile && <FitnessStats profile={profile} />}

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
                Refresh suggestion
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
    </div>
  )
}
