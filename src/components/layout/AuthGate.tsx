'use client'

import { useEffect, useState } from 'react'
import { ConnectGarmin } from '@/components/ui/ConnectGarmin'
import { api } from '@/lib/api'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'connected' | 'disconnected'>('loading')

  const check = async () => {
    try {
      const status = await api.getAuthStatus()
      setState(status.connected ? 'connected' : 'disconnected')
    } catch {
      // Backend not reachable — show connect screen
      setState('disconnected')
    }
  }

  useEffect(() => { check() }, [])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-green-500 animate-spin" />
      </div>
    )
  }

  if (state === 'disconnected') {
    return <ConnectGarmin onConnected={() => setState('connected')} />
  }

  return <>{children}</>
}
