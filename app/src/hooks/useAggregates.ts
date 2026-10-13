import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { mergeData } from './useDispatchData'
import type { DateMode } from './useDispatchData'

const BASE = 'https://api.electricitymap.frenchsta.gg/v1/dispatch/aggregates'
const CACHE_MS = 60 * 60 * 1000 // matches the API's max-age
export const DAILY_RANGE_DAYS = 30
export const WEEKLY_RANGE_WEEKS = 52
// Dispatch data starts on 11 September 2020, so the first complete month is October
const FIRST_COMPLETE_MONTH = '2020-10-01'
const DAY_MS = 86400000

export type AggregatePeriod = 'daily' | 'weekly' | 'monthly'

// The 30d, 1y and All views swap the 5-minute dispatch data for these MWh totals.
export const AGGREGATE_PERIODS: Partial<Record<DateMode['kind'], AggregatePeriod>> = {
  last30: 'daily',
  lastYear: 'weekly',
  all: 'monthly',
}

interface AggregateResponse {
  series: string[]
  data: (string | number)[][]
}

const cache = new Map<string, { at: number; promise: Promise<AggregateResponse> }>()

// `path` is a month of daily totals ("2026/09") or a year of weekly or monthly
// totals ("2026/weekly", "2026/monthly"). `nodes` are prefix-matched by the
// API, so a substation siteId returns every bus and generator at that site.
// Empty `nodes` returns every node.
function fetchAggregates(path: string, nodes: string): Promise<AggregateResponse> {
  const key = nodes ? `${path}?nodes=${encodeURIComponent(nodes)}` : path
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise
  const promise = fetch(`${BASE}/${key}`).then(r => {
    // A month or year with nothing aggregated yet (e.g. on the 1st) 404s
    if (r.status === 404) return { series: [], data: [] }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<AggregateResponse>
  })
  promise.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), promise })
  return promise
}

function todayNZ(): number {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  return new Date(date + 'T00:00:00Z').getTime()
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The most recent complete NZ day, as "YYYY-MM-DD". The date pickers cap at
// this; using UTC yesterday instead would hide NZ yesterday until 1pm NZST.
export function yesterdayNZ(): string {
  return isoDate(todayNZ() - DAY_MS)
}

// The last `days` complete NZ days, ending yesterday.
function completeDayWindow(days: number): { from: string; to: string } {
  return { from: isoDate(todayNZ() - days * DAY_MS), to: yesterdayNZ() }
}

// The last `weeks` complete Monday-to-Sunday NZ weeks, ending last Sunday.
// Weekly rows are keyed by the Monday each week starts on, so `from` and `to`
// are both Mondays.
function completeWeekWindow(weeks: number): { from: string; to: string } {
  const today = todayNZ()
  const thisMonday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS
  return { from: isoDate(thisMonday - weeks * 7 * DAY_MS), to: isoDate(thisMonday - 7 * DAY_MS) }
}

// Every complete NZ month of data, ending last month. Monthly rows
// are keyed by the 1st of each month.
function completeMonthWindow(): { from: string; to: string } {
  const lastMonth = new Date(todayNZ())
  lastMonth.setUTCDate(1)
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1)
  return { from: FIRST_COMPLETE_MONTH, to: isoDate(lastMonth.getTime()) }
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

// The weekly API groups weeks by ISO week-numbering year, where a week belongs
// to the year its Thursday falls in (so 2026 starts on Monday 2025-12-29).
function weeklyYearsBetween(fromMonday: string, toMonday: string): string[] {
  const isoYear = (monday: string) => new Date(new Date(monday + 'T00:00:00Z').getTime() + 3 * DAY_MS).getUTCFullYear()
  const years: string[] = []
  for (let y = isoYear(fromMonday); y <= isoYear(toMonday); y++) years.push(`${y}/weekly`)
  return years
}

function monthlyYearsBetween(from: string, to: string): string[] {
  const years: string[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(`${y}/monthly`)
  return years
}

function aggregateWindow(period: AggregatePeriod): { from: string; to: string; paths: string[] } {
  if (period === 'daily') {
    const { from, to } = completeDayWindow(DAILY_RANGE_DAYS)
    return { from, to, paths: monthsBetween(from, to) }
  }
  if (period === 'weekly') {
    const { from, to } = completeWeekWindow(WEEKLY_RANGE_WEEKS)
    return { from, to, paths: weeklyYearsBetween(from, to) }
  }
  const { from, to } = completeMonthWindow()
  return { from, to, paths: monthlyYearsBetween(from, to) }
}

/**
 * Adds each moved unit's totals at its old node into its current node's series
 * (see GeneratorAdapter.movedNodes), so its history reads as one unit. Energy totals
 * can be summed; dispatch pricing can't, so this is only for aggregates.
 */
export function foldMovedNodes(data: RecentData, movedNodes: Record<string, string>): RecentData {
  if (!data.series.some(s => s in movedNodes)) return data
  const series: string[] = []
  const columnOf = data.series.map(s => {
    const target = movedNodes[s] ?? s
    if (!series.includes(target)) series.push(target)
    return series.indexOf(target) + 1 // +1: col 0 is the timestamp
  })
  return {
    series,
    data: data.data.map(([time, ...values]) => {
      const row: (string | number)[] = [time, ...series.map(() => 0)]
      values.forEach((v, i) => { row[columnOf[i]] = (row[columnOf[i]] as number) + (v as number) })
      return row
    }),
    pricing: [],
  }
}

/**
 * Energy totals (MWh) for the given nodes: daily over the last 30 complete
 * days, weekly over the last 52 complete weeks, or monthly over every complete
 * month since data begins. Rows are shaped like dispatch data, timestamped at
 * local midnight at the start of each day/week/month, so they can go through
 * the same chart helpers. Pass 'all' for every node, or null to skip fetching.
 */
export function useAggregates(nodes: string[] | 'all' | null, period: AggregatePeriod | null): {
  aggregateData: RecentData | null
  loading: boolean
  error: string | null
} {
  // Tagged with its period so a switch between e.g. 30d and 1y doesn't briefly
  // chart one period's rows formatted as the other while the new ones load.
  const [result, setResult] = useState<{ period: AggregatePeriod; data: RecentData } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nodesKey = nodes === 'all' ? '' : nodes && nodes.length > 0 ? nodes.join(',') : null

  useEffect(() => {
    if (nodesKey === null || !period) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to, paths } = aggregateWindow(period)
    Promise.all(paths.map(p => fetchAggregates(p, nodesKey)))
      .then(responses => {
        if (cancelled) return
        const merged = mergeData(responses.map(r => ({ ...r, pricing: [] })))
        setResult({
          period,
          data: {
            series: merged.series,
            data: merged.data
              .filter(row => (row[0] as string) >= from && (row[0] as string) <= to)
              .map(([date, ...values]) => [`${date}T00:00:00`, ...values]),
            pricing: [],
          },
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [nodesKey, period])

  return { aggregateData: result?.period === period ? result.data : null, loading, error }
}
