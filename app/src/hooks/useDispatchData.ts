import { useEffect, useRef, useState } from 'react'
import type { RecentData } from '../types'

const BASE = 'https://api.electricitymap.frenchsta.gg/v1/dispatch'
const POLL_MS = 60 * 1000
const STALE_MS = 5 * 60 * 1000
export const MAX_RANGE_DAYS = 31

export type DateMode =
  | { kind: 'recent' }
  | { kind: 'today' }
  | { kind: 'date'; date: string }
  | { kind: 'range'; from: string; to: string }

const dayCache = new Map<string, RecentData>()

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  let cur = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (cur <= end && dates.length < MAX_RANGE_DAYS) {
    dates.push(cur.toISOString().slice(0, 10))
    cur = new Date(cur.getTime() + 86400000)
  }
  return dates
}

function mergeData(days: RecentData[]): RecentData {
  if (days.length === 1) return days[0]

  const seriesUnion: string[] = []
  const seen = new Set<string>()
  for (const day of days) {
    for (const s of day.series) {
      if (!seen.has(s)) { seen.add(s); seriesUnion.push(s) }
    }
  }

  const allData: (string | number)[][] = []
  const allPricing: (string | number)[][] = []

  for (const day of days) {
    const idxMap = seriesUnion.map(s => day.series.indexOf(s))
    const remap = (row: (string | number)[]): (string | number)[] => {
      const out: (string | number)[] = [row[0]]
      for (const idx of idxMap) out.push(idx >= 0 ? row[idx + 1] : 0)
      return out
    }
    allData.push(...day.data.map(remap))
    allPricing.push(...(day.pricing ?? []).map(remap))
  }

  const byTs = (a: (string | number)[], b: (string | number)[]) =>
    String(a[0]) < String(b[0]) ? -1 : 1

  return { series: seriesUnion, data: allData.sort(byTs), pricing: allPricing.sort(byTs) }
}

async function fetchOne(key: string): Promise<RecentData> {
  const url = key === 'recent' ? `${BASE}/recent` : `${BASE}/${key}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<RecentData>
}

export function useDispatchData(mode: DateMode): {
  recentData: RecentData | null
  loading: boolean
  error: string | null
} {
  const [recentData, setRecentData] = useState<RecentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const keys =
          mode.kind === 'recent' || mode.kind === 'today' ? ['recent'] :
          mode.kind === 'date' ? [mode.date] :
          datesBetween(mode.from, mode.to)

        const missing = keys.filter(k => !dayCache.has(k))
        if (missing.length > 0) {
          const fetched = await Promise.all(missing.map(fetchOne))
          if (cancelled) return
          missing.forEach((k, i) => dayCache.set(k, fetched[i]))
        }

        const days = keys.map(k => dayCache.get(k)!)
        let merged = mergeData(days)
        if (mode.kind === 'today') {
          const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
          merged = {
            ...merged,
            data: merged.data.filter(row => (row[0] as string).slice(0, 10) === todayNZ),
            pricing: (merged.pricing ?? []).filter(row => (row[0] as string).slice(0, 10) === todayNZ),
          }
        }
        if (!cancelled) { setRecentData(merged); setLoading(false) }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    load()

    if (mode.kind === 'recent' || mode.kind === 'today') {
      timerRef.current = setInterval(() => {
        const cached = dayCache.get('recent')
        if (cached) {
          console.log('cached', cached)
          const last = cached.data[cached.data.length - 1]
          const ts = last ? new Date((last[0] as string)).getTime() : 0
          if (Date.now() - ts < STALE_MS) return
        }
        dayCache.delete('recent')
        load()
      }, POLL_MS)
    }

    return () => {
      cancelled = true
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return { recentData, loading, error }
}
