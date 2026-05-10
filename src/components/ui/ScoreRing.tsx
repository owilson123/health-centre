'use client'

import { useEffect, useState } from 'react'
import { scoreGradient } from '@/lib/utils'

interface Props {
  score: number
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
  animate?: boolean
}

export function ScoreRing({
  score,
  size = 140,
  strokeWidth = 10,
  label,
  sublabel,
  animate = true,
}: Props) {
  const [displayed, setDisplayed] = useState(animate ? 0 : score)
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.min(Math.max(displayed, 0), 100) / 100
  const dash = circ * pct
  const [start, end] = scoreGradient(score)
  const id = `ring-grad-${label?.replace(/\s/g, '') ?? Math.random().toString(36).slice(2)}`

  useEffect(() => {
    if (!animate) return
    let frame: number
    const duration = 1000
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(ease * score))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [score, animate])

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={start} />
            <stop offset="100%" stopColor={end} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: animate ? 'none' : 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight">{displayed}</span>
        {label && <span className="text-xs font-semibold text-white/50 uppercase tracking-widest mt-0.5">{label}</span>}
        {sublabel && <span className="text-[10px] text-white/30 mt-0.5 text-center px-2">{sublabel}</span>}
      </div>
    </div>
  )
}
