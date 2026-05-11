'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, User, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { saveSession } from '@/lib/auth'

interface Props {
  onLoggedIn: () => void
}

export function LoginScreen({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleLogin = async () => {
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await api.login(username.trim().toLowerCase(), password)
      saveSession(res.token, res.user_id, res.display)
      onLoggedIn()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6">

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <svg width="36" height="36" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle cx="20" cy="20" r="10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <path d="M 20 4 A 16 16 0 1 1 7.3 32.7" fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
            <path d="M 20 10 A 10 10 0 0 1 29.5 25" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h1 className="text-2xl font-bold tracking-tight">Health Centre</h1>
        </div>
        <p className="text-sm text-white/30">Sign in to continue</p>
      </motion.div>

      {/* Form */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-full max-w-sm space-y-3"
      >
        {/* Username */}
        <div className="relative">
          <User size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 pl-10
                       text-sm text-white placeholder-white/20 outline-none
                       focus:border-white/25 focus:bg-white/8 transition-colors"
          />
        </div>

        {/* Password */}
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

        {/* Error */}
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-red-400 text-center px-2 pt-1"
          >
            {error}
          </motion.p>
        )}

        {/* Submit */}
        <button
          onClick={handleLogin}
          disabled={loading || !username.trim() || !password}
          className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 mt-1
                     bg-white text-black disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              Signing in…
            </span>
          ) : 'Sign in'}
        </button>
      </motion.div>
    </div>
  )
}
