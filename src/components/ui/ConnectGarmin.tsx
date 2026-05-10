'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Wifi, Lock, AlertCircle, CheckCircle, Loader2, Server } from 'lucide-react'
import { api } from '@/lib/api'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

interface Props {
  onConnected: () => void
}

export function ConnectGarmin({ onConnected }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setStatus('loading')
    setErrorMsg('')
    try {
      await api.connectGarmin(email, password)
      setStatus('success')
      setTimeout(onConnected, 1200)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.toLowerCase().includes('load') || msg.toLowerCase().includes('fetch') || msg === 'Failed to fetch' || msg === '') {
        setErrorMsg('Could not reach the Health Centre backend. Make sure it is running on your machine (uvicorn main:app --port 8000) and that NEXT_PUBLIC_BACKEND_URL points to it.')
      } else if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('unauthori') || msg.toLowerCase().includes('login')) {
        setErrorMsg('Incorrect email or password. Double-check your Garmin Connect credentials.')
      } else {
        setErrorMsg(msg || 'Connection failed. Check your credentials and try again.')
      }
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#0a0a0a]"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>

      {/* Logo / icon */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center mb-10"
      >
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center mb-5 shadow-2xl shadow-green-500/30">
          <span className="text-3xl font-black text-white tracking-tight">HC</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Health Centre</h1>
        <p className="text-sm text-white/40 mt-1.5 text-center">
          Connect your Garmin account to get started
        </p>
      </motion.div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-sm"
      >
        <div className="glass-card p-6">
          <AnimatePresence mode="wait">
            {status === 'success' ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6 gap-3"
              >
                <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle size={28} className="text-green-400" />
                </div>
                <p className="font-semibold text-green-400">Connected!</p>
                <p className="text-sm text-white/40 text-center">Syncing your data now…</p>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                className="space-y-4"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Wifi size={14} className="text-white/30" />
                  <p className="text-xs text-white/30 uppercase tracking-widest">Garmin Connect</p>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/50 font-medium">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    className="w-full h-12 rounded-xl bg-white/5 border border-white/10 px-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-green-500/50 focus:bg-white/8 transition-all"
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs text-white/50 font-medium">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                      className="w-full h-12 rounded-xl bg-white/5 border border-white/10 px-4 pr-12 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-green-500/50 focus:bg-white/8 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Error */}
                <AnimatePresence>
                  {status === 'error' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
                    >
                      <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300 leading-relaxed">{errorMsg}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={status === 'loading' || !email || !password}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white font-semibold text-sm
                    shadow-lg shadow-green-500/25 active:scale-[0.98] transition-all duration-150
                    disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {status === 'loading' ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    'Connect Garmin'
                  )}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* Backend URL indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center gap-2 mt-4 px-1"
        >
          <Server size={11} className="text-white/20 shrink-0" />
          <p className="text-xs text-white/20 font-mono truncate">Backend: {BACKEND_URL}</p>
        </motion.div>

        {/* Privacy note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-start gap-2 mt-3 px-1"
        >
          <Lock size={12} className="text-white/20 mt-0.5 shrink-0" />
          <p className="text-xs text-white/20 leading-relaxed">
            Your credentials are stored locally on your own backend server and are only used to fetch data from Garmin Connect. They are never sent to any third party.
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}
