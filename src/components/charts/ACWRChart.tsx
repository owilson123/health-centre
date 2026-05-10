'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { TrendDataPoint } from '@/lib/types'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const v = payload[0].value as number
  const color = v > 1.5 ? '#ef4444' : v < 0.8 ? '#3b82f6' : '#22c55e'
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs">
      <p className="text-white/40 mb-1">{label}</p>
      <p className="font-semibold" style={{ color }}>{v.toFixed(2)}</p>
    </div>
  )
}

export function ACWRChart({ data }: { data: TrendDataPoint[] }) {
  const filtered = data.filter(d => d.acwr != null)
  const formatted = filtered.map(d => ({
    date: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    value: d.acwr as number,
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={formatted} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="acwrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis hide domain={[0, 2]} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Overreaching', fill: '#ef444460', fontSize: 9 }} />
        <ReferenceLine y={0.8} stroke="#3b82f6" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Detraining', fill: '#3b82f660', fontSize: 9 }} />
        <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="url(#acwrGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#22c55e' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
