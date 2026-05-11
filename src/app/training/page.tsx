'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, X, ChevronRight, Dumbbell, Clock,
  Search, Check, ChevronDown, Trash2, Play, RotateCcw,
  Trophy, Weight
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

const CATEGORY_COLORS: Record<string, string> = {
  Push:  'bg-blue-500/20 text-blue-300',
  Pull:  'bg-purple-500/20 text-purple-300',
  Legs:  'bg-green-500/20 text-green-300',
  Arms:  'bg-orange-500/20 text-orange-300',
  Core:  'bg-pink-500/20 text-pink-300',
}

const CATEGORIES = ['Push', 'Pull', 'Legs', 'Arms', 'Core']

// ─── Exercise Picker Sheet ────────────────────────────────────────────────────

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
  const [exercises, setExercises] = useState<TrainingExercise[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set(selected))

  useEffect(() => {
    api.training.getExercises(q, cat).then(setExercises)
  }, [q, cat])

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

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f]"
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
          return (
            <button
              key={ex.id}
              onClick={() => toggle(ex)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                sel ? 'bg-indigo-500/15 border border-indigo-500/30' : 'bg-white/4 active:bg-white/8'
              }`}
            >
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-white">{ex.name}</p>
                <p className="text-xs text-white/40 mt-0.5">{ex.equipment}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[ex.category] ?? 'bg-white/10 text-white/50'}`}>
                {ex.category}
              </span>
              {multi && sel && <Check size={15} className="text-indigo-400 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
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
        className="fixed inset-0 z-40 flex flex-col bg-[#0f0f0f]"
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

function DupBadge({ rec }: { rec: import('@/lib/api').DupRecommendation }) {
  const style = PHASE_STYLE[rec.phase] ?? PHASE_STYLE.Hypertrophy
  const weightStr = rec.weight_kg
    ? `${rec.weight_kg} kg${rec.per_hand ? ' / hand' : ''}`
    : 'Bodyweight'
  return (
    <div className={`rounded-xl p-3 ${style.bg} border border-white/5`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${style.text}`}>
          {rec.phase} Day
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-white font-bold text-base">
          {rec.sets} × {rec.reps_low}{rec.reps_low !== rec.reps_high ? `–${rec.reps_high}` : ''}
        </span>
        <span className={`text-sm font-semibold ${style.text}`}>{weightStr}</span>
      </div>
      <p className="text-[10px] text-white/30 mt-1">{rec.note}</p>
    </div>
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

function ActiveSession({
  session,
  onFinish,
}: {
  session: { session_id: number; name: string; exercises: TrainingExercise[] }
  onFinish: () => void
}) {
  const [sets, setSets] = useState<Record<number, ActiveSet[]>>({})
  const [perf, setPerf] = useState<Record<number, LastPerformance>>({})
  const [openEx, setOpenEx] = useState<number | null>(session.exercises[0]?.id ?? null)
  // Open picker immediately if session started with no exercises (empty workout)
  const [showAddEx, setShowAddEx] = useState(session.exercises.length === 0)
  const [allExercises, setAllExercises] = useState<TrainingExercise[]>(session.exercises)
  const [finishing, setFinishing] = useState(false)

  // Load last performance + DUP recommendation for each exercise
  useEffect(() => {
    allExercises.forEach(ex => {
      if (perf[ex.id]) return   // already loaded
      api.training.lastPerformance(ex.id).then(p => {
        setPerf(prev => ({ ...prev, [ex.id]: p }))
      }).catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExercises])

  const getExSets = (exId: number): ActiveSet[] => sets[exId] ?? []

  const addSet = (exId: number) => {
    setSets(prev => {
      const cur = prev[exId] ?? []
      const last = cur[cur.length - 1]
      // Pre-fill with DUP recommendation if no previous sets yet
      const rec = perf[exId]?.recommendation
      return {
        ...prev,
        [exId]: [...cur, {
          set_number: cur.length + 1,
          weight_kg: last?.weight_kg ?? (rec?.weight_kg ? String(rec.weight_kg) : ''),
          reps: last?.reps ?? (rec ? String(rec.reps_high) : ''),
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

  const finish = async () => {
    setFinishing(true)
    try {
      await api.training.finishSession(session.session_id)
      onFinish()
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
        className="fixed inset-0 z-40 flex flex-col bg-[#0a0a0a]"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-6 pb-2 border-b border-white/8">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white">{session.name}</h2>
            <p className="text-xs text-white/40 mt-0.5">In progress</p>
          </div>
          <button
            onClick={finish}
            disabled={finishing}
            className="px-4 py-2 bg-green-500 rounded-xl text-sm font-semibold text-black active:scale-95 disabled:opacity-60"
          >
            {finishing ? '…' : 'Finish'}
          </button>
        </div>

        {/* Exercise list */}
        <div className="flex-1 overflow-y-auto pb-32">
          {allExercises.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-white/30">
              <Dumbbell size={32} className="mb-3 opacity-30" />
              <p className="text-sm">No exercises yet</p>
              <button
                onClick={() => setShowAddEx(true)}
                className="mt-4 px-5 py-2.5 bg-indigo-500 rounded-xl text-sm font-semibold text-white"
              >
                Add Exercise
              </button>
            </div>
          )}

          {allExercises.map(ex => {
            const exSets = getExSets(ex.id)
            const lastP = perf[ex.id]
            const rec = lastP?.recommendation ?? null
            const isOpen = openEx === ex.id
            const savedCount = exSets.filter(s => s.saved).length

            return (
              <div key={ex.id} className="border-b border-white/5">
                <button
                  onClick={() => setOpenEx(isOpen ? null : ex.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5"
                >
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">{ex.name}</p>
                    {lastP?.summary ? (
                      <p className="text-xs text-white/35 mt-0.5">Last: {lastP.summary}</p>
                    ) : rec ? (
                      <p className={`text-xs mt-0.5 ${PHASE_STYLE[rec.phase]?.text ?? 'text-white/40'}`}>
                        {rec.phase} · {rec.sets}×{rec.reps_low}{rec.reps_low !== rec.reps_high ? `–${rec.reps_high}` : ''}
                        {rec.weight_kg ? ` @ ${rec.weight_kg}kg` : ''}
                      </p>
                    ) : null}
                  </div>
                  {savedCount > 0 && (
                    <span className="text-xs text-green-400 font-medium">{savedCount} sets</span>
                  )}
                  <ChevronDown size={15} className={`text-white/30 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-3">

                    {/* DUP recommendation card */}
                    {rec && <DupBadge rec={rec} />}

                    {/* Last performance */}
                    {lastP?.sets && lastP.sets.length > 0 && (
                      <div className="p-2.5 bg-white/4 rounded-xl">
                        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">
                          Last session · {lastP.session_date}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {lastP.sets.map((s, i) => (
                            <span key={i} className="text-xs text-white/60 bg-white/6 px-2 py-0.5 rounded-lg">
                              {s.weight_kg ? `${s.weight_kg}kg` : 'BW'} × {s.reps}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sets */}
                    {exSets.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex gap-2 px-1">
                          <span className="w-6 text-[10px] text-white/20 text-center">SET</span>
                          <span className="flex-1 text-[10px] text-white/20 text-center">
                            {ex.equipment === 'Dumbbell' ? 'KG / HAND' : 'KG'}
                          </span>
                          <span className="flex-1 text-[10px] text-white/20 text-center">REPS</span>
                          <span className="w-10" />
                        </div>
                        {exSets.map((s, i) => (
                          <div key={i} className={`flex items-center gap-2 rounded-xl p-2 transition-colors ${s.saved ? 'bg-green-500/10' : 'bg-white/5'}`}>
                            <span className="w-6 text-xs text-white/30 text-center">{s.set_number}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={s.weight_kg}
                              onChange={e => updateSet(ex.id, i, 'weight_kg', e.target.value)}
                              placeholder="—"
                              disabled={s.saved}
                              className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-sm text-white text-center outline-none disabled:opacity-50"
                            />
                            <input
                              type="number"
                              inputMode="numeric"
                              value={s.reps}
                              onChange={e => updateSet(ex.id, i, 'reps', e.target.value)}
                              placeholder="0"
                              disabled={s.saved}
                              className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-sm text-white text-center outline-none disabled:opacity-50"
                            />
                            {s.saved ? (
                              <button onClick={() => deleteSet(ex.id, i)} className="w-10 flex justify-center text-white/20 active:text-red-400">
                                <X size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => saveSet(ex.id, i)}
                                disabled={!s.reps}
                                className="w-10 flex justify-center text-white/30 active:text-green-400 disabled:opacity-20"
                              >
                                <Check size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => addSet(ex.id)}
                      className="w-full py-2.5 border border-dashed border-white/10 rounded-xl text-sm text-white/40 active:bg-white/5 flex items-center justify-center gap-1.5"
                    >
                      <Plus size={14} />
                      Add set
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Add exercise button */}
          {allExercises.length > 0 && (
            <button
              onClick={() => setShowAddEx(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-4 text-white/30 text-sm active:bg-white/5"
            >
              <Plus size={15} />
              Add exercise
            </button>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showAddEx && (
          <div className="fixed inset-0 z-50">
            <ExercisePicker
              onClose={() => setShowAddEx(false)}
              onSelect={([ex]) => {
                if (ex && !allExercises.find(e => e.id === ex.id)) {
                  setAllExercises(prev => [...prev, ex])
                  setOpenEx(ex.id)
                }
                setShowAddEx(false)
              }}
            />
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── History Session Detail ───────────────────────────────────────────────────

function SessionDetailSheet({ sid, onClose }: { sid: number; onClose: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)

  useEffect(() => {
    api.training.getSession(sid).then(setDetail)
  }, [sid])

  if (!detail) return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#0f0f0f]"
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
      className="fixed inset-0 z-40 flex flex-col bg-[#0f0f0f]"
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
      <div className="grid grid-cols-3 gap-3 px-4 mb-4">
        {[
          { icon: Clock, label: 'Duration', value: fmtDuration(detail.started_at, detail.finished_at) },
          { icon: Weight, label: 'Volume', value: `${Math.round(totalVolume).toLocaleString()} kg` },
          { icon: Dumbbell, label: 'Exercises', value: detail.exercises.length },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white/5 rounded-2xl p-3 text-center">
            <Icon size={14} className="mx-auto text-white/30 mb-1" />
            <p className="text-base font-bold">{value}</p>
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
      </div>
    </motion.div>
  )
}

// ─── Strength Profile (anchor maxes) ─────────────────────────────────────────

function StrengthProfile() {
  const [maxes, setMaxes] = useState<{ bench_1rm: number | null; row_1rm: number | null; squat_1rm: number | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [bench, setBench] = useState('')
  const [row, setRow]     = useState('')
  const [squat, setSquat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.training.getMaxes().then(m => {
      setMaxes(m)
      setBench(m.bench_1rm ? String(m.bench_1rm) : '')
      setRow(m.row_1rm     ? String(m.row_1rm)   : '')
      setSquat(m.squat_1rm ? String(m.squat_1rm) : '')
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.training.updateMaxes({
        bench_1rm: bench ? parseFloat(bench) : undefined,
        row_1rm:   row   ? parseFloat(row)   : undefined,
        squat_1rm: squat ? parseFloat(squat) : undefined,
      })
      const updated = {
        bench_1rm: bench ? parseFloat(bench) : null,
        row_1rm:   row   ? parseFloat(row)   : null,
        squat_1rm: squat ? parseFloat(squat) : null,
      }
      setMaxes(updated)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const hasAny = maxes && (maxes.bench_1rm || maxes.row_1rm || maxes.squat_1rm)

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
            { label: 'Bench', val: maxes?.bench_1rm },
            { label: 'Row',   val: maxes?.row_1rm },
            { label: 'Squat', val: maxes?.squat_1rm },
          ].map(({ label, val }) => (
            <div key={label} className="flex-1 text-center">
              <p className="text-base font-bold">{val ? `${val}` : '—'}</p>
              <p className="text-[10px] text-white/30 mt-0.5">{label} 1RM kg</p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-white/40">Enter your estimated 1-rep maxes. These seed all DUP weight recommendations.</p>
          {[
            { label: 'Bench Press 1RM (kg)', val: bench, set: setBench },
            { label: 'Barbell Row 1RM (kg)', val: row,   set: setRow },
            { label: 'Squat 1RM (kg)',        val: squat, set: setSquat },
          ].map(({ label, val, set }) => (
            <div key={label}>
              <p className="text-xs text-white/40 mb-1">{label}</p>
              <input
                type="number"
                inputMode="decimal"
                value={val}
                onChange={e => set(e.target.value)}
                placeholder="e.g. 100"
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
          <SessionDetailSheet sid={detailSid} onClose={() => setDetailSid(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
