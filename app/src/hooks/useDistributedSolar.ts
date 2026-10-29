import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSolarEnergy, fetchSolarProduction, peekSolarProduction } from '../api'
import type { SolarEnergy, SolarProduction } from '../api'
import { datesBetween, isAggregateMode, isLiveMode, periodOf } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { aggregateWindow, quarterStart } from './useAggregates'
import { pollWhileVisible } from '../utils/poll'
import { todayNZ } from '../utils/time'

// Cheap: only reaches the network once the cached estimate expires (see api.ts)
const POLL_MS = 15 * 1000

// How long a view's data waits for its estimate before it's charted without it
export const SOLAR_WAIT_MS = 2000

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The dates of the distributed solar estimate a view charts, oldest first:
// each day it covers. The aggregate views chart the API's energy totals (see
// useDistributedSolarEnergy), which stop at yesterday, so they take today's
// estimate for their period so far.
export function solarDatesOf(mode: DateMode): string[] {
  if (isAggregateMode(mode)) return [todayNZ()]
  const { from, to } = periodOf(mode)
  return datesBetween(isoDate(from), isoDate(to))
}

const NO_DAYS: SolarProduction[] = []

// Most polls hand back the same cached days, which would re-chart for nothing
function sameDays(a: SolarProduction[], b: SolarProduction[]): boolean {
  return a.length === b.length && a.every((day, i) => day === b[i])
}

