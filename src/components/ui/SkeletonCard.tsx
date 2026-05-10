import { cn } from '@/lib/utils'

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-4 animate-pulse', className)}>
      <div className="h-4 bg-white/10 rounded-lg w-1/3 mb-3" />
      <div className="h-8 bg-white/10 rounded-lg w-2/3 mb-2" />
      <div className="h-3 bg-white/10 rounded-lg w-full" />
    </div>
  )
}

export function SkeletonRing({ size = 140 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center gap-3 animate-pulse">
      <div
        className="rounded-full bg-white/10"
        style={{ width: size, height: size }}
      />
      <div className="h-3 bg-white/10 rounded w-16" />
    </div>
  )
}
