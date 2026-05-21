'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Utensils, X, Plus, Settings, Search, Sparkles,
  Trash2, Loader2, ChevronRight, Check, ScanBarcode,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useRouter } from 'next/navigation'

// Dynamic import — camera APIs are browser-only
const BarcodeScanner = dynamic(
  () => import('@/components/ui/BarcodeScanner').then(m => m.BarcodeScanner),
  { ssr: false }
)
import {
  api,
  NutritionGoals,
  DiaryDay,
  FoodLogEntry,
  FoodSearchResult,
  FoodSuggestion,
  SuggestResponse,
} from '@/lib/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']
const MEAL_EMOJI: Record<string, string> = {
  Breakfast: '🌅', Lunch: '☀️', Dinner: '🌙', Snacks: '🍎',
}
const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light',     label: 'Light' },
  { value: 'moderate',  label: 'Moderate' },
  { value: 'active',    label: 'Active' },
  { value: 'very',      label: 'Very active' },
]

// Goal type presets: calorie offset vs TDEE, and suggested macro % splits
const GOAL_PRESETS: Record<string, {
  label: string; emoji: string; offsetDesc: string
  calOffset: number; protein: number; carbs: number; fat: number
}> = {
  lose:        { label: 'Lose weight',  emoji: '📉', offsetDesc: '−500 kcal deficit', calOffset: -500, protein: 40, carbs: 30, fat: 30 },
  maintain:    { label: 'Maintain',     emoji: '⚖️', offsetDesc: 'Match your burn',   calOffset: 0,    protein: 30, carbs: 40, fat: 30 },
  gain:        { label: 'Gain muscle',  emoji: '💪', offsetDesc: '+300 kcal surplus',  calOffset: +300, protein: 35, carbs: 40, fat: 25 },
  performance: { label: 'Performance',  emoji: '🏆', offsetDesc: '+200 kcal, carb-led', calOffset: +200, protein: 25, carbs: 55, fat: 20 },
}

// Kcal per gram for each macro
const KCAL: Record<string, number> = { protein: 4, carbs: 4, fat: 9 }

// ─── MacroRing ─────────────────────────────────────────────────────────────────

