'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import { DashboardData, Activity, TrendDataPoint } from './types'

const SYNC_INTERVAL_MS = 30 * 60 * 1000

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
    } catch (e) {
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

export function useActivities() {
  const [data, setData] = useState<Activity[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getActivities().then(setData).finally(() => setLoading(false))
  }, [])

  return { data, loading }
}

export function useTrends() {
  const [data, setData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getTrends().then(setData).finally(() => setLoading(false))
  }, [])

  return { data, loading }
}
