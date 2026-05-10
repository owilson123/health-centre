import { cn } from '@/lib/utils'

interface Props {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function GlassCard({ children, className, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'glass-card p-4',
        onClick && 'cursor-pointer active:scale-[0.98] transition-transform duration-150',
        className
      )}
    >
      {children}
    </div>
  )
}
