import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { fetchDispatch, peekDispatch } from '../api'
import { AGGREGATE_PERIODS, aggregateWindow } from './useAggregates'
import { nzLocalMs, nzNowMs, todayNZ } from '../utils/time'
import type { Period } from '../utils/time'
import { pollWhileVisible } from '../utils/poll'

// Cheap: only reaches the network once the cached dispatch/recent expires (see api.ts)
const POLL_MS = 15 * 1000
export const MAX_RANGE_DAYS = 31

export type DateMode =
  | { kind: 'recent' }
  | { kind: 'today' }
  | { kind: 'date'; date: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'last30' }
  | { kind: 'lastYear' }
  | { kind: 'all' }

// Today and 3d are the only views kept up to date. Past days and aggregates are
// left alone until one of them is picked again.
export function isLiveMode(mode: DateMode): mode is Extract<DateMode, { kind: 'recent' | 'today' }> {
  return mode.kind === 'recent' || mode.kind === 'today'
}

// The 30d, 1y and All views chart aggregates (useAggregates) in the node panels
// and GridOverviewPanel; the map keeps showing live data underneath them, as it
// was when the view was picked.
export function isAggregateMode(mode: DateMode): mode is Extract<DateMode, { kind: 'last30' | 'lastYear' | 'all' }> {
  return mode.kind === 'last30' || mode.kind === 'lastYear' || mode.kind === 'all'
}

// How much the 3d view's rolling window holds
const RECENT_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

// The span of time a view's data covers, to show the units in service then. The
// 30d, 1y and All views cover their charts' days through to now, as the map shows
// live data under them, so it has every generator they chart, retired ones too.
// Their charts show every unit's history regardless (see GeneratorAdapter.getCodes).
export function periodOf(mode: DateMode): Period {
  const now = nzNowMs()
  const dayStart = (date: string) => nzLocalMs(`${date}T00:00:00`)
  switch (mode.kind) {
    case 'recent': return { from: now - RECENT_DAYS * DAY_MS, to: now }
    case 'today': return { from: dayStart(todayNZ()), to: now }
    case 'date': return { from: dayStart(mode.date), to: dayStart(mode.date) + DAY_MS - 1 }
    case 'range': return { from: dayStart(mode.from), to: dayStart(mode.to) + DAY_MS - 1 }
    default: return { from: dayStart(aggregateWindow(AGGREGATE_PERIODS[mode.kind]!).from), to: now }
  }
}

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

// Inclusive day count between two ISO dates. Unlike datesBetween this isn't
// capped at MAX_RANGE_DAYS, so it can tell when a range is too long.
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')
  return Math.round(ms / 86400000) + 1
}

export function mergeData(days: RecentData[]): RecentData {
  if (days.length === 1) return days[0]

  const seriesUnion: string[] = []
  const seen = new Set<string>()
  for (const day of days) {
    for (const s of day.series) {
      if (!seen.has(s)) { seen.add(s); seriesUnion.push(s) }
    }
  }

  const allData: (string | number)[][] = []
  const allPricing: (string | number | null)[][] = []

  for (const day of days) {
    const idxMap = seriesUnion.map(s => day.series.indexOf(s))
    // A series missing from a day generated 0 MW, but its price is unknown
    const remap = <T>(row: T[], missing: T): T[] => {
      const out: T[] = [row[0]]
      for (const idx of idxMap) out.push(idx >= 0 ? row[idx + 1] : missing)
      return out
    }
    allData.push(...day.data.map(row => remap(row, 0)))
    allPricing.push(...(day.pricing ?? []).map(row => remap(row, null)))
  }

  const byTs = (a: (string | number | null)[], b: (string | number | null)[]) =>
    String(a[0]) < String(b[0]) ? -1 : 1

  return { series: seriesUnion, data: allData.sort(byTs), pricing: allPricing.sort(byTs) }
}

export function useDispatchData(mode: DateMode): {
  recentData: RecentData | null
  loading: boolean
  error: string | null
} {
  const [recentData, setRecentData] = useState<RecentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let shown: RecentData[] | null = null
    const live = isLiveMode(mode)
    const keys = live || isAggregateMode(mode) ? ['recent'] : mode.kind === 'date' ? [mode.date] : datesBetween(mode.from, mode.to)

    function show(days: RecentData[]) {
      const prev = shown
      // Most polls hand back the same cached days, which would re-chart for nothing
      if (prev && days.every((d, i) => d === prev[i])) return
      shown = days
      let merged = mergeData(days)
      if (mode.kind === 'today') {
        const today = todayNZ()
        merged = {
          ...merged,
          data: merged.data.filter(row => (row[0] as string).slice(0, 10) === today),
          pricing: (merged.pricing ?? []).filter(row => (row[0] as string).slice(0, 10) === today),
        }
      }
      setRecentData(merged)
      setLoading(false)
      setError(null)
    }

    async function load() {
      const cached = keys.map(k => peekDispatch(k))
      if (cached.every(d => d !== undefined)) show(cached as RecentData[])
      else { setLoading(true); setError(null) }
      try {
        const days = await Promise.all(keys.map(k => fetchDispatch(k)))
        if (!cancelled) show(days)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    load()
    const stopPolling = live ? pollWhileVisible(load, POLL_MS) : undefined

    return () => {
      cancelled = true
      stopPolling?.()
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return { recentData, loading, error }
}
