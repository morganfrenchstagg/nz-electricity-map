import { useEffect, useState } from 'react'
import type { RecentData } from '../types'

const API_URL = 'https://api.electricitymap.frenchsta.gg/v1/dispatch/recent'
const REFRESH_MS = 5 * 60 * 1000

let cachedData: RecentData | null = null

function fetchRecentData(): Promise<RecentData> {
  return fetch(API_URL).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<RecentData>
  })
}

export function useRecentData() {
  const [recentData, setRecentData] = useState<RecentData | null>(cachedData)
  const [loading, setLoading] = useState(cachedData === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    function load() {
      fetchRecentData()
        .then((data) => {
          if (cancelled) return
          cachedData = data
          setRecentData(data)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        })
    }

    if (!cachedData) load()

    const interval = setInterval(() => {
      cachedData = null
      load()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { recentData, loading, error }
}
