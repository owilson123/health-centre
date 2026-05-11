'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { saveSession } from '@/lib/auth'

const USERS = [
  { id: 'ow', label: 'OW' },
  { id: 'ob', label: 'OB' },
]

interface Props {
  onLoggedIn: () => void
}

export function LoginScreen({ onLoggedIn }: Props) {
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [password, setPassword]         = useState('')
  const [showPw, setShowPw]             = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  const handleLogin = async () => {
    if (!selectedUser || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await api.login(selectedUser, password)
      saveSession(res.token, res.user_id, res.display)
      onLoggedIn()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
      {/* Logo / wordmark */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-12 text-center"
      >
        <div className="flex items-center justify-center gap-3 mb-3">
          {/* Mini ring icon */}
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle cx="20" cy="20" r="10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <path d="M 20 4 A 16 16 0 1 1 7.3 32.7" fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
            <path d="M 20 10 A 10 10 0 0 1 29.5 25" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h1 className="text-2xl font-bold tracking-tight">Health Centre</h1>
        </div>
        <p className="text-sm text-white/30">Select your profile to continue</p>
      </motion.div>

      {/* User selector */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-full max-w-sm space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          {USERS.map(u => (
            <button
              key={u.id}
              onClick={() => { setSelectedUser(u.id); setError('') }}
              className={`
                relative p-5 rounded-2xl border transition-all duration-200 active:scale-95
                ${selectedUser === u.id
                  ? 'bg-white/10 border-white/30'
                  : 'bg-white/5 border-white/8 active:bg-white/10'}
              `}
            >
              {selectedUser === u.id && (
                <motion.div
                  layoutId="user-highlight"
                  className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-green-500/10 border border-indigo-500/30"
                />
              )}
              <div className="relative">
                <div className={`
                  w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold mx-auto mb-2
                  ${selectedUser === u.id ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/10 text-white/50'}
                `}>
                  {u.label}
                </div>
                <p className={`text-sm font-medium ${selectedUser === u.id ? 'text-white' : 'text-white/40'}`}>
                  {u.label}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Password input — slides in once a user is selected */}
        <AnimatePresence>
          {selectedUser && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-1">
                <div className="relative">
                  <Lock size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    placeholder="Password"
                    autoComplete="current-password"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 pl-10 pr-12
                               text-sm text-white placeholder-white/20 outline-none
                               focus:border-white/25 focus:bg-white/8 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 active:text-white/60"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-red-400 text-center px-2"
                  >
                    {error}
                  </motion.p>
                )}

                <button
                  onClick={handleLogin}
                  disabled={loading || !password}
                  className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95
                             bg-white text-black disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      Signing in…
                    </span>
                  ) : 'Sign in'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
