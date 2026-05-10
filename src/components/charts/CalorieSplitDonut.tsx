'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface Props {
  bmr: number
  active: number
}

export function CalorieSplitDonut({ bmr, active }: Props) {
  const data = [
    { name: 'BMR', value: Math.round(bmr), color: '#6366f1' },
    { name: 'Active', value: Math.round(active), color: '#f59e0b' },
  ]
  const total = bmr + active

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={100} height={100}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={30} outerRadius={46} dataKey="value" strokeWidth={0}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="glass rounded-lg px-2 py-1 text-xs">
                  <p>{d.name}: {d.value} kcal</p>
                </div>
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-sm text-white/60">{d.name}</span>
            <span className="text-sm font-semibold">{d.value} kcal</span>
            <span className="text-xs text-white/30">({Math.round((d.value / total) * 100)}%)</span>
          </div>
        ))}
        <p className="text-xs text-white/30 pt-1">Total: {Math.round(total)} kcal</p>
      </div>
    </div>
  )
}
