'use client'

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts'

interface Props {
  data: Array<{ hour: number; calories: number }>
}

export function CalorieHourlyChart({ data }: Props) {
  const maxCal = Math.max(...data.map(d => d.calories), 1)
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="calBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={h => h % 6 === 0 ? `${h}:00` : ''}
        />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="glass rounded-lg px-2 py-1 text-xs">
                <p className="text-white/40">{d.hour}:00</p>
                <p className="font-semibold">{Math.round(d.calories)} kcal</p>
              </div>
            )
          }}
        />
        <Bar dataKey="calories" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.calories > maxCal * 0.7 ? 'url(#calBarGrad)' : 'rgba(245,158,11,0.4)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