// The distributed solar estimate for each day a view charts (see solarDatesOf)
// that the API has it for, and whether it's loaded for this view: until it
// has, the days are the last view's, or empty. Not fetched while `enabled` is
// false, when there's nothing to load.
export function useDistributedSolar(mode: DateMode, enabled: boolean): { days: SolarProduction[]; loaded: boolean } {
  // Tagged with its view, so a view can tell its own days from the last one's
  const key = enabled ? JSON.stringify(mode) : null
  const [fetched, setFetched] = useState<{ key: string; days: SolarProduction[] } | null>(null)

  // A view whose days are all cached has them straight away, rather than a
  // render later, once the effect below has fetched them again
  const cached = useMemo(() => {
    if (!key) return null
    const days = solarDatesOf(mode).map(peekSolarProduction)
    return days.every((day) => day !== undefined) ? days.filter((day): day is SolarProduction => day !== null) : null
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key) return
    let cancelled = false

    async function load() {
      // Worked out on each load, so the live views move on to the next day at midnight.
      // The estimate is an extra, so a day that fails is left out (and retried
      // on the live views' next poll) rather than holding up the rest
      const next = await Promise.all(solarDatesOf(mode).map((date) => fetchSolarProduction(date).catch(() => null)))
      if (cancelled || !key) return
      const days = next.filter((day): day is SolarProduction => day !== null)
      setFetched((prev) => (prev?.key === key && sameDays(prev.days, days) ? prev : { key, days }))
    }

    load()
    const stopPolling = isLiveMode(mode) ? pollWhileVisible(load, POLL_MS) : undefined

    return () => {
      cancelled = true
      stopPolling?.()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!key) return { days: NO_DAYS, loaded: true }
  if (fetched?.key === key) return { days: cached && sameDays(cached, fetched.days) ? cached : fetched.days, loaded: true }
  if (cached) return { days: cached, loaded: true }
  return { days: fetched?.days ?? NO_DAYS, loaded: false }
}

const NO_ENERGY: SolarEnergy[] = []

// The last day of the calendar quarter starting on a "YYYY-MM-DD" date
function quarterEnd(start: string): string {
  const end = new Date(`${start}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 3, 0)
  return isoDate(end.getTime())
}

// Monthly totals summed into a total for each calendar quarter, keyed by its
// first day and running to its last (even before its last months have any
// days), as the API has no quarterly totals (like sumQuarters). `files` are in
// order, and so are their months.
export function solarEnergyQuarters(files: SolarEnergy[]): SolarEnergy {
  const series = [...new Set(files.flatMap((file) => file.series))]
  const column = new Map(series.map((gxp, i) => [gxp, i]))
  const data: SolarEnergy['data'] = []
  for (const file of files) {
    for (const { from, days, totalMwh, mwh } of file.data) {
      let quarter = data[data.length - 1]
      if (quarter?.from !== quarterStart(from)) {
        quarter = { from: quarterStart(from), to: quarterEnd(quarterStart(from)), days: 0, totalMwh: 0, mwh: series.map(() => 0) }
        data.push(quarter)
      }
      quarter.days += days
      quarter.totalMwh += totalMwh
      file.series.forEach((gxp, i) => { quarter.mwh[column.get(gxp)!] += mwh[i] })
    }
  }
  return { series, data }
}

// The distributed solar estimate's energy totals for an aggregate view, from
// the files covering the same periods as its dispatch totals (see
// aggregateWindow), and whether they've loaded. Empty while they load, on the
// other views, and while `enabled` is false, when there's nothing to load.
export function useDistributedSolarEnergy(mode: DateMode, enabled: boolean): { files: SolarEnergy[]; loaded: boolean } {
  // Tagged with its view, as useAggregates' totals are, so a switch between
  // views doesn't chart one's totals against the other's periods
  const modeKey = isAggregateMode(mode) && enabled ? JSON.stringify(mode) : null
  const [result, setResult] = useState<{ modeKey: string; files: SolarEnergy[] } | null>(null)

  useEffect(() => {
    if (!modeKey || !isAggregateMode(mode)) return
    let cancelled = false
    // A file that fails is left out, as with the daily estimates
    Promise.all(aggregateWindow(mode).paths.map((path) => fetchSolarEnergy(path).catch(() => null))).then((fetched) => {
      if (cancelled) return
      const files = fetched.filter((file): file is SolarEnergy => file !== null)
      setResult({ modeKey, files: mode.aggregation === 'quarterly' ? [solarEnergyQuarters(files)] : files })
    })
    return () => { cancelled = true }
  }, [modeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!modeKey) return { files: NO_ENERGY, loaded: true }
  return result && result.modeKey === modeKey ? { files: result.files, loaded: true } : { files: NO_ENERGY, loaded: false }
}

// What a view's chart is like, for which charts can stand in for each other:
// every 5-minute view is charted alike, but each aggregate view's periods are
// its own. `prefix` keeps one panel's node apart from another's.
export function chartKind(mode: DateMode, prefix = ''): string {
  return `${prefix} ${isAggregateMode(mode) ? JSON.stringify(mode) : 'dispatch'}`
}

// A view's data and estimate held by useShownWithSolar, with its chartKind, or
// a null kind if it was charted without its estimate
export interface HeldWithSolar<T> {
  kind: string | null
  value: T
}

// What useShownWithSolar charts on a render: `value`, unless it's still
// waiting on its estimate, when it's what's held for the same kind of chart
// (or null), and what to hold from then on
export function shownWithSolar<T>(value: T, kind: string, enabled: boolean, waiting: boolean, held: HeldWithSolar<T> | null): { shown: T | null; held: HeldWithSolar<T> | null } {
  if (waiting) return { shown: held?.kind === kind ? held.value : null, held }
  // A view charted without its estimate (with `enabled` false) isn't held for when it's turned on
  return { shown: value, held: { kind: enabled ? kind : null, value } }
}

// `value`, a view's data and its distributed solar estimate, as it's charted:
// once the data has loaded, it waits up to SOLAR_WAIT_MS for the estimate, so
// the estimate isn't charted a moment after the rest. Meanwhile the last value
// charted of the same kind (see chartKind) is held, e.g. the Today view's
// while the 3d view's estimate loads, or null if there's none. After that the
// data is charted without the estimate, which is added when it comes. `view`
// tells one view's wait from the next. Nothing is waited on while `enabled` is false.
export function useShownWithSolar<T>(value: T, view: string, kind: string, enabled: boolean, dataLoaded: boolean, solarLoaded: boolean): { shown: T | null; waiting: boolean } {
  const wait = enabled && dataLoaded && !solarLoaded ? view : null
  const [timedOut, setTimedOut] = useState(false)
  // Each wait gets its own SOLAR_WAIT_MS, without a render of the last one's timeout
  const [lastWait, setLastWait] = useState(wait)
  const waitChanged = wait !== lastWait
  if (waitChanged) {
    setLastWait(wait)
    setTimedOut(false)
  }

  useEffect(() => {
    if (wait === null) return
    const timer = setTimeout(() => setTimedOut(true), SOLAR_WAIT_MS)
    return () => clearTimeout(timer)
  }, [wait])

  const waiting = wait !== null && (waitChanged || !timedOut)
  const held = useRef<HeldWithSolar<T> | null>(null)
  const next = shownWithSolar(value, kind, enabled, waiting, held.current)
  held.current = next.held
  return { shown: next.shown, waiting }
}
