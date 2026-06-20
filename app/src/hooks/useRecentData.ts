import { useEffect, useState } from 'react'
import type { RecentData } from '../types'

const API_URL = 'https://api.electricitymap.frenchsta.gg/v1/dispatch/recent'

let cachedData: RecentData | null = null
let fetchPromise: Promise<RecentData> | null = null

export function useRecentData() {
  const [recentData, setRecentData] = useState<RecentData | null>(cachedData)
  const [loading, setLoading] = useState(cachedData === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedData) return

    if (!fetchPromise) {
      fetchPromise = fetch(API_URL).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<RecentData>
      })
    }

    fetchPromise
      .then((data) => {
        cachedData = data
        setRecentData(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
  }, [])

  return { recentData, loading, error }
}
