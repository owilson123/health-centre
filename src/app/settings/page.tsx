'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Wifi, WifiOff, LogOut, Trash2, ChevronRight, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { getUser, clearSession } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const router = useRouter()
  const user = getUser()

  const [garmin, setGarmin] = useState<{ connected: boolean; email?: string; connected_at?: string } | null>(null)
  const [garminLoading, setGarminLoading] = useState(true)

  // Disconnect Garmin
  const [disconnecting, setDisconnecting] = useState(false)

  // Wipe data
  const [wipeStep, setWipeStep] = useState<'idle' | 'confirm' | 'wiping' | 'done'>('idle')

  useEffect(() => {
    api.getAuthStatus()
      .then(setGarmin)
      .catch(() => setGarmin({ connected: false }))
      .finally(() => setGarminLoading(false))
  }, [])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.disconnectGarmin()
      setGarmin({ connected: false })
    } finally {
      setDisconnecting(false)
    }
  }

  const handleWipe = async () => {
    if (wipeStep === 'idle') { setWipeStep('confirm'); return }
    if (wipeStep === 'confirm') {
      setWipeStep('wiping')
      try {
        await api.wipeMyData()
        setWipeStep('done')
        setGarmin({ connected: false })
      } catch {
        setWipeStep('idle')
      }
    }
  }

  const handleLogout = () => {
    clearSession()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-28"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* Header */}
      <div className="px-4 pt-10 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-white/40 mt-0.5">Account &amp; data</p>
      </div>

      {/* Account card */}
      <div className="mx-4 mb-4 bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-4">
          <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
            <User size={20} className="text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white">{user?.display ?? user?.userId ?? '—'}</p>
            <p className="text-xs text-white/40 mt-0.5">Signed in</p>
          </div>
        </div>
      </div>

      {/* Garmin Connect */}
      <div className="mx-4 mb-4 bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Garmin Connect</p>
        </div>

        {garminLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-white/20" />
          </div>
        ) : garmin?.connected ? (
          <div className="px-4 py-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <Wifi size={16} className="text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">Connected</p>
                <p className="text-xs text-white/40 truncate mt-0.5">{garmin.email}</p>
              </div>
              <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full py-2.5 rounded-xl border border-white/10 text-sm text-white/50 active:bg-white/5 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <WifiOff size={14} />}
              {disconnecting ? 'Disconnecting…' : 'Disconnect Garmin'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => router.push('/')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-white/5"
          >
            <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
              <WifiOff size={16} className="text-white/30" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-white">Not connected</p>
              <p className="text-xs text-white/40 mt-0.5">Tap to connect your Garmin account</p>
            </div>
            <ChevronRight size={16} className="text-white/20" />
          </button>
        )}
      </div>

      {/* Danger zone */}
      <div className="mx-4 mb-4 bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Data</p>
        </div>

        <div className="px-4 py-4">
          <AnimatePresence mode="wait">
            {wipeStep === 'done' ? (
              <motion.div
                key="done"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 py-1"
              >
                <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">All data wiped</p>
                  <p className="text-xs text-white/40 mt-0.5">Your account is now clean. Connect Garmin to start fresh.</p>
                </div>
              </motion.div>
            ) : (
              <motion.div key="wipe" className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Trash2 size={16} className="text-red-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Wipe all my data</p>
                    <p className="text-xs text-white/40 mt-0.5 leading-relaxed">
                      Permanently deletes all synced health data, Garmin credentials, and training history for your account.
                    </p>
                  </div>
                </div>

                <AnimatePresence>
                  {wipeStep === 'confirm' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
                    >
                      <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300 leading-relaxed">
                        This cannot be undone. All your health data will be permanently deleted.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  onClick={handleWipe}
                  disabled={wipeStep === 'wiping'}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    wipeStep === 'confirm'
                      ? 'bg-red-500 text-white active:bg-red-600'
                      : 'border border-red-500/25 text-red-400 active:bg-red-500/10'
                  } disabled:opacity-50`}
                >
                  {wipeStep === 'wiping' ? (
                    <><Loader2 size={14} className="animate-spin" /> Wiping…</>
                  ) : wipeStep === 'confirm' ? (
                    'Confirm — delete everything'
                  ) : (
                    'Wipe all my data'
                  )}
                </button>
                {wipeStep === 'confirm' && (
                  <button
                    onClick={() => setWipeStep('idle')}
                    className="w-full py-2 text-xs text-white/30 active:text-white/60"
                  >
                    Cancel
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Log out */}
      <div className="mx-4">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-white/5 rounded-2xl border border-white/8 text-sm text-white/60 active:bg-white/8"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </div>
  )
}
