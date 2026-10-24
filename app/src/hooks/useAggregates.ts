import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { mergeData } from './useDispatchData'
import type { AggregateMode, DateMode } from './useDispatchData'
import { fetchAggregates } from '../api'
import { nzLocalMs, todayNZ } from '../utils/time'

export const DAILY_RANGE_DAYS = 30
export const WEEKLY_RANGE_WEEKS = 52
export const MONTHLY_RANGE_MONTHS = 60
// Metered generation reaches back to 1 August 1997, but it's less complete
// before 2009, so for now nothing earlier is shown: not in the date pickers,
// links or aggregate views. 1 January 2009 also starts the first complete
// quarter and year.
export const FIRST_DAY = '2009-01-01'
const FIRST_COMPLETE_QUARTER = FIRST_DAY
const FIRST_COMPLETE_YEAR = FIRST_DAY
const DAY_MS = 86400000

export type AggregatePeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

// The 30d, 1y, 5y and All views swap the 5-minute dispatch data for MWh totals,
// each covering this period. Null for the views that chart dispatch data.
export function aggregatePeriodOf(mode: DateMode): AggregatePeriod | null {
  switch (mode.kind) {
    case 'last30': return 'daily'
    case 'lastYear': return 'weekly'
    case '5y': return 'monthly'
    case 'all': return mode.aggregation
    default: return null
  }
}

// The midnight starting today in NZ, in the "local time as UTC" convention
function todayMs(): number {
  return nzLocalMs(`${todayNZ()}T00:00:00`)
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The most recent complete NZ day, as "YYYY-MM-DD". The date pickers cap at
// this; using UTC yesterday instead would hide NZ yesterday until 1pm NZST.
export function yesterdayNZ(): string {
  return isoDate(todayMs() - DAY_MS)
}

// Each view's window runs to the day, week, month, quarter or year that today
// falls in. The aggregates API totals today as it goes, so that last total
// only covers it so far.

// The last `days` NZ days, ending today.
function dayWindow(days: number): { from: string; to: string } {
  return { from: isoDate(todayMs() - (days - 1) * DAY_MS), to: todayNZ() }
}

// The last `weeks` Monday-to-Sunday NZ weeks, ending this week. Weekly rows
// are keyed by the Monday each week starts on, so `from` and `to` are both
// Mondays.
function weekWindow(weeks: number): { from: string; to: string } {
  const today = todayMs()
  const thisMonday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS
  return { from: isoDate(thisMonday - (weeks - 1) * 7 * DAY_MS), to: isoDate(thisMonday) }
}

// The 1st of the NZ month `ago` months before this one
function monthsAgo(ago: number): string {
  const d = new Date(todayMs())
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - ago)
  return isoDate(d.getTime())
}

// The last `months` NZ months, ending this month. Monthly rows are keyed by
// the 1st of each month.
function monthWindow(months: number): { from: string; to: string } {
  return { from: monthsAgo(months - 1), to: monthsAgo(0) }
}

// The calendar quarter a "YYYY-MM-DD" date falls in, by its first day: 1
// January, April, July or October
function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7))
  return `${date.slice(0, 4)}-${String(month - (month - 1) % 3).padStart(2, '0')}-01`
}

// Every NZ calendar quarter of data, ending with this one. Quarterly rows are
// keyed by each quarter's first day (see sumQuarters).
function quarterWindow(): { from: string; to: string } {
  return { from: FIRST_COMPLETE_QUARTER, to: quarterStart(monthsAgo(0)) }
}

// Every NZ year of data, ending with this one. Annual rows are keyed by 1
// January of each year.
function yearWindow(): { from: string; to: string } {
  return { from: FIRST_COMPLETE_YEAR, to: `${todayNZ().slice(0, 4)}-01-01` }
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

// The dates an aggregate view's chart covers, and the aggregate files (see
// fetchAggregates) holding them.
export function aggregateWindow(mode: AggregateMode): { from: string; to: string; paths: string[] } {
  if (mode.kind === 'last30') {
    const { from, to } = dayWindow(DAILY_RANGE_DAYS)
    return { from, to, paths: monthsBetween(from, to) }
  }
  if (mode.kind === 'lastYear') {
    const { from, to } = weekWindow(WEEKLY_RANGE_WEEKS)
    return { from, to, paths: weeklyYearsBetween(from, to) }
  }
  if (mode.kind === '5y') {
    const { from, to } = monthWindow(MONTHLY_RANGE_MONTHS)
    return { from, to, paths: monthlyYearsBetween(from, to) }
  }
  if (mode.aggregation === 'annual') {
    // Every year's totals are in the one file
    return { ...yearWindow(), paths: ['annual'] }
  }
  // There's no quarterly API, so quarters are summed from each year's monthly
  // totals (see sumQuarters). Years with no data yet 404, and are fetched as
  // empty (see fetchAggregates).
  const { from, to } = quarterWindow()
  return { from, to, paths: monthlyYearsBetween(from, to) }
}

// Monthly rows, in order, summed into a row for each calendar quarter, keyed
// by the quarter's first day. A quarter missing months sums the ones it has.
export function sumQuarters(rows: (string | number)[][]): (string | number)[][] {
  const quarters: (string | number)[][] = []
  for (const [date, ...values] of rows) {
    const start = quarterStart(date as string)
    const quarter = quarters[quarters.length - 1]
    if (quarter?.[0] === start) values.forEach((v, i) => { quarter[i + 1] = (quarter[i + 1] as number) + (v as number) })
    else quarters.push([start, ...values])
  }
  return quarters
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
 * Energy totals (MWh) for the given nodes over an aggregate view: daily over
 * the last 30 days, weekly over the last 52 weeks, monthly over the last 60
 * months, or annually or quarterly over everything since data begins, each
 * ending with the one so far. Rows are shaped like dispatch data, timestamped at local
 * midnight at the start of each day/week/month/quarter/year, so they can go
 * through the same chart helpers. Pass 'all' for every node, or null to skip
 * fetching.
 */
export function useAggregates(nodes: string[] | 'all' | null, mode: AggregateMode | null): {
  aggregateData: RecentData | null
  loading: boolean
  error: string | null
} {
  // A new dateMode object for the same view (e.g. its button clicked again)
  // doesn't fetch it again
  const modeKey = mode && JSON.stringify(mode)
  // Tagged with its view so a switch between e.g. 30d and 1y doesn't briefly
  // chart one view's rows formatted as the other while the new ones load.
  const [result, setResult] = useState<{ modeKey: string; data: RecentData } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nodesKey = nodes === 'all' ? '' : nodes && nodes.length > 0 ? nodes.join(',') : null

  useEffect(() => {
    if (nodesKey === null || !mode || !modeKey) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to, paths } = aggregateWindow(mode)
    Promise.all(paths.map(p => fetchAggregates(p, nodesKey)))
      .then(responses => {
        if (cancelled) return
        const merged = mergeData(responses.map(r => ({ ...r, pricing: [] })))
        const rows = aggregatePeriodOf(mode) === 'quarterly' ? sumQuarters(merged.data) : merged.data
        setResult({
          modeKey,
          data: {
            series: merged.series,
            data: rows
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
  }, [nodesKey, modeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { aggregateData: result?.modeKey === modeKey ? result.data : null, loading, error }
}
