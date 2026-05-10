'use client'

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts'

const ZONE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed']

interface Props {
  zones: { zone1: number; zone2: number; zone3: number; zone4: number; zone5: number }
}

export function HRZoneChart({ zones }: Props) {
  const data = [
    { name: 'Z1', minutes: Math.round(zones.zone1 / 60) },
    { name: 'Z2', minutes: Math.round(zones.zone2 / 60) },
    { name: 'Z3', minutes: Math.round(zones.zone3 / 60) },
    { name: 'Z4', minutes: Math.round(zones.zone4 / 60) },
    { name: 'Z5', minutes: Math.round(zones.zone5 / 60) },
  ]

  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            return (
              <div className="glass rounded-lg px-2 py-1 text-xs">
                <span className="font-semibold">{payload[0].value}min</span>
              </div>
            )
          }}
        />
        <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={ZONE_COLORS[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
