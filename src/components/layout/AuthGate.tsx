'use client'

import { useEffect, useState } from 'react'
import { LoginScreen } from '@/components/ui/LoginScreen'
import { ConnectGarmin } from '@/components/ui/ConnectGarmin'
import { api } from '@/lib/api'
import { getToken, clearSession } from '@/lib/auth'

type State = 'loading' | 'needs-login' | 'needs-garmin' | 'ready'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('loading')

  const check = async () => {
    // 1. Do we have an app token?
    const token = getToken()
    if (!token) { setState('needs-login'); return }

    // 2. Is the token still valid?
    try {
      await api.me()
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'UNAUTHORIZED') {
        clearSession()
        setState('needs-login')
        return
      }
      // Backend unreachable — still let them through to the connect screen
    }

    // 3. Is Garmin connected for this user?
    try {
      const status = await api.getAuthStatus()
      setState(status.connected ? 'ready' : 'needs-garmin')
    } catch {
      setState('needs-garmin')
    }
  }

  useEffect(() => { check() }, [])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-indigo-500 animate-spin" />
      </div>
    )
  }

  if (state === 'needs-login') {
    return <LoginScreen onLoggedIn={() => setState('loading')} />
  }

  if (state === 'needs-garmin') {
    return <ConnectGarmin onConnected={() => setState('ready')} />
  }

  return <>{children}</>
}
