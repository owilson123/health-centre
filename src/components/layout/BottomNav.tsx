'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Moon, Activity, Flame, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/',           label: 'Overview',   icon: Home },
  { href: '/sleep',      label: 'Sleep',      icon: Moon },
  { href: '/activities', label: 'Activities', icon: Activity },
  { href: '/calories',   label: 'Calories',   icon: Flame },
  { href: '/training',   label: 'Training',   icon: Dumbbell },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <>
      {/*
        Flood-fill the iPhone home-indicator zone with the same
        background so there's no colour mismatch below the bar.
      */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#0e0e0e]"
        style={{ height: 'env(safe-area-inset-bottom)' }}
        aria-hidden
      />

      {/* The actual tab bar — sits above the flood-fill */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0e0e0e] border-t border-white/[0.07]"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-stretch h-[54px]">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={cn(
                  'relative flex flex-col items-center justify-center flex-1 gap-[3px]',
                  'transition-colors duration-150',
                  active ? 'text-white' : 'text-white/30'
                )}
              >
                {/* Active pill indicator */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-indigo-400" />
                )}
                <Icon
                  size={active ? 20 : 21}
                  strokeWidth={active ? 2.2 : 1.6}
                  className="transition-all duration-150"
                />
                <span className={cn(
                  'text-[10px] tracking-wide transition-all duration-150',
                  active ? 'font-semibold' : 'font-normal'
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
