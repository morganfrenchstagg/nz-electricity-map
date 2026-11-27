import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { isAggregateMode, mergeData } from './useDispatchData'
import type { AggregateMode, DateMode } from './useDispatchData'
import { fetchAggregates } from '../api'
import { nzLocalMs, todayNZ } from '../utils/time'

export const NINETY_DAY_RANGE_WEEKS = 13
export const WEEKLY_RANGE_WEEKS = 52
export const MONTHLY_RANGE_MONTHS = 60
// Metered generation goes back to 1 August 1997 but is less complete before
// 2009, so the date pickers and links stop there for now. All charts everything
// from AGGREGATES_FIRST_DAY.
export const FIRST_DAY = '2009-01-01'
// The aggregates API's first day. All's months start here; its quarters and
// years start with the first complete ones.
export const AGGREGATES_FIRST_DAY = '1997-08-01'
const FIRST_COMPLETE_QUARTER = '1997-10-01'
const FIRST_COMPLETE_YEAR = '1998-01-01'
const DAY_MS = 86400000

export type AggregatePeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

// The period each MWh total covers in 90d, 1y, 5y and All. Null for dispatch views.
export function aggregatePeriodOf(mode: DateMode): AggregatePeriod | null {
  return isAggregateMode(mode) ? mode.aggregation : null
}

