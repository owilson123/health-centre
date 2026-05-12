'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, Reorder, useDragControls } from 'framer-motion'
import {
  Plus, X, ChevronRight, Dumbbell, Clock,
  Search, Check, ChevronDown, Trash2, Play, RotateCcw,
  Trophy, Weight, Flame, Zap, GripVertical
} from 'lucide-react'
import { api, WorkoutTemplate, TrainingExercise, SessionDetail, SessionSummary, LastPerformance } from '@/lib/api'

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(dt: string) {
  const d = new Date(dt)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtDuration(start: string, end?: string | null) {
  const s = new Date(start)
  const e = end ? new Date(end) : new Date()
  const mins = Math.round((e.getTime() - s.getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function strainColor(score: number): string {
  if (score >= 70) return '#ef4444'   // red — high
  if (score >= 50) return '#f59e0b'   // amber — moderate-high
  if (score >= 30) return '#22c55e'   // green — moderate
  return '#6366f1'                     // indigo — light
}

const CATEGORY_COLORS: Record<string, string> = {
  Push:  'bg-blue-500/20 text-blue-300',
  Pull:  'bg-purple-500/20 text-purple-300',
  Legs:  'bg-green-500/20 text-green-300',
  Arms:  'bg-orange-500/20 text-orange-300',
  Core:  'bg-pink-500/20 text-pink-300',
}

const CATEGORIES = ['Push', 'Pull', 'Legs', 'Arms', 'Core']

// ─── Exercise Picker Sheet ────────────────────────────────────────────────────

const EQUIPMENT_OPTIONS = ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Other']

function CreateExerciseForm({ onCreated, onBack }: {
  onCreated: (ex: TrainingExercise) => void
  onBack: () => void
}) {
  const [name, setName]       = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [equipment, setEquipment] = useState(EQUIPMENT_OPTIONS[0])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const ex = await api.training.createExercise({ name: name.trim(), category, equipment })
      onCreated(ex)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create exercise')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="absolute inset-0 bg-[#0f0f0f] flex flex-col"
    >
      <div className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button onClick={onBack} className="p-2 text-white/50 active:text-white">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold flex-1">New Exercise</h2>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="px-4 py-1.5 bg-indigo-500 rounded-xl text-sm font-semibold disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="px-4 space-y-4 flex-1">
        <div>
          <p className="text-xs text-white/40 mb-1.5">Exercise name</p>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="e.g. Landmine Press"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-white/25"
            autoFocus
          />
          {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
        </div>

        <div>
          <p className="text-xs text-white/40 mb-1.5">Category</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  category === c ? 'bg-indigo-500 text-white' : 'bg-white/5 text-white/50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-white/40 mb-1.5">Equipment</p>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_OPTIONS.map(e => (
              <button
                key={e}
                onClick={() => setEquipment(e)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  equipment === e ? 'bg-indigo-500 text-white' : 'bg-white/5 text-white/50'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 bg-white/4 rounded-xl">
          <p className="text-xs text-white/40 leading-relaxed">
            DUP weights are estimated by matching your exercise name to the closest
            similar movement in the library (e.g. &quot;Straight Bar Pushdown&quot; → Tricep Pushdown).
            The recommendation note will show what it matched to.
          </p>
        </div>
      </div>
    </motion.div>
  )
}

function ExercisePicker({
  onSelect,
  onClose,
  multi = false,
  selected = [],
}: {
  onSelect: (ex: TrainingExercise[]) => void
  onClose: () => void
  multi?: boolean
  selected?: number[]
}) {
  const [allExs, setAllExs] = useState<TrainingExercise[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set(selected))
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    // Load everything once; filter client-side for instant predictive search
    api.training.getExercises('', '').then(setAllExs)
  }, [])

  useEffect(() => { load() }, [load])

  // Client-side filter: match any word that starts with query, or query anywhere in name
  const exercises = allExs.filter(ex => {
    const matchesCat = !cat || ex.category === cat
    if (!matchesCat) return false
    if (!q) return true
    const ql = q.toLowerCase()
    const name = ex.name.toLowerCase()
    // "ben" matches "bench", "bar" matches "barbell", etc.
    return name.includes(ql) || name.split(/\s+/).some(w => w.startsWith(ql))
  })

  const toggle = (ex: TrainingExercise) => {
    if (!multi) { onSelect([ex]); return }
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(ex.id)) { next.delete(ex.id) } else { next.add(ex.id) }
      return next
    })
  }

  const confirm = () => {
    onSelect(exercises.filter(e => picked.has(e.id)))
  }

  const handleCreated = (ex: TrainingExercise) => {
    setCreating(false)
    setAllExs(prev => [...prev, ex])
    if (!multi) {
      onSelect([ex])
    } else {
      setPicked(prev => new Set(prev).add(ex.id))
    }
  }

  const handleDeleteCustom = async (ex: TrainingExercise, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.training.deleteExercise(ex.id)
      setAllExs(prev => prev.filter(x => x.id !== ex.id))
      setPicked(prev => { const n = new Set(prev); n.delete(ex.id); return n })
    } catch {}
  }

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-3">
        <button onClick={onClose} className="p-2 text-white/50 active:text-white">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold flex-1">Exercise Library</h2>
        {multi && picked.size > 0 && (
          <button onClick={confirm} className="px-4 py-1.5 bg-indigo-500 rounded-xl text-sm font-semibold">
            Add {picked.size}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search exercises…"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 pl-9 text-sm text-white placeholder-white/20 outline-none focus:border-white/25"
          />
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {['All', ...CATEGORIES].map(c => (
          <button
            key={c}
            onClick={() => setCat(c === 'All' ? '' : c)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
              (c === 'All' ? cat === '' : cat === c)
                ? 'bg-indigo-500 text-white'
                : 'bg-white/5 text-white/50'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-1">
        {exercises.map(ex => {
          const sel = picked.has(ex.id)
          const isCustom = !!ex.is_custom
          return (
            <button
              key={ex.id}
              onClick={() => toggle(ex)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                sel ? 'bg-indigo-500/15 border border-indigo-500/30' : 'bg-white/4 active:bg-white/8'
              }`}
            >
              <div className="flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-white">{ex.name}</p>
                  {isCustom && <span className="text-[9px] text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded-full font-medium">Custom</span>}
                </div>
                <p className="text-xs text-white/40 mt-0.5">{ex.equipment}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[ex.category] ?? 'bg-white/10 text-white/50'}`}>
                {ex.category}
              </span>
              {isCustom && (
                <button
                  onClick={e => handleDeleteCustom(ex, e)}
                  className="p-1 text-white/20 active:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {multi && sel && <Check size={15} className="text-indigo-400 flex-shrink-0" />}
            </button>
          )
        })}

        {/* Create custom exercise */}
        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 border border-dashed border-white/10 rounded-xl text-white/40 text-sm active:bg-white/5 mt-2"
        >
          <Plus size={15} />
          Create custom exercise
        </button>
      </div>

      {/* Slide-in create form */}
      <AnimatePresence>
        {creating && (
          <CreateExerciseForm
            onBack={() => setCreating(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Template Builder Sheet ───────────────────────────────────────────────────

function TemplateBuilder({ onClose, existing }: { onClose: () => void; existing?: WorkoutTemplate }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [exercises, setExercises] = useState<TrainingExercise[]>(existing?.exercises ?? [])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim() || exercises.length === 0) return
    setSaving(true)
    try {
      if (existing) {
        await api.training.updateTemplate(existing.id, { name: name.trim(), exercise_ids: exercises.map(e => e.id) })
      } else {
        await api.training.createTemplate({ name: name.trim(), exercise_ids: exercises.map(e => e.id) })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const removeEx = (id: number) => setExercises(prev => prev.filter(e => e.id !== id))

  return (
    <>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed inset-0 z-[60] flex flex-col bg-[#0f0f0f]"
      >
        <div className="flex items-center gap-3 px-4 pt-6 pb-4">
          <button onClick={onClose} className="p-2 text-white/50 active:text-white">
            <X size={20} />
          </button>
          <h2 className="text-lg font-semibold flex-1">{existing ? 'Edit Template' : 'New Template'}</h2>
          <button
            onClick={save}
            disabled={saving || !name.trim() || exercises.length === 0}
            className="px-4 py-1.5 bg-indigo-500 rounded-xl text-sm font-semibold disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="px-4 pb-4">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template name…"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-white/25"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
          {exercises.map((ex, i) => (
            <div key={ex.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-3">
              <span className="text-white/30 text-xs w-5 text-center">{i + 1}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{ex.name}</p>
                <p className="text-xs text-white/40">{ex.category} · {ex.equipment}</p>
              </div>
              <button onClick={() => removeEx(ex.id)} className="p-1 text-white/20 active:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-white/15 rounded-xl text-white/40 text-sm active:bg-white/5"
          >
            <Plus size={16} />
            Add exercises
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showPicker && (
          <div className="fixed inset-0 z-50">
            <ExercisePicker
              multi
              selected={exercises.map(e => e.id)}
              onClose={() => setShowPicker(false)}
              onSelect={picked => {
                // merge — keep existing order, append new
                const existingIds = new Set(exercises.map(e => e.id))
                const added = picked.filter(e => !existingIds.has(e.id))
                setExercises(prev => [...prev, ...added])
                setShowPicker(false)
              }}
            />
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── DUP phase badge ─────────────────────────────────────────────────────────

const PHASE_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  Hypertrophy: { bg: 'bg-blue-500/15',   text: 'text-blue-300',   dot: 'bg-blue-400' },
  Strength:    { bg: 'bg-violet-500/15', text: 'text-violet-300', dot: 'bg-violet-400' },
  Power:       { bg: 'bg-amber-500/15',  text: 'text-amber-300',  dot: 'bg-amber-400' },
}


// ─── Rest Timer ──────────────────────────────────────────────────────────────

const REST_DEFAULT = 105 // 1 min 45 s

function RestTimer({
  initialSeconds,
  onDone,
  onSkip,
  onAdjust,
}: {
  initialSeconds: number
  onDone: () => void
  onSkip: () => void
  onAdjust: (delta: number) => void
}) {
  const [seconds, setSeconds] = useState(initialSeconds)
  const doneRef = useRef(false)

  // Keep seconds in sync if parent adjusts total
  useEffect(() => { setSeconds(s => Math.max(1, s + (initialSeconds - REST_DEFAULT))) }, [initialSeconds])

  useEffect(() => {
    if (seconds <= 0 && !doneRef.current) {
      doneRef.current = true
      try { navigator.vibrate?.([180, 80, 180, 80, 360]) } catch {}
      const t = setTimeout(onDone, 1800)
      return () => clearTimeout(t)
    }
    const id = setInterval(() => setSeconds(s => s - 1), 1000)
    return () => clearInterval(id)
  }, [seconds, onDone])

  const pct = Math.max(0, seconds / initialSeconds)
  const mins = Math.floor(seconds / 60)
  const secs = Math.max(0, seconds % 60)

  // SVG ring
  const R = 26
  const circ = 2 * Math.PI * R
  const dash = circ * pct

  const done = seconds <= 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 border ${
        done
          ? 'bg-green-500/15 border-green-500/30'
          : 'bg-indigo-500/10 border-indigo-500/20'
      }`}
    >
      {/* Countdown ring */}
      <div className="relative flex-shrink-0 w-14 h-14 flex items-center justify-center">
        <svg width="56" height="56" className="-rotate-90 absolute inset-0">
          <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          <circle
            cx="28" cy="28" r={R} fill="none"
            stroke={done ? '#22c55e' : '#6366f1'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - dash}
            style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
          />
        </svg>
        <span className={`text-sm font-bold tabular-nums z-10 ${done ? 'text-green-400' : 'text-white'}`}>
          {done ? '✓' : `${mins}:${secs.toString().padStart(2, '0')}`}
        </span>
      </div>

      {/* Label + adjust */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${done ? 'text-green-400' : 'text-indigo-300'}`}>
          {done ? 'Rest complete' : 'Resting…'}
        </p>
        {!done && (
          <div className="flex items-center gap-2 mt-1">
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setSeconds(s => Math.max(5, s - 15)); onAdjust(-15) }}
              className="text-[11px] text-white/40 active:text-white bg-white/8 rounded-lg px-2 py-0.5"
            >−15s</button>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setSeconds(s => s + 15); onAdjust(+15) }}
              className="text-[11px] text-white/40 active:text-white bg-white/8 rounded-lg px-2 py-0.5"
            >+15s</button>
          </div>
        )}
      </div>

      {/* Skip */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={onSkip}
        className="flex-shrink-0 text-xs text-white/30 active:text-white/70 px-2 py-1"
      >
        {done ? 'OK' : 'Skip'}
      </button>
    </motion.div>
  )
}

// ─── Active Session ───────────────────────────────────────────────────────────

interface ActiveSet {
  set_number: number
  weight_kg: string
  reps: string
  saved: boolean
  set_id?: number
}

// One exercise card inside the reorderable list
function ExerciseCard({
  ex, exSets, kgLabel, rec, lastP,
  onAddSet, onUpdate, onSave, onDelete, onRemove,
}: {
  ex: TrainingExercise
  exSets: ActiveSet[]
  kgLabel: string
  rec: LastPerformance['recommendation'] | null
  lastP: LastPerformance | null
  onAddSet: () => void
  onUpdate: (idx: number, field: 'weight_kg' | 'reps', val: string) => void
  onSave: (idx: number) => void
  onDelete: (idx: number) => void
  onRemove: () => void
}) {
  const dragControls = useDragControls()

  return (
    <Reorder.Item
      value={ex}
      dragListener={false}
      dragControls={dragControls}
      as="div"
      className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden"
      style={{ listStyle: 'none' }}
    >
      {/* Exercise header row */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-white/5">
        <button
          onPointerDown={e => { e.preventDefault(); dragControls.start(e) }}
          className="p-1 text-white/20 active:text-white/50 touch-none cursor-grab"
        >
          <GripVertical size={16} />
        </button>
        <p className="flex-1 text-sm font-semibold text-white">{ex.name}</p>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={onRemove}
          className="p-1.5 text-white/20 active:text-red-400 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* DUP recommendation + last performance */}
      {(rec || lastP?.summary) && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5">
          {rec && (
            <div className={`flex items-center gap-1.5 flex-1 min-w-0 ${PHASE_STYLE[rec.phase]?.text ?? 'text-white/40'}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PHASE_STYLE[rec.phase]?.dot ?? 'bg-white/30'}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wide">{rec.phase}</span>
              <span className="text-[11px] text-white/50">
                {rec.sets}×{rec.reps_low}{rec.reps_low !== rec.reps_high ? `–${rec.reps_high}` : ''}
                {rec.weight_kg ? ` @ ${rec.weight_kg}kg` : ''}
              </span>
            </div>
          )}
          {lastP?.summary && (
            <span className="text-[11px] text-white/30 truncate flex-shrink-0">Last: {lastP.summary}</span>
          )}
        </div>
      )}

      <div className="px-3 pt-2 pb-3">
        {/* Column headers */}
        <div className="flex items-center gap-2 pb-2">
          <span className="w-7 text-[10px] text-white/40 text-center flex-shrink-0 font-semibold tracking-wider">SET</span>
          <span className="flex-1 text-[10px] text-white/40 text-center font-semibold tracking-wider">WEIGHT</span>
          <span className="w-5 flex-shrink-0" />
          <span className="w-14 text-[10px] text-white/40 text-center flex-shrink-0 font-semibold tracking-wider">REPS</span>
          <span className="w-9 flex-shrink-0" />
        </div>

        {/* Set rows */}
        <div className="space-y-1.5">
          {exSets.map((s, i) => (
            <SwipeableSetRow
              key={`${ex.id}-${i}`}
              s={s}
              kgLabel={kgLabel}
              onUpdate={(field, val) => onUpdate(i, field, val)}
              onSave={() => onSave(i)}
              onDelete={() => onDelete(i)}
            />
          ))}
        </div>

        {/* Add set */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={onAddSet}
          className="w-full mt-2 py-2.5 border border-dashed border-white/12 rounded-xl text-sm text-white/35 active:bg-white/5 flex items-center justify-center gap-1.5"
        >
          <Plus size={14} />
          Add set
        </button>
      </div>
    </Reorder.Item>
  )
}

// Swipeable set row — drag left to reveal delete, release past threshold to delete
function SwipeableSetRow({
  s, kgLabel, onUpdate, onSave, onDelete,
}: {
  s: ActiveSet
  kgLabel: string
  onUpdate: (field: 'weight_kg' | 'reps', val: string) => void
  onSave: () => void
  onDelete: () => void
}) {
  const x = useMotionValue(0)
  const deleteOpacity = useTransform(x, [-72, -16], [1, 0])
  const rowScale = useTransform(x, [-72, 0], [0.97, 1])

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ isolation: 'isolate' }}>
      {/* Red delete layer behind the row */}
      <motion.div
        className="absolute inset-0 bg-red-500/90 flex items-center justify-end pr-4 rounded-xl"
        style={{ opacity: deleteOpacity }}
      >
        <Trash2 size={15} className="text-white" />
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -72, right: 0 }}
        dragElastic={{ left: 0.08, right: 0 }}
        dragMomentum={false}
        onDragEnd={(_, info) => { if (info.offset.x < -52) onDelete() }}
        style={{ x, scale: rowScale }}
        className={`relative flex items-center gap-2 rounded-xl px-2.5 py-2 ${
          s.saved
            ? 'bg-green-500/10 border border-green-500/25'
            : 'bg-white/[0.05] border border-white/[0.08]'
        }`}
      >
        {/* Set number */}
        {s.saved ? (
          <div className="w-7 flex justify-center flex-shrink-0">
            <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-[10px] font-bold text-green-400">{s.set_number}</span>
            </div>
          </div>
        ) : (
          <span className="w-7 text-xs text-white/50 text-center font-semibold flex-shrink-0">
            {s.set_number}
          </span>
        )}

        {/* Weight */}
        {s.saved ? (
          <span className="flex-1 text-sm font-semibold text-white text-center min-w-0">
            {s.weight_kg || '—'}
          </span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={s.weight_kg}
            onChange={e => onUpdate('weight_kg', e.target.value)}
            placeholder="—"
            className="flex-1 rounded-lg px-2 py-2 text-sm font-semibold text-white text-center outline-none min-w-0 bg-white/[0.07] border border-white/[0.12] focus:border-indigo-500/60 focus:bg-white/[0.1] placeholder-white/20 transition-colors"
          />
        )}

        {/* Unit label */}
        <span className={`text-[10px] flex-shrink-0 font-medium ${s.saved ? 'text-green-400/60' : 'text-white/30'}`}>
          {kgLabel}
        </span>

        {/* Reps */}
        {s.saved ? (
          <span className="w-14 text-sm font-semibold text-white text-center flex-shrink-0">
            {s.reps}
          </span>
        ) : (
          <input
            type="text"
            inputMode="numeric"
            value={s.reps}
            onChange={e => onUpdate('reps', e.target.value)}
            placeholder="0"
            className="w-14 rounded-lg px-2 py-2 text-sm font-semibold text-white text-center outline-none flex-shrink-0 bg-white/[0.07] border border-white/[0.12] focus:border-indigo-500/60 focus:bg-white/[0.1] placeholder-white/20 transition-colors"
          />
        )}

        {/* Save / done indicator */}
        <div className="w-9 flex justify-center flex-shrink-0">
          {s.saved ? (
            <div className="w-7 h-7 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
              <Check size={13} className="text-green-400" strokeWidth={2.5} />
            </div>
          ) : (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onSave}
              disabled={!s.reps}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-white/40 active:text-green-400 active:bg-green-500/15 disabled:opacity-20 transition-colors"
            >
              <Check size={17} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function ActiveSession({
  session,
  onFinish,
}: {
  session: { session_id: number; name: string; exercises: TrainingExercise[] }
  onFinish: () => void
}) {
  const [exercises, setExercises] = useState<TrainingExercise[]>(session.exercises)
  const [sets, setSets] = useState<Record<number, ActiveSet[]>>({})
  const [perf, setPerf] = useState<Record<number, LastPerformance>>({})
  const [showAddEx, setShowAddEx] = useState(session.exercises.length === 0)
  const [finishing, setFinishing] = useState(false)
  const [finishStrain, setFinishStrain] = useState<number | null>(null)
  const [restActive, setRestActive] = useState(false)
  const [restTotal, setRestTotal] = useState(REST_DEFAULT)

  useEffect(() => {
    exercises.forEach(ex => {
      if (perf[ex.id]) return
      api.training.lastPerformance(ex.id).then(p => {
        setPerf(prev => ({ ...prev, [ex.id]: p }))
      }).catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises])

  const addSet = (exId: number) => {
    setSets(prev => {
      const cur = prev[exId] ?? []
      const last = cur[cur.length - 1]
      const r = perf[exId]?.recommendation
      return {
        ...prev,
        [exId]: [...cur, {
          set_number: cur.length + 1,
          weight_kg: last?.weight_kg ?? (r?.weight_kg ? String(r.weight_kg) : ''),
          reps: last?.reps ?? (r ? String(r.reps_high) : ''),
          saved: false,
        }],
      }
    })
  }

  const updateSet = (exId: number, idx: number, field: 'weight_kg' | 'reps', val: string) => {
    setSets(prev => {
      const cur = [...(prev[exId] ?? [])]
      cur[idx] = { ...cur[idx], [field]: val }
      return { ...prev, [exId]: cur }
    })
  }

  const saveSet = async (exId: number, idx: number) => {
    const s = (sets[exId] ?? [])[idx]
    if (!s || !s.reps) return
    try {
      const res = await api.training.logSet(session.session_id, {
        exercise_id: exId,
        set_number: s.set_number,
        weight_kg: s.weight_kg ? parseFloat(s.weight_kg) : undefined,
        reps: parseInt(s.reps),
      })
      setSets(prev => {
        const cur = [...(prev[exId] ?? [])]
        cur[idx] = { ...cur[idx], saved: true, set_id: res.set_id }
        return { ...prev, [exId]: cur }
      })
      setRestActive(true)
    } catch {}
  }

  const deleteSet = async (exId: number, idx: number) => {
    const s = (sets[exId] ?? [])[idx]
    if (s?.set_id) {
      try { await api.training.deleteSet(s.set_id) } catch {}
    }
    setSets(prev => {
      const cur = (prev[exId] ?? []).filter((_, i) => i !== idx)
        .map((x, i) => ({ ...x, set_number: i + 1 }))
      return { ...prev, [exId]: cur }
    })
  }

  const removeExercise = (exId: number) => {
    setExercises(prev => prev.filter(e => e.id !== exId))
    setSets(prev => { const n = { ...prev }; delete n[exId]; return n })
  }

  const finish = async () => {
    setFinishing(true)
    try {
      const res = await api.training.finishSession(session.session_id) as { strength_strain?: number }
      if (res?.strength_strain && res.strength_strain > 0) {
        setFinishStrain(res.strength_strain)
        setTimeout(() => { onFinish() }, 3000)
      } else {
        onFinish()
      }
    } finally {
      setFinishing(false)
    }
  }

  return (
    <>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed inset-0 z-[60] flex flex-col bg-[#0a0a0a]"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{session.name}</p>
            <p className="text-[11px] text-white/35">In progress</p>
          </div>
          <button
            onClick={finish}
            disabled={finishing}
            className="px-5 py-2 bg-green-500 rounded-xl text-sm font-bold text-black active:scale-95 disabled:opacity-60 flex-shrink-0"
          >
            {finishing ? '…' : 'Finish'}
          </button>
        </div>

        {/* Scrollable exercise list */}
        <div className="flex-1 overflow-y-auto">
          {exercises.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/30 pb-10">
              <Dumbbell size={32} className="mb-3 opacity-30" />
              <p className="text-sm mb-4">No exercises yet</p>
              <button
                onClick={() => setShowAddEx(true)}
                className="px-5 py-2.5 bg-indigo-500 rounded-xl text-sm font-semibold text-white"
              >
                Add Exercise
              </button>
            </div>
          ) : (
            <>
              <Reorder.Group
                axis="y"
                values={exercises}
                onReorder={setExercises}
                as="div"
                className="px-4 pt-3 space-y-3"
              >
                {exercises.map(ex => (
                  <ExerciseCard
                    key={ex.id}
                    ex={ex}
                    exSets={sets[ex.id] ?? []}
                    kgLabel={ex.equipment === 'Dumbbell' ? 'ea' : 'kg'}
                    rec={perf[ex.id]?.recommendation ?? null}
                    lastP={perf[ex.id] ?? null}
                    onAddSet={() => addSet(ex.id)}
                    onUpdate={(idx, field, val) => updateSet(ex.id, idx, field, val)}
                    onSave={(idx) => saveSet(ex.id, idx)}
                    onDelete={(idx) => deleteSet(ex.id, idx)}
                    onRemove={() => removeExercise(ex.id)}
                  />
                ))}
              </Reorder.Group>

              <div className="px-4 pt-3 pb-6">
                <button
                  onClick={() => setShowAddEx(true)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 border border-dashed border-white/15 rounded-2xl text-white/40 text-sm active:bg-white/5"
                >
                  <Plus size={16} />
                  Add Exercise
                </button>
              </div>
            </>
          )}
        </div>

        {/* Rest timer — pinned at bottom when active */}
        <AnimatePresence>
          {restActive && (
            <div className="px-4 pb-3 pt-1 flex-shrink-0">
              <RestTimer
                key={restTotal}
                initialSeconds={restTotal}
                onDone={() => setRestActive(false)}
                onSkip={() => setRestActive(false)}
                onAdjust={delta => setRestTotal(t => Math.max(15, t + delta))}
              />
            </div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showAddEx && (
          <div className="fixed inset-0 z-[70]">
            <ExercisePicker
              onClose={() => setShowAddEx(false)}
              onSelect={([ex]) => {
                if (ex && !exercises.find(e => e.id === ex.id)) {
                  setExercises(prev => [...prev, ex])
                }
                setShowAddEx(false)
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Post-workout strain summary */}
      <AnimatePresence>
        {finishStrain !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="text-center px-8"
            >
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 border-4"
                style={{ borderColor: strainColor(finishStrain), boxShadow: `0 0 32px ${strainColor(finishStrain)}55` }}
              >
                <Zap size={36} style={{ color: strainColor(finishStrain) }} />
              </div>
              <p className="text-4xl font-bold mb-1" style={{ color: strainColor(finishStrain) }}>
                {finishStrain}
              </p>
              <p className="text-white/60 text-sm font-medium mb-1">Strength Strain</p>
              <p className="text-white/30 text-xs">
                {finishStrain >= 70 ? 'Heavy session — prioritise recovery'
                  : finishStrain >= 50 ? 'Solid work — good training stimulus'
                  : finishStrain >= 30 ? 'Moderate session — keep it consistent'
                  : 'Light session — good for active recovery'}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── History Session Detail ───────────────────────────────────────────────────

function SessionDetailSheet({ sid, onClose, onDeleted }: { sid: number; onClose: () => void; onDeleted: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api.training.getSession(sid).then(setDetail)
  }, [sid])

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await api.training.deleteSession(sid)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  if (!detail) return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f0f0f]"
    >
      <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-indigo-500 animate-spin" />
    </motion.div>
  )

  const totalVolume = detail.exercises.reduce((acc, ex) =>
    acc + ex.sets.reduce((a, s) => a + (s.weight_kg ?? 0) * s.reps, 0), 0)

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[60] flex flex-col bg-[#0f0f0f]"
    >
      <div className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button onClick={onClose} className="p-2 text-white/50 active:text-white">
          <X size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold">{detail.name}</h2>
          <p className="text-xs text-white/40">{fmt(detail.started_at)}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 px-4 mb-4">
        {[
          { icon: Clock,    label: 'Duration',  value: fmtDuration(detail.started_at, detail.finished_at), color: null },
          { icon: Weight,   label: 'Volume',    value: `${Math.round(totalVolume).toLocaleString()} kg`, color: null },
          { icon: Dumbbell, label: 'Exercises', value: detail.exercises.length, color: null },
          { icon: Flame,    label: 'Strain',    value: (detail as SessionDetail & { strength_strain?: number }).strength_strain ? `${(detail as SessionDetail & { strength_strain?: number }).strength_strain}` : '—',
            color: (detail as SessionDetail & { strength_strain?: number }).strength_strain ? strainColor((detail as SessionDetail & { strength_strain?: number }).strength_strain!) : null },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white/5 rounded-2xl p-3 text-center">
            <Icon size={14} className="mx-auto mb-1" style={{ color: color ?? 'rgba(255,255,255,0.3)' }} />
            <p className="text-sm font-bold" style={{ color: color ?? 'white' }}>{value}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {detail.exercises.map(ex => (
          <div key={ex.exercise_id}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-white">{ex.exercise_name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${CATEGORY_COLORS[ex.category] ?? 'bg-white/10 text-white/50'}`}>
                {ex.category}
              </span>
            </div>
            <div className="space-y-1.5">
              {ex.sets.map(s => (
                <div key={s.id} className="flex items-center gap-3 bg-white/4 rounded-xl px-3 py-2.5">
                  <span className="text-xs text-white/30 w-8">Set {s.set_number}</span>
                  <span className="text-sm font-medium text-white flex-1">
                    {s.weight_kg ? `${s.weight_kg} kg` : 'Bodyweight'} × {s.reps} reps
                  </span>
                  {s.weight_kg && (
                    <span className="text-xs text-white/30">
                      {Math.round(s.weight_kg * s.reps)} kg vol
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Delete workout */}
        <div className="pt-4">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`w-full py-3 rounded-2xl text-sm font-semibold transition-colors ${
              confirmDelete
                ? 'bg-red-500 text-white'
                : 'bg-white/5 text-red-400 border border-red-500/20'
            } disabled:opacity-50`}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Tap again to confirm delete' : 'Delete Workout'}
          </button>
          {confirmDelete && (
            <p className="text-center text-xs text-white/30 mt-1.5">This cannot be undone</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Strength Profile (anchor maxes) ─────────────────────────────────────────

function StrengthProfile() {
  const [maxes, setMaxes] = useState<{ bench_1rm: number | null; row_5rm: number | null; squat_1rm: number | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [bench, setBench] = useState('')
  const [row, setRow]     = useState('')
  const [squat, setSquat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.training.getMaxes().then(m => {
      setMaxes(m)
      setBench(m.bench_1rm ? String(m.bench_1rm) : '')
      setRow(m.row_5rm     ? String(m.row_5rm)   : '')
      setSquat(m.squat_1rm ? String(m.squat_1rm) : '')
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.training.updateMaxes({
        bench_1rm: bench ? parseFloat(bench) : undefined,
        row_5rm:   row   ? parseFloat(row)   : undefined,
        squat_1rm: squat ? parseFloat(squat) : undefined,
      })
      setMaxes({
        bench_1rm: bench ? parseFloat(bench) : null,
        row_5rm:   row   ? parseFloat(row)   : null,
        squat_1rm: squat ? parseFloat(squat) : null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const hasAny = maxes && (maxes.bench_1rm || maxes.row_5rm || maxes.squat_1rm)

  return (
    <div className="mx-4 mb-4 bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
      <button
        onClick={() => setEditing(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-amber-400" />
          <span className="text-sm font-semibold">Strength Profile</span>
          {!hasAny && <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">Set your maxes</span>}
        </div>
        <ChevronDown size={14} className={`text-white/30 transition-transform ${editing ? 'rotate-180' : ''}`} />
      </button>

      {!editing && hasAny && (
        <div className="flex px-4 pb-3 gap-4">
          {[
            { label: 'Bench 1RM', val: maxes?.bench_1rm },
            { label: 'Row 5RM',   val: maxes?.row_5rm },
            { label: 'Squat 1RM', val: maxes?.squat_1rm },
          ].map(({ label, val }) => (
            <div key={label} className="flex-1 text-center">
              <p className="text-base font-bold">{val ? `${val}` : '—'}</p>
              <p className="text-[10px] text-white/30 mt-0.5">{label} kg</p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-white/40">
            Enter your maxes — row uses 5RM (more practical), bench and squat use 1RM.
            All DUP recommendations are calculated from these.
          </p>
          {[
            { label: 'Bench Press 1RM (kg)', val: bench, set: setBench, placeholder: 'e.g. 100' },
            { label: 'Barbell Row 5RM (kg)', val: row,   set: setRow,   placeholder: 'e.g. 80' },
            { label: 'Squat 1RM (kg)',        val: squat, set: setSquat, placeholder: 'e.g. 120' },
          ].map(({ label, val, set, placeholder }) => (
            <div key={label}>
              <p className="text-xs text-white/40 mb-1">{label}</p>
              <input
                type="number"
                inputMode="decimal"
                value={val}
                onChange={e => set(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-white/25"
              />
            </div>
          ))}
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 bg-indigo-500 rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Training Page ───────────────────────────────────────────────────────

type Tab = 'templates' | 'history'

export default function TrainingPage() {
  const [tab, setTab] = useState<Tab>('templates')
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [history, setHistory] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  const [showBuilder, setShowBuilder] = useState(false)
  const [editTemplate, setEditTemplate] = useState<WorkoutTemplate | undefined>()
  const [activeSession, setActiveSession] = useState<{ session_id: number; name: string; exercises: TrainingExercise[] } | null>(null)
  const [detailSid, setDetailSid] = useState<number | null>(null)
  const [showQuickStart, setShowQuickStart] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [t, h] = await Promise.all([
        api.training.getTemplates(),
        api.training.getSessions(30),
      ])
      setTemplates(t)
      setHistory(h)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const startFromTemplate = async (t: WorkoutTemplate) => {
    const res = await api.training.startSession({ template_id: t.id })
    setActiveSession(res)
    setShowQuickStart(false)
  }

  const startQuick = async () => {
    const res = await api.training.startSession({ name: 'Quick Workout' })
    setActiveSession(res)
    setShowQuickStart(false)
  }

  const deleteTemplate = async (tid: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.training.deleteTemplate(tid)
    setTemplates(prev => prev.filter(t => t.id !== tid))
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-24">
      {/* Header */}
      <div className="px-4 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Training</h1>
            <p className="text-sm text-white/40 mt-0.5">Track your workouts</p>
          </div>
          <button
            onClick={() => setShowQuickStart(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 rounded-2xl text-sm font-semibold active:scale-95 transition-transform"
          >
            <Play size={14} />
            Start
          </button>
        </div>
      </div>

      {/* Strength profile */}
      <StrengthProfile />

      {/* Tabs */}
      <div className="flex gap-1 px-4 mb-4">
        {(['templates', 'history'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-white/10 text-white' : 'text-white/40'
            }`}
          >
            {t === 'templates' ? 'My Routines' : 'History'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-white/10 border-t-indigo-500 animate-spin" />
        </div>
      ) : tab === 'templates' ? (
        <div className="px-4 space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white/5 rounded-2xl p-4 border border-white/8">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white">{t.name}</h3>
                  <p className="text-xs text-white/40 mt-0.5">{t.exercises.length} exercises</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); setEditTemplate(t); setShowBuilder(true) }}
                    className="p-1.5 text-white/30 active:text-white"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    onClick={e => deleteTemplate(t.id, e)}
                    className="p-1.5 text-white/30 active:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {t.exercises.slice(0, 6).map(ex => (
                  <span key={ex.id} className="text-[11px] bg-white/8 text-white/60 px-2 py-0.5 rounded-lg">
                    {ex.name}
                  </span>
                ))}
                {t.exercises.length > 6 && (
                  <span className="text-[11px] text-white/30 px-1">+{t.exercises.length - 6} more</span>
                )}
              </div>
              <button
                onClick={() => startFromTemplate(t)}
                className="w-full py-2.5 bg-indigo-500/15 border border-indigo-500/30 rounded-xl text-sm font-semibold text-indigo-300 active:bg-indigo-500/25 transition-colors"
              >
                Start Workout
              </button>
            </div>
          ))}
          <button
            onClick={() => { setEditTemplate(undefined); setShowBuilder(true) }}
            className="w-full flex items-center justify-center gap-2 py-4 border border-dashed border-white/15 rounded-2xl text-white/40 text-sm active:bg-white/5"
          >
            <Plus size={16} />
            New Routine
          </button>
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {history.length === 0 && (
            <div className="text-center py-16 text-white/30 text-sm">No workouts logged yet</div>
          )}
          {history.map(s => (
            <button
              key={s.id}
              onClick={() => setDetailSid(s.id)}
              className="w-full bg-white/5 rounded-2xl p-4 border border-white/8 text-left active:bg-white/8"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-white text-sm">{s.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">{fmt(s.started_at)}</p>
                </div>
                <ChevronRight size={16} className="text-white/20 mt-0.5" />
              </div>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Dumbbell size={11} />{s.exercise_count} exercises
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Trophy size={11} />{s.total_sets} sets
                </div>
                {s.total_volume_kg > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <Weight size={11} />{s.total_volume_kg.toLocaleString()} kg
                  </div>
                )}
                {s.strength_strain > 0 && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold"
                       style={{ color: strainColor(s.strength_strain) }}>
                    <Flame size={11} />{s.strength_strain} strain
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Quick start overlay — z-[60] so it sits above the nav (z-50) */}
      <AnimatePresence>
        {showQuickStart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 flex items-end"
            onClick={() => setShowQuickStart(false)}
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
              <div className="px-6 pt-6 pb-2">
                <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />
                <h3 className="text-lg font-semibold mb-4">Start Workout</h3>
              </div>
              <div className="px-4 space-y-2 mb-3">
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => startFromTemplate(t)}
                    className="w-full flex items-center justify-between bg-white/6 rounded-2xl px-4 py-3.5 active:bg-white/10"
                  >
                    <div className="text-left">
                      <p className="text-sm font-medium text-white">{t.name}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t.exercises.length} exercises</p>
                    </div>
                    <ChevronRight size={16} className="text-white/30" />
                  </button>
                ))}
              </div>
              <div className="px-4">
                <button
                  onClick={startQuick}
                  className="w-full py-3.5 bg-indigo-500 rounded-2xl text-sm font-semibold active:bg-indigo-600"
                >
                  Empty Workout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template builder */}
      <AnimatePresence>
        {showBuilder && (
          <TemplateBuilder
            existing={editTemplate}
            onClose={() => { setShowBuilder(false); loadData() }}
          />
        )}
      </AnimatePresence>

      {/* Active session */}
      <AnimatePresence>
        {activeSession && (
          <ActiveSession
            session={activeSession}
            onFinish={() => { setActiveSession(null); loadData() }}
          />
        )}
      </AnimatePresence>

      {/* History detail */}
      <AnimatePresence>
        {detailSid !== null && (
          <SessionDetailSheet
            sid={detailSid}
            onClose={() => setDetailSid(null)}
            onDeleted={() => { setDetailSid(null); loadData() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
