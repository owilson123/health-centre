import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function scoreColor(score: number): string {
  if (score >= 67) return '#22c55e'
  if (score >= 34) return '#f59e0b'
  return '#ef4444'
}

export function scoreGradient(score: number): [string, string] {
  if (score >= 67) return ['#22c55e', '#16a34a']
  if (score >= 34) return ['#f59e0b', '#d97706']
  return ['#ef4444', '#dc2626']
}

export function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 67) return 'Good'
  if (score >= 50) return 'Fair'
  if (score >= 34) return 'Low'
  return 'Poor'
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export function formatDistance(meters: number | null): string {
  if (!meters) return '—'
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

export function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function activityIcon(type: string): string {
  const map: Record<string, string> = {
    running: '🏃',
    cycling: '🚴',
    swimming: '🏊',
    strength_training: '🏋️',
    walking: '🚶',
    hiking: '🥾',
    yoga: '🧘',
    other: '⚡',
  }
  return map[type.toLowerCase()] ?? '⚡'
}