// NZ midnight today, as "local time as UTC"
function todayMs(): number {
  return nzLocalMs(`${todayNZ()}T00:00:00`)
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The last complete NZ day, as "YYYY-MM-DD"; the date pickers cap here. UTC
// yesterday would hide NZ yesterday until 1pm NZST.
export function yesterdayNZ(): string {
  return isoDate(todayMs() - DAY_MS)
}

// Each window runs to the period containing today. The API totals today as it
// goes, so that last total is partial.

// The Monday this NZ week started on
function thisMonday(): number {
  const today = todayMs()
  return today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS
}

// The first Monday on or after a "YYYY-MM-DD" date
function firstMondayFrom(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`)
  return isoDate(ms + ((8 - new Date(ms).getUTCDay()) % 7) * DAY_MS)
}

// The last `weeks` Monday-to-Sunday NZ weeks, ending this week. Weekly rows are
// keyed by Monday, so `from` and `to` are both Mondays.
function weekWindow(weeks: number): { from: string; to: string } {
  const monday = thisMonday()
  return { from: isoDate(monday - (weeks - 1) * 7 * DAY_MS), to: isoDate(monday) }
}

// The 1st of the NZ month `ago` months before this one
function monthsAgo(ago: number): string {
  const d = new Date(todayMs())
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - ago)
  return isoDate(d.getTime())
}

// The last `months` NZ months, ending this month. Monthly rows are keyed by the 1st.
function monthWindow(months: number): { from: string; to: string } {
  return { from: monthsAgo(months - 1), to: monthsAgo(0) }
}

// The first day of the calendar quarter a "YYYY-MM-DD" date falls in
export function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7))
  return `${date.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, '0')}-01`
}

// Every NZ month of data, ending with this one
function allMonthsWindow(): { from: string; to: string } {
  return { from: AGGREGATES_FIRST_DAY, to: monthsAgo(0) }
}

// From the first complete quarter of data to this one. Quarterly rows are keyed
// by each quarter's first day (see sumQuarters).
function quarterWindow(): { from: string; to: string } {
  return { from: FIRST_COMPLETE_QUARTER, to: quarterStart(monthsAgo(0)) }
}

// From the first complete year of data to this one. Annual rows are keyed by 1 January.
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

// The weekly API groups weeks by ISO week-numbering year: a week belongs to the
// year of its Thursday (so 2026 starts on Monday 2025-12-29).
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

// How far back a view's earlier period is (see utils/compare): whole days for the
// 5-minute views and daily and weekly totals, otherwise whole months
export type Shift = { days: number } | { months: number }

// A "YYYY-MM-DD" date `shift` earlier, or later with `sign` 1
export function shiftDate(date: string, shift: Shift, sign: 1 | -1 = -1): string {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if ('days' in shift) return isoDate(ms + sign * shift.days * DAY_MS)
  const d = new Date(ms)
  d.setUTCMonth(d.getUTCMonth() + sign * shift.months)
  return isoDate(d.getTime())
}

// The dates an aggregate view's chart covers, before any shift
function viewWindow(mode: AggregateMode): { from: string; to: string } {
  if (mode.kind === 'last90' || mode.kind === 'lastYear') {
    const weeks = weekWindow(mode.kind === 'last90' ? NINETY_DAY_RANGE_WEEKS : WEEKLY_RANGE_WEEKS)
    // Daily totals cover the same weeks, by day, to today
    return mode.aggregation === 'daily' ? { from: weeks.from, to: todayNZ() } : weeks
  }
  if (mode.kind === '5y') {
    const months = monthWindow(MONTHLY_RANGE_MONTHS)
    // Weekly totals cover the same months, by the weeks starting in them
    return mode.aggregation === 'weekly' ? { from: firstMondayFrom(months.from), to: isoDate(thisMonday()) } : months
  }
  if (mode.aggregation === 'annual') return yearWindow()
  return mode.aggregation === 'monthly' ? allMonthsWindow() : quarterWindow()
}

// An aggregate view's dates, `shift` earlier for the period compared with, and the
// aggregate files holding them (see fetchAggregates)
export function aggregateWindow(mode: AggregateMode, shift?: Shift): { from: string; to: string; paths: string[] } {
  const window = viewWindow(mode)
  const { from, to } = shift ? { from: shiftDate(window.from, shift), to: shiftDate(window.to, shift) } : window
  switch (mode.aggregation) {
    case 'daily':
      return { from, to, paths: monthsBetween(from, to) }
    case 'weekly':
      return { from, to, paths: weeklyYearsBetween(from, to) }
    // Every year's totals are in the one file
    case 'annual':
      return { from, to, paths: ['annual'] }
    // Quarters are summed from monthly totals, as there's no quarterly API (see
    // sumQuarters). Years with no data yet 404, and come back empty (see fetchAggregates).
    default:
      return { from, to, paths: monthlyYearsBetween(from, to) }
  }
}

// Sums ordered monthly rows into quarters, keyed by first day. A quarter
// missing months sums the ones it has.
export function sumQuarters(rows: (string | number)[][]): (string | number)[][] {
  const quarters: (string | number)[][] = []
  for (const [date, ...values] of rows) {
    const start = quarterStart(date as string)
    const quarter = quarters[quarters.length - 1]
    if (quarter?.[0] === start)
      values.forEach((v, i) => {
        quarter[i + 1] = (quarter[i + 1] as number) + (v as number)
      })
    else quarters.push([start, ...values])
  }
  return quarters
}

/**
 * Adds each moved unit's totals at its old node into its current node (see
 * GeneratorAdapter.movedNodes), so its history reads as one unit. Aggregates
 * only: energy can be summed, dispatch pricing can't.
 */
export function foldMovedNodes(data: RecentData, movedNodes: Record<string, string>): RecentData {
  if (!data.series.some((s) => s in movedNodes)) return data
  const series: string[] = []
  const columnOf = data.series.map((s) => {
    const target = movedNodes[s] ?? s
    if (!series.includes(target)) series.push(target)
    return series.indexOf(target) + 1 // +1: col 0 is the timestamp
  })
  return {
    series,
    data: data.data.map(([time, ...values]) => {
      const row: (string | number)[] = [time, ...series.map(() => 0)]
      values.forEach((v, i) => {
        row[columnOf[i]] = (row[columnOf[i]] as number) + (v as number)
      })
      return row
    }),
    pricing: [],
  }
}

/**
 * Energy totals (MWh) for nodes over an aggregate view: daily or weekly over
 * 13 or 52 weeks, monthly or weekly over 60 months, or annual, quarterly or
 * monthly since data begins, each ending with the partial current period. Rows
 * are shaped like dispatch data, timestamped at local midnight at each period's
 * start, so they share the chart helpers. HVDC totals each way come as `hvdc`.
 * Pass 'all' for every node, or null to skip fetching.
 * `shift` fetches the window that much earlier, for the period compared with
 * (see utils/compare).
 */
export function useAggregates(
  nodes: string[] | 'all' | null,
  mode: AggregateMode | null,
  shift?: Shift,
): {
  aggregateData: RecentData | null
  loading: boolean
  error: string | null
} {
  // A new dateMode object for the same view doesn't refetch
  const modeKey = mode && JSON.stringify([mode, shift ?? null])
  // Tagged with its view so switching (e.g. 90d to 1y) doesn't briefly chart one
  // view's rows formatted as the other's
  const [result, setResult] = useState<{ modeKey: string; data: RecentData } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nodesKey = nodes === 'all' ? '' : nodes && nodes.length > 0 ? nodes.join(',') : null

  useEffect(() => {
    if (nodesKey === null || !mode || !modeKey) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to, paths } = aggregateWindow(mode, shift)
    // Rows within the window (summed into quarters if needed), timestamped at local midnight
    const windowRows = (rows: (string | number)[][]) =>
      (aggregatePeriodOf(mode) === 'quarterly' ? sumQuarters(rows) : rows)
        .filter((row) => (row[0] as string) >= from && (row[0] as string) <= to)
        .map(([date, ...values]) => [`${date}T00:00:00`, ...values])
    Promise.all(paths.map((p) => fetchAggregates(p, nodesKey)))
      .then((responses) => {
        if (cancelled) return
        const merged = mergeData(responses.map((r) => ({ ...r, pricing: [] })))
        setResult({
          modeKey,
          data: {
            series: merged.series,
            data: windowRows(merged.data),
            pricing: [],
            // HVDC totals are all numbers
            ...(merged.hvdc && {
              hvdc: { series: merged.hvdc.series, data: windowRows(merged.hvdc.data as (string | number)[][]) },
            }),
          },
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [nodesKey, modeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { aggregateData: result?.modeKey === modeKey ? result.data : null, loading, error }
}