function MacroRing({
  value, goal, color, label, unit,
}: {
  value: number; goal: number; color: string; label: string; unit: string
}) {
  const pct = Math.min(value / Math.max(goal, 1), 1)
  const r = 28, sw = 5, size = 72
  const circ = 2 * Math.PI * r
  const over = value > goal

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={over ? '#ef4444' : color} strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${Math.min(pct, 1) * circ} ${circ}`} />
        </svg>
        <div className="absolute text-center">
          <p className="text-[11px] font-bold leading-none" style={{ color: over ? '#ef4444' : 'white' }}>
            {Math.round(value)}
          </p>
          <p className="text-[9px] text-white/30 leading-none mt-0.5">{unit}</p>
        </div>
      </div>
      <p className="text-[10px] text-white/40 leading-none">{label}</p>
      <p className="text-[9px] text-white/25">/ {Math.round(goal)}</p>
    </div>
  )
}

// ─── CalorieHero ───────────────────────────────────────────────────────────────

function CalorieHero({ balance, goals }: { balance: DiaryDay['calorie_balance']; goals: NutritionGoals }) {
  const remaining = balance.remaining
  const over = remaining < 0
  const pct = Math.min(balance.consumed / Math.max(goals.calories, 1), 1.2)
  const r = 66, sw = 10, size = 160
  const circ = 2 * Math.PI * r
  const color = over ? '#ef4444' : remaining < goals.calories * 0.15 ? '#f59e0b' : '#22c55e'

  return (
    <GlassCard className="flex flex-col items-center py-5">
      <div className="relative flex items-center justify-center mb-4" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${pct * circ} ${circ}`}
            initial={{ strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${pct * circ} ${circ}` }}
            transition={{ duration: 0.8, ease: 'easeOut' }} />
        </svg>
        <div className="absolute text-center">
          <p className="text-3xl font-bold" style={{ color }}>
            {Math.abs(Math.round(remaining))}
          </p>
          <p className="text-xs text-white/40 mt-0.5">{over ? 'over' : 'remaining'}</p>
          <p className="text-[10px] text-white/25 mt-0.5">kcal</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-0 w-full border-t border-white/8 pt-4">
        <div className="text-center px-2">
          <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1">Goal</p>
          <p className="text-base font-bold">{Math.round(balance.goal)}</p>
        </div>
        <div className="text-center px-2 border-x border-white/8">
          <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1">Eaten</p>
          <p className="text-base font-bold text-amber-400">{Math.round(balance.consumed)}</p>
        </div>
        <div className="text-center px-2">
          <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1">Burned</p>
          <p className="text-base font-bold text-blue-400">{Math.round(balance.burned)}</p>
        </div>
      </div>
    </GlassCard>
  )
}

// ─── MacroRow ──────────────────────────────────────────────────────────────────

function MacroRow({ totals, goals }: { totals: DiaryDay['totals']; goals: NutritionGoals }) {
  return (
    <GlassCard>
      <p className="text-xs text-white/40 uppercase tracking-wider mb-4">Macros</p>
      <div className="flex justify-around">
        <MacroRing value={totals.protein_g} goal={goals.protein_g} color="#3b82f6" label="Protein" unit="g" />
        <MacroRing value={totals.carbs_g}   goal={goals.carbs_g}   color="#22c55e" label="Carbs"   unit="g" />
        <MacroRing value={totals.fat_g}     goal={goals.fat_g}     color="#f97316" label="Fat"     unit="g" />
        <MacroRing value={totals.calories}  goal={goals.calories}  color="#f59e0b" label="Calories" unit="kcal" />
      </div>
    </GlassCard>
  )
}

// ─── FoodRow ───────────────────────────────────────────────────────────────────

function FoodRow({ entry, onDelete }: { entry: FoodLogEntry; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.food_name}</p>
        {entry.brand && <p className="text-xs text-white/30 truncate">{entry.brand}</p>}
        <p className="text-xs text-white/30 mt-0.5">{entry.quantity_g}g</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-amber-400">{Math.round(entry.calories)} kcal</p>
        <p className="text-[10px] text-white/25 mt-0.5">
          P {Math.round(entry.protein_g)}g · C {Math.round(entry.carbs_g)}g · F {Math.round(entry.fat_g)}g
        </p>
      </div>
      <button
        onClick={onDelete}
        className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center active:bg-red-500/20 transition-colors shrink-0 ml-1"
      >
        <Trash2 size={12} className="text-white/30" />
      </button>
    </div>
  )
}

// ─── MealSection ───────────────────────────────────────────────────────────────

function MealSection({
  meal, entries, onAdd, onDelete,
}: {
  meal: string
  entries: FoodLogEntry[]
  onAdd: () => void
  onDelete: (id: number) => void
}) {
  const total = entries.reduce((s, e) => s + e.calories, 0)

  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{MEAL_EMOJI[meal] ?? '🍽️'}</span>
          <span className="text-sm font-semibold">{meal}</span>
          {entries.length > 0 && (
            <span className="text-xs text-amber-400 font-medium">{Math.round(total)} kcal</span>
          )}
        </div>
        <button
          onClick={onAdd}
          className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Plus size={14} className="text-indigo-400" />
        </button>
      </div>

      {entries.length > 0 && (
        <div className="px-4 pb-3">
          {entries.map(e => (
            <FoodRow key={e.id} entry={e} onDelete={() => onDelete(e.id)} />
          ))}
        </div>
      )}
    </GlassCard>
  )
}

// ─── AddFoodSheet ──────────────────────────────────────────────────────────────

function AddFoodSheet({
  meal,
  onAdd,
  onClose,
}: {
  meal: string
  onAdd: (result: FoodSearchResult, qty: number) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FoodSearchResult | null>(null)
  const [qty, setQty] = useState('100')
  const [adding, setAdding] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 300) }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api.nutrition.searchFood(query.trim())
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 450)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const handleBarcodeScan = async (code: string) => {
    setShowScanner(false)
    setBarcodeLoading(true)
    setBarcodeError(null)
    try {
      const product = await api.nutrition.lookupBarcode(code)
      setSelected(product)
      setQty(String(product.serving_size_g || 100))
    } catch {
      setBarcodeError(`No product found for barcode ${code}. Try searching by name instead.`)
    } finally {
      setBarcodeLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!selected) return
    const qtyNum = parseFloat(qty)
    if (!qtyNum || qtyNum <= 0) return
    setAdding(true)
    try {
      await onAdd(selected, qtyNum)
    } finally {
      setAdding(false)
    }
  }

  const qtyNum = parseFloat(qty) || 0
  const ratio = qtyNum / 100

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-3xl bg-[#111] border-t border-white/10"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}>

        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pt-2 pb-3 shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">Add to</p>
              <h2 className="text-xl font-bold">{meal}</h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
              <X size={14} className="text-white/60" />
            </button>
          </div>

          {/* Search + scan row */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
              {searching || barcodeLoading ? (
                <Loader2 size={15} className="text-white/30 animate-spin shrink-0" />
              ) : (
                <Search size={15} className="text-white/30 shrink-0" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(null); setBarcodeError(null) }}
                placeholder="Search food or brand…"
                className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none"
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults([]); setSelected(null) }}>
                  <X size={13} className="text-white/30" />
                </button>
              )}
            </div>
            {/* Barcode scan button */}
            <button
              onClick={() => { setBarcodeError(null); setShowScanner(true) }}
              className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center active:scale-90 transition-transform shrink-0"
              title="Scan barcode"
            >
              <ScanBarcode size={18} className="text-indigo-400" />
            </button>
          </div>

          {/* Barcode error */}
          {barcodeError && (
            <div className="px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 leading-relaxed">{barcodeError}</p>
            </div>
          )}
        </div>

        {/* Barcode scanner — full-screen overlay on top of this sheet */}
        <AnimatePresence>
          {showScanner && (
            <BarcodeScanner
              onDetect={handleBarcodeScan}
              onClose={() => setShowScanner(false)}
            />
          )}
        </AnimatePresence>

        {/* Results / selected */}
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {selected ? (
            <div className="space-y-4">
              {/* Selected food card */}
              <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold">{selected.name}</p>
                    {selected.brand && <p className="text-xs text-white/40 mt-0.5">{selected.brand}</p>}
                  </div>
                  <button onClick={() => setSelected(null)} className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                    <X size={11} className="text-white/50" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { label: 'Calories', value: Math.round(selected.calories_100g * ratio) },
                    { label: 'Protein',  value: `${(selected.protein_100g * ratio).toFixed(1)}g` },
                    { label: 'Carbs',    value: `${(selected.carbs_100g   * ratio).toFixed(1)}g` },
                    { label: 'Fat',      value: `${(selected.fat_100g     * ratio).toFixed(1)}g` },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl bg-white/5 p-2">
                      <p className="text-white/40 mb-0.5">{m.label}</p>
                      <p className="font-bold text-sm">{m.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quantity picker */}
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Serving size</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
                    <input
                      type="number"
                      value={qty}
                      onChange={e => setQty(e.target.value)}
                      className="flex-1 bg-transparent text-lg font-bold text-white outline-none w-20"
                      min="1"
                    />
                    <span className="text-sm text-white/40">g</span>
                  </div>
                  {selected.serving_size_g && selected.serving_size_g !== 100 && (
                    <button
                      onClick={() => setQty(String(selected.serving_size_g))}
                      className="text-xs text-indigo-400 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 whitespace-nowrap"
                    >
                      1 serving ({selected.serving_size_g}g)
                    </button>
                  )}
                </div>
              </div>

              {/* Add button */}
              <button
                onClick={handleAdd}
                disabled={adding || !qty || parseFloat(qty) <= 0}
                className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {adding ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {adding ? 'Adding…' : `Add ${Math.round(selected.calories_100g * ratio)} kcal to ${meal}`}
              </button>
            </div>
          ) : (
            <>
              {results.length > 0 ? (
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelected(r); setQty(String(r.serving_size_g || 100)) }}
                      className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/8 active:bg-white/10 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        {r.brand && <p className="text-xs text-white/35 truncate">{r.brand}</p>}
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-bold text-amber-400">{Math.round(r.calories_100g)}</p>
                        <p className="text-[10px] text-white/30">kcal/100g</p>
                      </div>
                      <ChevronRight size={14} className="text-white/20 ml-2 shrink-0" />
                    </button>
                  ))}
                </div>
              ) : query.length >= 2 && !searching ? (
                <div className="text-center py-8">
                  <p className="text-white/30 text-sm">No results for &ldquo;{query}&rdquo;</p>
                  <p className="text-white/20 text-xs mt-1">Try a different spelling or brand name</p>
                </div>
              ) : query.length < 2 ? (
                <div className="text-center py-8">
                  <Search size={32} className="mx-auto text-white/10 mb-3" />
                  <p className="text-white/25 text-sm">Search millions of foods</p>
                  <p className="text-white/15 text-xs mt-1">Powered by Open Food Facts</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── GoalsSheet ────────────────────────────────────────────────────────────────

interface GoalsFormState {
  calories:       number
  proteinPct:     number
  carbsPct:       number
  fatPct:         number
  goal_type:      string
  activity_level: string
}

function pctFromGoals(g: NutritionGoals): { proteinPct: number; carbsPct: number; fatPct: number } {
  const cal = Math.max(g.calories, 1)
  return {
    proteinPct: Math.round((g.protein_g * KCAL.protein / cal) * 100),
    carbsPct:   Math.round((g.carbs_g   * KCAL.carbs   / cal) * 100),
    fatPct:     Math.round((g.fat_g     * KCAL.fat     / cal) * 100),
  }
}

function GoalsSheet({
  goals,
  tdee,
  onSave,
  onClose,
}: {
  goals: NutritionGoals
  tdee: number
  onSave: (g: NutritionGoals) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<GoalsFormState>(() => ({
    calories:       goals.calories,
    ...pctFromGoals(goals),
    goal_type:      goals.goal_type,
    activity_level: goals.activity_level,
  }))
  const [saving, setSaving] = useState(false)

  // Derived gram values from calories × percentage
  const protein_g = Math.round(form.calories * form.proteinPct / 100 / KCAL.protein)
  const carbs_g   = Math.round(form.calories * form.carbsPct   / 100 / KCAL.carbs)
  const fat_g     = Math.round(form.calories * form.fatPct     / 100 / KCAL.fat)
  const totalPct  = form.proteinPct + form.carbsPct + form.fatPct
  const pctOk     = Math.abs(totalPct - 100) <= 1

  // Apply a goal type preset — sets suggested calories AND macro splits
  const applyPreset = (type: string) => {
    const preset = GOAL_PRESETS[type]
    if (!preset) return
    const baseCal = tdee > 0 ? tdee : 2000
    const newCal  = Math.max(1200, Math.round(baseCal + preset.calOffset))
    setForm(f => ({
      ...f,
      goal_type:  type,
      calories:   newCal,
      proteinPct: preset.protein,
      carbsPct:   preset.carbs,
      fatPct:     preset.fat,
    }))
  }

  const setPct = (macro: 'proteinPct' | 'carbsPct' | 'fatPct', raw: string) => {
    const v = parseFloat(raw)
    if (isNaN(v)) return
    setForm(f => ({ ...f, [macro]: Math.max(0, Math.min(100, v)) }))
  }

  // Allow editing grams directly → back-calculates % from new gram value
  const setGrams = (macro: 'protein' | 'carbs' | 'fat', raw: string) => {
    const g = parseFloat(raw)
    if (isNaN(g) || g < 0) return
    const kcalPerG = KCAL[macro]
    const newPct = form.calories > 0
      ? Math.round((g * kcalPerG / form.calories) * 100)
      : 0
    const key = macro === 'protein' ? 'proteinPct' : macro === 'carbs' ? 'carbsPct' : 'fatPct'
    setForm(f => ({ ...f, [key]: Math.max(0, newPct) }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        ...goals,
        calories:       form.calories,
        protein_g,
        carbs_g,
        fat_g,
        goal_type:      form.goal_type,
        activity_level: form.activity_level,
      })
    } finally { setSaving(false) }
  }

  const macros = [
    { key: 'protein' as const, pctKey: 'proteinPct' as const, label: 'Protein', color: '#3b82f6', grams: protein_g },
    { key: 'carbs'   as const, pctKey: 'carbsPct'   as const, label: 'Carbs',   color: '#22c55e', grams: carbs_g   },
    { key: 'fat'     as const, pctKey: 'fatPct'     as const, label: 'Fat',     color: '#f97316', grams: fat_g     },
  ]

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}>

        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-10 pt-2 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">Daily targets</p>
              <h2 className="text-xl font-bold">Nutrition Goals</h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
              <X size={14} className="text-white/60" />
            </button>
          </div>

          {/* Goal type presets */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Goal type</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(GOAL_PRESETS).map(([key, preset]) => {
                const active = form.goal_type === key
                const targetCal = tdee > 0 ? Math.max(1200, tdee + preset.calOffset) : null
                return (
                  <button key={key} onClick={() => applyPreset(key)}
                    className={`flex flex-col items-start px-3 py-3 rounded-2xl border transition-colors text-left ${
                      active
                        ? 'bg-indigo-500/20 border-indigo-500/40'
                        : 'bg-white/5 border-white/8'
                    }`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-base leading-none">{preset.emoji}</span>
                      <span className={`text-sm font-semibold ${active ? 'text-indigo-300' : 'text-white/70'}`}>
                        {preset.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/30 leading-tight">{preset.offsetDesc}</p>
                    {targetCal && (
                      <p className="text-[10px] mt-0.5" style={{ color: active ? '#818cf8' : 'rgba(255,255,255,0.2)' }}>
                        → {targetCal.toLocaleString()} kcal
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
            {tdee > 0 && (
              <p className="text-[10px] text-white/25 mt-2 text-center">
                Based on your Garmin burn today: {Math.round(tdee).toLocaleString()} kcal
              </p>
            )}
          </div>

          {/* Daily calories — large manual input */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Daily calories</p>
            <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-white/5 border border-amber-500/20">
              <div className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
              <input
                type="number"
                inputMode="numeric"
                value={form.calories}
                onChange={e => setForm(f => ({ ...f, calories: parseInt(e.target.value) || 0 }))}
                className="flex-1 bg-transparent text-2xl font-bold text-white outline-none min-w-0"
              />
              <span className="text-sm text-white/40 shrink-0">kcal / day</span>
            </div>
            <p className="text-[10px] text-white/25 mt-1.5 px-1">
              Macros below will recalculate automatically when you change this
            </p>
          </div>

          {/* Activity level */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Activity level</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {ACTIVITY_LEVELS.map(a => (
                <button key={a.value}
                  onClick={() => setForm(f => ({ ...f, activity_level: a.value }))}
                  className={`py-2 px-3 rounded-xl text-xs font-medium border whitespace-nowrap transition-colors ${
                    form.activity_level === a.value
                      ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                      : 'bg-white/5 border-white/8 text-white/50'
                  }`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Macro split */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 uppercase tracking-wider">Macro split</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                pctOk
                  ? 'bg-green-500/15 text-green-400'
                  : 'bg-red-500/15 text-red-400'
              }`}>
                {totalPct}% {pctOk ? '✓' : '≠ 100'}
              </span>
            </div>

            {/* Visual proportion bar */}
            <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-0.5">
              {macros.map(m => (
                <div key={m.key} className="rounded-full transition-all duration-300"
                  style={{ backgroundColor: m.color, width: `${m.pctKey === 'proteinPct' ? form.proteinPct : m.pctKey === 'carbsPct' ? form.carbsPct : form.fatPct}%` }} />
              ))}
            </div>

            {/* Per-macro rows */}
            <div className="space-y-3">
              {macros.map(m => (
                <div key={m.key} className="rounded-2xl bg-white/5 border border-white/8 p-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="text-sm font-medium flex-1">{m.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* % input with stepper */}
                    <div className="flex items-center rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                      <button
                        onClick={() => setPct(m.pctKey, String((form[m.pctKey] - 5)))}
                        className="px-2.5 py-2 text-white/40 active:bg-white/10 text-sm font-bold">−</button>
                      <input
                        type="number"
                        value={form[m.pctKey]}
                        onChange={e => setPct(m.pctKey, e.target.value)}
                        className="w-10 text-center bg-transparent text-sm font-bold text-white outline-none"
                      />
                      <button
                        onClick={() => setPct(m.pctKey, String(form[m.pctKey] + 5))}
                        className="px-2.5 py-2 text-white/40 active:bg-white/10 text-sm font-bold">+</button>
                    </div>
                    <span className="text-xs text-white/30">%</span>
                    <span className="text-white/20 mx-1">=</span>
                    {/* Gram input — editable, back-calculates % */}
                    <div className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                      <input
                        type="number"
                        value={m.grams}
                        onChange={e => setGrams(m.key, e.target.value)}
                        className="w-full bg-transparent text-sm font-bold text-white outline-none text-right"
                      />
                      <span className="text-xs text-white/30 shrink-0">g</span>
                    </div>
                    <span className="text-[10px] text-white/20 shrink-0 w-16 text-right">
                      {Math.round(m.grams * KCAL[m.key])} kcal
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? 'Saving…' : 'Save goals'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── SuggestSheet ──────────────────────────────────────────────────────────────

function SuggestSheet({
  suggest,
  onAdd,
  onClose,
}: {
  suggest: SuggestResponse
  onAdd: (food: FoodSuggestion, meal: string) => Promise<void>
  onClose: () => void
}) {
  const [addingId, setAddingId] = useState<string | null>(null)
  const [selectedMeal, setSelectedMeal] = useState('Snacks')

  const handleAdd = async (food: FoodSuggestion) => {
    setAddingId(food.name)
    try { await onAdd(food, selectedMeal) } finally { setAddingId(null) }
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}>

        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-10 pt-2 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">Based on remaining macros</p>
              <h2 className="text-xl font-bold">Suggested Foods</h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
              <X size={14} className="text-white/60" />
            </button>
          </div>

          {/* Remaining summary */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Calories', value: Math.round(suggest.remaining.calories), unit: 'kcal', color: '#f59e0b' },
              { label: 'Protein',  value: Math.round(suggest.remaining.protein_g), unit: 'g',    color: '#3b82f6' },
              { label: 'Carbs',    value: Math.round(suggest.remaining.carbs_g),   unit: 'g',    color: '#22c55e' },
              { label: 'Fat',      value: Math.round(suggest.remaining.fat_g),     unit: 'g',    color: '#f97316' },
            ].map(m => (
              <div key={m.label} className="rounded-2xl bg-white/5 border border-white/8 p-2.5">
                <p className="text-[10px] text-white/35 mb-1">{m.label}</p>
                <p className="text-base font-bold" style={{ color: m.value > 0 ? m.color : '#ef4444' }}>
                  {m.value > 0 ? m.value : '—'}
                </p>
                <p className="text-[10px] text-white/25">{m.unit}</p>
              </div>
            ))}
          </div>

          {/* Add to meal picker */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Add to meal</p>
            <div className="flex gap-2">
              {MEALS.map(m => (
                <button key={m}
                  onClick={() => setSelectedMeal(m)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    selectedMeal === m
                      ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                      : 'bg-white/5 border-white/8 text-white/40'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Suggestion cards */}
          <div className="space-y-3">
            {suggest.suggestions.map((food, i) => (
              <div key={i} className="rounded-2xl bg-white/5 border border-white/8 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{food.name}</p>
                    <p className="text-xs text-white/40 mt-0.5">{food.serving_g}g serving</p>
                  </div>
                  <button
                    onClick={() => handleAdd(food)}
                    disabled={addingId === food.name}
                    className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50 shrink-0 ml-3"
                  >
                    {addingId === food.name
                      ? <Loader2 size={13} className="animate-spin text-indigo-400" />
                      : <Plus size={14} className="text-indigo-400" />}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                  {[
                    { label: 'kcal',  value: Math.round(food.calories),   color: '#f59e0b' },
                    { label: 'pro',   value: `${food.protein_g.toFixed(1)}g`,  color: '#3b82f6' },
                    { label: 'carbs', value: `${food.carbs_g.toFixed(1)}g`,    color: '#22c55e' },
                    { label: 'fat',   value: `${food.fat_g.toFixed(1)}g`,      color: '#f97316' },
                  ].map(m => (
                    <div key={m.label} className="text-center py-1.5 rounded-xl bg-white/5">
                      <p className="text-xs font-bold" style={{ color: m.color }}>{m.value}</p>
                      <p className="text-[9px] text-white/30 mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-white/40 leading-relaxed">{food.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function NutritionPage() {
  const router = useRouter()
  const [diary, setDiary] = useState<DiaryDay | null>(null)
  const [goals, setGoals] = useState<NutritionGoals | null>(null)
  const [loading, setLoading] = useState(true)
  const [showGoals, setShowGoals] = useState(false)
  const [addMeal, setAddMeal] = useState<string | null>(null)
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null)
  const [loadingSuggest, setLoadingSuggest] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    try {
      const [d, g] = await Promise.all([
        api.nutrition.getDiary(today),
        api.nutrition.getGoals(),
      ])
      setDiary(d)
      setGoals(g)
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'UNAUTHORIZED') router.push('/settings')
    } finally {
      setLoading(false)
    }
  }, [today, router])

  useEffect(() => { load() }, [load])

  const handleDeleteFood = async (id: number) => {
    try {
      await api.nutrition.deleteFood(id)
      await load()
    } catch { /* ignore */ }
  }

  const handleAddFood = async (meal: string, result: FoodSearchResult, qty: number) => {
    await api.nutrition.addFood({
      meal: meal.toLowerCase(),
      food_name: result.name,
      brand: result.brand,
      quantity_g: qty,
      calories_per_100g: result.calories_100g,
      protein_per_100g: result.protein_100g,
      carbs_per_100g: result.carbs_100g,
      fat_per_100g: result.fat_100g,
      fiber_per_100g: result.fiber_100g,
    })
    setAddMeal(null)
    await load()
  }

  const handleAddSuggestion = async (food: FoodSuggestion, meal: string) => {
    await api.nutrition.addFood({
      meal: meal.toLowerCase(),
      food_name: food.name,
      brand: null,
      quantity_g: food.serving_g,
      calories_per_100g: food.per_100g.calories,
      protein_per_100g: food.per_100g.protein_g,
      carbs_per_100g: food.per_100g.carbs_g,
      fat_per_100g: food.per_100g.fat_g,
      fiber_per_100g: food.per_100g.fiber_g,
    })
    setShowSuggest(false)
    await load()
  }

  const handleSaveGoals = async (g: NutritionGoals) => {
    await api.nutrition.updateGoals(g)
    setGoals(g)
    setShowGoals(false)
    await load()
  }

  const handleOpenSuggest = async () => {
    if (!suggest) {
      setLoadingSuggest(true)
      try {
        const s = await api.nutrition.suggest(today)
        setSuggest(s)
      } finally {
        setLoadingSuggest(false)
      }
    }
    setShowSuggest(true)
  }

  const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } }

  return (
    <div className="min-h-screen px-4 pt-[env(safe-area-inset-top)] pb-28">
      {/* Header */}
      <div className="flex items-center justify-between py-5">
        <div>
          <p className="text-sm text-white/40">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-2xl font-bold mt-0.5 flex items-center gap-2">
            <Utensils size={20} className="text-amber-400" />
            Nutrition
          </h1>
        </div>
        <button
          onClick={() => setShowGoals(true)}
          className="w-10 h-10 flex items-center justify-center rounded-full glass active:scale-95 transition-transform"
        >
          <Settings size={16} className="text-white/60" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="text-white/20 animate-spin" />
        </div>
      ) : diary && goals ? (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
          {/* Calorie hero */}
          <motion.div variants={item}>
            <CalorieHero balance={diary.calorie_balance} goals={goals} />
          </motion.div>

          {/* Macro rings */}
          <motion.div variants={item}>
            <MacroRow totals={diary.totals} goals={goals} />
          </motion.div>

          {/* Suggest CTA */}
          <motion.div variants={item}>
            <button
              onClick={handleOpenSuggest}
              disabled={loadingSuggest}
              className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-colors active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 100%)',
                borderColor: 'rgba(99,102,241,0.25)',
              }}
            >
              <div className="flex items-center gap-3">
                {loadingSuggest
                  ? <Loader2 size={18} className="text-indigo-400 animate-spin" />
                  : <Sparkles size={18} className="text-indigo-400" />}
                <div className="text-left">
                  <p className="text-sm font-bold text-white">Suggest foods for my goals</p>
                  <p className="text-xs text-white/35 mt-0.5">Personalised picks based on remaining macros</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-white/20" />
            </button>
          </motion.div>

          {/* Meal sections */}
          {MEALS.map(meal => {
            const key = meal.toLowerCase()
            const entries = diary.meals[key] ?? []
            return (
              <motion.div key={meal} variants={item}>
                <MealSection
                  meal={meal}
                  entries={entries}
                  onAdd={() => setAddMeal(meal)}
                  onDelete={handleDeleteFood}
                />
              </motion.div>
            )
          })}
        </motion.div>
      ) : (
        <div className="text-center py-24">
          <Utensils size={40} className="mx-auto text-white/10 mb-4" />
          <p className="text-white/30">Could not load nutrition data</p>
        </div>
      )}

      {/* Sheets */}
      <AnimatePresence>
        {showGoals && goals && (
          <GoalsSheet
            key="goals"
            goals={goals}
            tdee={diary?.calorie_balance.burned ?? 0}
            onSave={handleSaveGoals}
            onClose={() => setShowGoals(false)}
          />
        )}
        {addMeal && (
          <AddFoodSheet
            key={`add-${addMeal}`}
            meal={addMeal}
            onAdd={(result, qty) => handleAddFood(addMeal, result, qty)}
            onClose={() => setAddMeal(null)}
          />
        )}
        {showSuggest && suggest && (
          <SuggestSheet
            key="suggest"
            suggest={suggest}
            onAdd={handleAddSuggestion}
            onClose={() => setShowSuggest(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
