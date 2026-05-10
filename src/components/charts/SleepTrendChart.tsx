'use client'

import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '@/lib/api'
import { TrendDataPoint } from '@/lib/types'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs">
      <p className="text-white/40 mb-1">{label}</p>
      <p className="font-semibold">{Math.round(payload[0].value)}</p>
    </div>
  )
}

export function SleepTrendChart() {
  const [data, setData] = useState<TrendDataPoint[]>([])

  useEffect(() => {
    api.getTrends(30).then(setData).catch(() => {})
  }, [])

  const formatted = data
    .filter(d => d.sleep != null)
    .map(d => ({
      date: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: d.sleep as number,
    }))

  if (!formatted.length) return <div className="h-32" />

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={formatted} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis hide domain={[0, 100]} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#sleepGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#6366f1' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
