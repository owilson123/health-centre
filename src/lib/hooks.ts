'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import { DashboardData, Activity, TrendDataPoint } from './types'

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (forceSync = false) => {
    try {
      if (forceSync) {
        setSyncing(true)
        await api.sync()
        setSyncing(false)
      }
      const d = await api.getDashboard()
      setData(d)
      setError(null)
    } catch {
      setError('Could not load health data. Is the backend running?')
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, syncing, error, refresh }
}

export function useActivities(days = 30) {
  const [data, setData] = useState<Activity[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getActivities(days)
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activities')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  return { data, loading, error, refresh: load }
}

export function useTrends() {
  const [data, setData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getTrends().then(setData).finally(() => setLoading(false))
  }, [])

  return { data, loading }
}
