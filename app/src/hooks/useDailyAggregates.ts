import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { mergeData } from './useDispatchData'

const BASE = 'https://api.electricitymap.frenchsta.gg/v1/dispatch/aggregates'
const CACHE_MS = 60 * 60 * 1000 // matches the API's max-age
export const DAILY_RANGE_DAYS = 30

interface AggregateResponse {
  series: string[]
  data: (string | number)[][]
}

const cache = new Map<string, { at: number; promise: Promise<AggregateResponse> }>()

// `nodes` are prefix-matched by the API, so a substation siteId returns every
// bus and generator at that site.
function fetchMonth(month: string, nodes: string): Promise<AggregateResponse> {
  const key = `${month}?${nodes}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise
  const promise = fetch(`${BASE}/${month}?nodes=${encodeURIComponent(nodes)}`).then(r => {
    // A month with nothing aggregated yet (e.g. on the 1st) 404s
    if (r.status === 404) return { series: [], data: [] }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<AggregateResponse>
  })
  promise.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), promise })
  return promise
}

// The last `days` complete NZ days, ending yesterday.
function completeDayWindow(days: number): { from: string; to: string } {
  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const today = new Date(todayNZ + 'T00:00:00Z').getTime()
  return {
    from: new Date(today - days * 86400000).toISOString().slice(0, 10),
    to: new Date(today - 86400000).toISOString().slice(0, 10),
  }
}

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  const cur = new Date(from.slice(0, 7) + '-01T00:00:00Z')
  while (cur.toISOString().slice(0, 7) <= to.slice(0, 7)) {
    months.push(cur.toISOString().slice(0, 7).replace('-', '/'))
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return months
}

/**
 * Daily energy totals (MWh) for the given nodes over the last 30 complete days.
 * Rows are shaped like dispatch data, timestamped at local midnight, so they
 * can go through the same chart helpers. Pass null to skip fetching.
 */
export function useDailyAggregates(nodes: string[] | null): {
  dailyData: RecentData | null
  loading: boolean
  error: string | null
} {
  const [dailyData, setDailyData] = useState<RecentData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nodesKey = nodes && nodes.length > 0 ? nodes.join(',') : null

  useEffect(() => {
    if (!nodesKey) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to } = completeDayWindow(DAILY_RANGE_DAYS)
    Promise.all(monthsBetween(from, to).map(m => fetchMonth(m, nodesKey)))
      .then(months => {
        if (cancelled) return
        const merged = mergeData(months.map(m => ({ ...m, pricing: [] })))
        setDailyData({
          series: merged.series,
          data: merged.data
            .filter(row => (row[0] as string) >= from && (row[0] as string) <= to)
            .map(([date, ...values]) => [`${date}T00:00:00`, ...values]),
          pricing: [],
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [nodesKey])

  return { dailyData, loading, error }
}
