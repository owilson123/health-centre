'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, CalendarDays,
  Dumbbell, Zap, Timer, Plus, TrendingUp,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { api, SessionSummary } from '@/lib/api'
import { Activity, TrendDataPoint } from '@/lib/types'

// ─── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function mondayOf(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  return r
}

function fmtDuration(s: number): string {
  if (s <= 0) return '0m'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtDist(m: number | null): string | null {
  if (!m || m < 50) return null
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_SHORT   = ['M','T','W','T','F','S','S']
const DOW_FULL    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// ─── Activity type config ──────────────────────────────────────────────────────

interface TypeCfg {
  emoji: string
  label: string
  color: string
  bg: string
  border: string
}

const TYPE_MAP: Record<string, TypeCfg> = {
  running:                   { emoji:'🏃', label:'Run',       color:'#22c55e', bg:'bg-green-500/10',   border:'border-green-500/20'  },
  cycling:                   { emoji:'🚴', label:'Ride',      color:'#3b82f6', bg:'bg-blue-500/10',    border:'border-blue-500/20'   },
  cycling_transport:         { emoji:'🚴', label:'Ride',      color:'#3b82f6', bg:'bg-blue-500/10',    border:'border-blue-500/20'   },
  swimming:                  { emoji:'🏊', label:'Swim',      color:'#06b6d4', bg:'bg-cyan-500/10',    border:'border-cyan-500/20'   },
  strength_training:         { emoji:'🏋️', label:'Lift',      color:'#a78bfa', bg:'bg-violet-500/10',  border:'border-violet-500/20' },
  gym_and_fitness_equipment: { emoji:'🏋️', label:'Gym',       color:'#a78bfa', bg:'bg-violet-500/10',  border:'border-violet-500/20' },
  functional_training:       { emoji:'🏋️', label:'Functional',color:'#a78bfa', bg:'bg-violet-500/10',  border:'border-violet-500/20' },
  weightlifting:             { emoji:'🏋️', label:'Lift',      color:'#a78bfa', bg:'bg-violet-500/10',  border:'border-violet-500/20' },
  crossfit:                  { emoji:'🏋️', label:'CrossFit',  color:'#f97316', bg:'bg-orange-500/10',  border:'border-orange-500/20' },
  hiking:                    { emoji:'🥾', label:'Hike',      color:'#f59e0b', bg:'bg-amber-500/10',   border:'border-amber-500/20'  },
  yoga:                      { emoji:'🧘', label:'Yoga',      color:'#ec4899', bg:'bg-pink-500/10',    border:'border-pink-500/20'   },
  walking:                   { emoji:'🚶', label:'Walk',      color:'#84cc16', bg:'bg-lime-500/10',    border:'border-lime-500/20'   },
  indoor_rowing:             { emoji:'🚣', label:'Row',       color:'#06b6d4', bg:'bg-cyan-500/10',    border:'border-cyan-500/20'   },
  elliptical:                { emoji:'⚡', label:'Elliptical',color:'#6366f1', bg:'bg-indigo-500/10',  border:'border-indigo-500/20' },
}
const DEFAULT_CFG: TypeCfg = { emoji:'⚡', label:'Activity', color:'#6366f1', bg:'bg-indigo-500/10', border:'border-indigo-500/20' }

function typeCfg(type: string): TypeCfg {
  return TYPE_MAP[type.toLowerCase()] ?? DEFAULT_CFG
}

// ─── Zone bar ──────────────────────────────────────────────────────────────────

const ZONE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#f97316', '#ef4444']

function ZoneBar({ zones }: { zones: Activity['hr_zones'] }) {
  const total = zones.zone1 + zones.zone2 + zones.zone3 + zones.zone4 + zones.zone5
  if (total < 30) return null
  const entries = [zones.zone1, zones.zone2, zones.zone3, zones.zone4, zones.zone5]
  return (
    <div className="flex gap-px mt-2.5 h-1.5 rounded-full overflow-hidden">
      {entries.map((s, i) => {
        const pct = (s / total) * 100
        if (pct < 1) return null
        return (
          <div key={i} style={{ width: `${pct}%`, backgroundColor: ZONE_COLORS[i] }} />
        )
      })}
    </div>
  )
}

// ─── Activity card ─────────────────────────────────────────────────────────────

function ActivityCard({ act }: { act: Activity }) {
  const cfg = typeCfg(act.type)
  const dist = fmtDist(act.distance_meters)

  return (
    <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ backgroundColor: `${cfg.color}1a` }}
        >
          {cfg.emoji}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + strain */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white leading-tight">{act.name}</p>
            {act.strain > 0 && (
              <span className="text-xs font-bold flex-shrink-0" style={{ color: cfg.color }}>
                {Math.round(act.strain)} strain
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            <span className="text-xs text-white/45">{fmtDuration(act.duration_seconds)}</span>
            {dist && <span className="text-xs text-white/45">{dist}</span>}
            {act.avg_hr && <span className="text-xs text-white/45">avg {act.avg_hr} bpm</span>}
            {act.calories > 0 && <span className="text-xs text-white/45">{act.calories} kcal</span>}
          </div>

          <ZoneBar zones={act.hr_zones} />
        </div>
      </div>
    </div>
  )
}

// ─── Training session card ─────────────────────────────────────────────────────

function SessionCard({ s }: { s: SessionSummary }) {
  const mins = s.finished_at && s.started_at
    ? Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 60000)
    : 0

  return (
    <div className="rounded-2xl border bg-violet-500/8 border-violet-500/20 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 bg-violet-500/15">
          💪
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white leading-tight">{s.name}</p>
            {s.strength_strain > 0 && (
              <span className="text-xs font-bold text-violet-400 flex-shrink-0">
                {Math.round(s.strength_strain)} strain
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            {mins > 0   && <span className="text-xs text-white/45">{fmtDuration(mins * 60)}</span>}
            {s.exercise_count > 0 && <span className="text-xs text-white/45">{s.exercise_count} exercises</span>}
            {s.total_sets > 0     && <span className="text-xs text-white/45">{s.total_sets} sets</span>}
            {s.total_volume_kg > 0 && (
              <span className="text-xs text-white/45">{Math.round(s.total_volume_kg).toLocaleString()} kg vol</span>
            )}
          </div>

          <div className="mt-2">
            <span className="text-[10px] font-semibold text-violet-400/80 bg-violet-500/12 px-2 py-0.5 rounded-full">
              App session
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Score pill ────────────────────────────────────────────────────────────────

function ScorePill({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex items-center gap-1.5 bg-white/[0.04] rounded-xl px-2.5 py-1.5">
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-white/40 font-medium">{label}</span>
      <span className="text-[11px] font-bold" style={{ color }}>{Math.round(value)}</span>
    </div>
  )
}

// ─── Day detail panel ──────────────────────────────────────────────────────────

function DayDetail({
  dateStr, activities, sessions, trend, isToday, isFuture, onPlanWorkout,
}: {
  dateStr: string
  activities: Activity[]
  sessions: SessionSummary[]
  trend: TrendDataPoint | null
  isToday: boolean
  isFuture: boolean
  onPlanWorkout: () => void
}) {
  // Parse date safely (avoid timezone issues)
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const hasData = activities.length > 0 || sessions.length > 0
  const hasScores = trend && (trend.recovery !== null || trend.sleep !== null || trend.strain !== null)

  return (
    <motion.div
      key={dateStr}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* Day header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <h2 className="text-[15px] font-bold text-white">
            {DOW_FULL[d.getDay()]}, {d.getDate()} {MONTH_FULL[month - 1]}
          </h2>
          {isToday && (
            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 border border-indigo-500/25 px-2 py-0.5 rounded-full">
              TODAY
            </span>
          )}
        </div>

        {/* Score pills */}
        {hasScores && (
          <div className="flex flex-wrap gap-1.5">
            <ScorePill label="Recovery" value={trend!.recovery} color="#22c55e" />
            <ScorePill label="Sleep"    value={trend!.sleep}    color="#6366f1" />
            <ScorePill label="Strain"   value={trend!.strain}   color="#f59e0b" />
            {trend!.hrv && <ScorePill label="HRV" value={trend!.hrv} color="#06b6d4" />}
          </div>
        )}
      </div>

      {/* Content */}
      {!hasData && isFuture ? (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-3">
            <CalendarDays size={22} className="text-white/20" />
          </div>
          <p className="text-sm font-medium text-white/30 mb-1">Nothing planned</p>
          <p className="text-xs text-white/20 mb-5">Head to Training to start a session</p>
          <button
            onClick={onPlanWorkout}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500/12 border border-indigo-500/25 rounded-2xl text-sm font-semibold text-indigo-300 active:bg-indigo-500/25 transition-colors"
          >
            <Plus size={14} />
            Go to Training
          </button>
        </div>
      ) : !hasData ? (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-3">
            <Dumbbell size={22} className="text-white/20" />
          </div>
          <p className="text-sm text-white/25">Rest day</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activities.map(act => (
            <ActivityCard key={act.id} act={act} />
          ))}
          {sessions.map(s => (
            <SessionCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ─── Week strip ────────────────────────────────────────────────────────────────

function WeekStrip({
  weekStart, selectedDate, activitiesByDate, sessionsByDate, today, onSelect,
}: {
  weekStart: Date
  selectedDate: string
  activitiesByDate: Record<string, Activity[]>
  sessionsByDate:   Record<string, SessionSummary[]>
  today: string
  onSelect: (d: string) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="flex gap-1.5">
      {days.map((d, i) => {
        const ds      = isoDate(d)
        const isSelected = ds === selectedDate
        const isToday    = ds === today
        const isFuture   = ds > today
        const acts  = activitiesByDate[ds] ?? []
        const sess  = sessionsByDate[ds] ?? []

        // Unique dot colors (max 3)
        const dotColors: string[] = []
        acts.forEach(a => {
          const c = typeCfg(a.type).color
          if (!dotColors.includes(c) && dotColors.length < 3) dotColors.push(c)
        })
        if (sess.length > 0 && !dotColors.includes('#a78bfa') && dotColors.length < 3) {
          dotColors.push('#a78bfa')
        }

        return (
          <button
            key={ds}
            onClick={() => onSelect(ds)}
            className={`relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 rounded-2xl transition-all active:scale-95 ${
              isSelected
                ? 'bg-indigo-500 shadow-lg'
                : isToday
                ? 'bg-white/[0.07] border border-indigo-500/30'
                : isFuture
                ? 'opacity-35'
                : 'hover:bg-white/[0.06]'
            }`}
          >
            {/* Day letter */}
            <span className={`text-[10px] font-semibold tracking-widest ${
              isSelected ? 'text-indigo-200' : isToday ? 'text-indigo-400' : 'text-white/35'
            }`}>
              {DOW_SHORT[i]}
            </span>

            {/* Date number */}
            <span className={`text-[15px] font-bold leading-none ${
              isSelected ? 'text-white' : isToday ? 'text-white' : 'text-white/70'
            }`}>
              {d.getDate()}
            </span>

            {/* Activity dot strip */}
            <div className="flex items-center justify-center gap-[3px] min-h-[7px]">
              {dotColors.length > 0
                ? dotColors.map((c, ci) => (
                    <div
                      key={ci}
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.65)' : c }}
                    />
                  ))
                : <div className="w-[5px] h-[5px]" />
              }
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Weekly summary ────────────────────────────────────────────────────────────

function WeeklySummary({
  weekStart, activitiesByDate, sessionsByDate, today,
}: {
  weekStart: Date
  activitiesByDate: Record<string, Activity[]>
  sessionsByDate:   Record<string, SessionSummary[]>
  today: string
}) {
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))).filter(d => d <= today)
  const allActs  = days.flatMap(d => activitiesByDate[d] ?? [])
  const allSess  = days.flatMap(d => sessionsByDate[d] ?? [])
  if (allActs.length === 0 && allSess.length === 0) return null

  const totalSecs = allActs.reduce((s, a) => s + a.duration_seconds, 0)
  const totalCals = allActs.reduce((s, a) => s + a.calories, 0)
  const totalSets = allSess.reduce((s, x) => s + x.total_sets, 0)
  const activeDays = new Set([
    ...allActs.map(a => a.date),
    ...allSess.map(s => s.started_at?.split('T')[0]).filter(Boolean),
  ]).size

  const stats = [
    { icon: CalendarDays, label: 'Active days', value: String(activeDays),         color: '#6366f1' },
    { icon: Timer,        label: 'Training time', value: fmtDuration(totalSecs),   color: '#22c55e' },
    { icon: Dumbbell,     label: 'Sets logged',  value: totalSets > 0 ? String(totalSets) : '—', color: '#a78bfa' },
    { icon: Zap,          label: 'Calories',
      value: totalCals > 0 ? `${(totalCals / 1000).toFixed(1)}k` : '—',            color: '#f59e0b' },
  ]

  return (
    <div className="px-4 mt-5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/25 mb-2.5">Week summary</p>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-3 text-center">
            <Icon size={13} className="mx-auto mb-1.5" style={{ color }} />
            <p className="text-sm font-bold text-white">{value}</p>
            <p className="text-[9px] text-white/30 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Load-trend sparkline (past 4 weeks) ──────────────────────────────────────

function LoadSparkline({ weekStart, activitiesByDate, sessionsByDate, today }: {
  weekStart: Date
  activitiesByDate: Record<string, Activity[]>
  sessionsByDate:   Record<string, SessionSummary[]>
  today: string
}) {
  // Show the past 4 weeks of daily activity count as a small bar chart
  const weeks: { label: string; acts: number; sess: number }[] = []
  for (let w = 3; w >= 0; w--) {
    const ws = addDays(weekStart, -(w * 7))
    const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(ws, i))).filter(d => d <= today)
    const a = days.flatMap(d => activitiesByDate[d] ?? []).length
    const s = days.flatMap(d => sessionsByDate[d] ?? []).length
    const label = w === 0 ? 'This' : w === 1 ? 'Last' : `-${w}w`
    weeks.push({ label, acts: a, sess: s })
  }

  const max = Math.max(...weeks.map(w => w.acts + w.sess), 1)

  return (
    <div className="px-4 mt-4">
      <div className="flex items-center gap-2 mb-2.5">
        <TrendingUp size={12} className="text-white/25" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/25">4-week load</p>
      </div>
      <div className="flex items-end gap-2 h-12">
        {weeks.map(({ label, acts, sess }, i) => {
          const total = acts + sess
          const h = max > 0 ? Math.round((total / max) * 100) : 0
          const isCurrentWeek = i === 3
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end rounded-lg overflow-hidden" style={{ height: 36 }}>
                <div
                  className="w-full rounded-lg transition-all"
                  style={{
                    height: `${Math.max(h, total > 0 ? 12 : 2)}%`,
                    backgroundColor: isCurrentWeek ? '#6366f1' : 'rgba(255,255,255,0.08)',
                  }}
                />
              </div>
              <span className={`text-[9px] font-medium ${isCurrentWeek ? 'text-indigo-400' : 'text-white/25'}`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter()
  const today  = isoDate(new Date())

  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart,    setWeekStart]    = useState(() => mondayOf(new Date()))
  const [activities,   setActivities]   = useState<Activity[]>([])
  const [sessions,     setSessions]     = useState<SessionSummary[]>([])
  const [trends,       setTrends]       = useState<TrendDataPoint[]>([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    Promise.all([
      api.getActivities(120),
      api.training.getSessions(300),
      api.getTrends(120),
    ]).then(([acts, sess, trnd]) => {
      setActivities(acts)
      // Only finished sessions
      setSessions((sess as SessionSummary[]).filter(s => s.finished_at))
      setTrends(trnd)
    }).finally(() => setLoading(false))
  }, [])

  const activitiesByDate = useMemo(() => {
    const m: Record<string, Activity[]> = {}
    activities.forEach(a => { ;(m[a.date] ??= []).push(a) })
    return m
  }, [activities])

  const sessionsByDate = useMemo(() => {
    const m: Record<string, SessionSummary[]> = {}
    sessions.forEach(s => {
      const d = s.started_at?.split('T')[0]
      if (d) (m[d] ??= []).push(s)
    })
    return m
  }, [sessions])

  const trendsByDate = useMemo(() => {
    const m: Record<string, TrendDataPoint> = {}
    trends.forEach(t => { m[t.date] = t })
    return m
  }, [trends])

  const maxFutureWeekStart = mondayOf(addDays(new Date(), 7))
  const canGoNext = addDays(weekStart, 7) <= maxFutureWeekStart

  const goWeek = (delta: number) => {
    const newStart = addDays(weekStart, delta * 7)
    if (delta > 0 && newStart > maxFutureWeekStart) return
    setWeekStart(newStart)

    // Keep the same day-of-week if possible; clamp to today for future days
    const dowIndex = (new Date(selectedDate + 'T12:00:00').getDay() + 6) % 7
    const candidate = isoDate(addDays(newStart, dowIndex))
    setSelectedDate(candidate > today ? today : candidate)
  }

  const weekEnd = addDays(weekStart, 6)
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTH_FULL[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${weekStart.getDate()} ${MONTH_SHORT[weekStart.getMonth()]} – ${weekEnd.getDate()} ${MONTH_SHORT[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-28">

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-sm text-white/40 mt-0.5">Your training week</p>
      </div>

      {/* ── Week navigation ── */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => goWeek(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white/40 active:text-white active:bg-white/8 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-medium text-white/40">{weekLabel}</span>
          <button
            onClick={() => goWeek(1)}
            disabled={!canGoNext}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white/40 active:text-white active:bg-white/8 disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Week strip skeleton / real */}
        {loading ? (
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 h-[76px] bg-white/[0.04] rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <WeekStrip
            weekStart={weekStart}
            selectedDate={selectedDate}
            activitiesByDate={activitiesByDate}
            sessionsByDate={sessionsByDate}
            today={today}
            onSelect={setSelectedDate}
          />
        )}
      </div>

      {/* ── Divider ── */}
      <div className="h-px bg-white/[0.06] mx-4 my-4" />

      {/* ── Day detail ── */}
      <div className="px-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-44 bg-white/[0.05] rounded-xl animate-pulse" />
            <div className="flex gap-1.5">
              {[1,2,3].map(i => <div key={i} className="h-7 w-20 bg-white/[0.04] rounded-xl animate-pulse" />)}
            </div>
            <div className="h-[100px] bg-white/[0.04] rounded-2xl animate-pulse mt-4" />
            <div className="h-[100px] bg-white/[0.04] rounded-2xl animate-pulse" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <DayDetail
              key={selectedDate}
              dateStr={selectedDate}
              activities={activitiesByDate[selectedDate] ?? []}
              sessions={sessionsByDate[selectedDate] ?? []}
              trend={trendsByDate[selectedDate] ?? null}
              isToday={selectedDate === today}
              isFuture={selectedDate > today}
              onPlanWorkout={() => router.push('/training')}
            />
          </AnimatePresence>
        )}
      </div>

      {/* ── Week summary + 4-week sparkline ── */}
      {!loading && (
        <>
          <WeeklySummary
            weekStart={weekStart}
            activitiesByDate={activitiesByDate}
            sessionsByDate={sessionsByDate}
            today={today}
          />
          <LoadSparkline
            weekStart={weekStart}
            activitiesByDate={activitiesByDate}
            sessionsByDate={sessionsByDate}
            today={today}
          />
        </>
      )}
    </div>
  )
}
