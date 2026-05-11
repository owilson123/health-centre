'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Moon, Activity, Flame, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/sleep', label: 'Sleep', icon: Moon },
  { href: '/activities', label: 'Activities', icon: Activity },
  { href: '/calories', label: 'Calories', icon: Flame },
  { href: '/training', label: 'Training', icon: Dumbbell },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch h-16">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 gap-1 min-h-[44px] transition-all duration-200',
                active ? 'text-white' : 'text-white/40'
              )}
            >
              <div className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200',
                active && 'bg-gradient-to-br from-[#22c55e] to-[#16a34a] shadow-lg shadow-green-500/25'
              )}>
                <Icon size={active ? 16 : 18} strokeWidth={active ? 2.5 : 1.5} />
              </div>
              <span className={cn(
                'text-[10px] font-medium tracking-wide',
                active ? 'text-white' : 'text-white/40'
              )}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
