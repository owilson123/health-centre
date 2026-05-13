'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Moon, Activity, CalendarDays, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/',           label: 'Overview',   icon: Home },
  { href: '/sleep',      label: 'Sleep',      icon: Moon },
  { href: '/activities', label: 'Activities', icon: Activity },
  { href: '/calendar',   label: 'Calendar',   icon: CalendarDays },
  { href: '/training',   label: 'Training',   icon: Dumbbell },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Flood-fill below home indicator */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0c0c]"
        style={{ height: 'env(safe-area-inset-bottom)' }}
        aria-hidden
      />

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#0c0c0c]/95 backdrop-blur-xl border-t border-white/[0.06]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch h-[64px] px-1">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={cn(
                  'relative flex flex-col items-center justify-center flex-1 gap-1 rounded-2xl mx-0.5 my-1.5 transition-all duration-200 active:scale-90',
                  active ? 'text-white' : 'text-white/35'
                )}
              >
                {/* Active background pill */}
                {active && (
                  <span className="absolute inset-0 rounded-2xl bg-white/[0.08]" />
                )}

                {/* Icon container */}
                <span className={cn(
                  'relative z-10 flex items-center justify-center rounded-xl transition-all duration-200',
                  active ? 'w-10 h-7 bg-indigo-500/20' : 'w-8 h-6'
                )}>
                  <Icon
                    size={active ? 19 : 20}
                    strokeWidth={active ? 2.3 : 1.6}
                    className={cn(
                      'transition-all duration-200',
                      active ? 'text-indigo-400' : 'text-white/35'
                    )}
                  />
                </span>

                {/* Label */}
                <span className={cn(
                  'relative z-10 text-[10px] tracking-wide transition-all duration-200 leading-none',
                  active ? 'font-bold text-white' : 'font-normal text-white/35'
                )}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
