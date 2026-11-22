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

// How long a view's data waits for its estimate before charting without it
export const SOLAR_WAIT_MS = 2000

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Oldest first. Aggregate views chart the API's energy totals (see
// useDistributedSolarEnergy), which stop at yesterday, so they take today's
// estimate for the period so far.
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

// The estimate for each day a view charts (see solarDatesOf) that the API has.
// Until `loaded`, the days are the last view's, or empty. Not fetched while
// `enabled` is false.
export function useDistributedSolar(mode: DateMode, enabled: boolean): { days: SolarProduction[]; loaded: boolean } {
  // Tagged with its view, to tell its days from the last view's
  const key = enabled ? JSON.stringify(mode) : null
  const [fetched, setFetched] = useState<{ key: string; days: SolarProduction[] } | null>(null)

  // All-cached days show this render, not a render later after the effect refetches
  const cached = useMemo(() => {
    if (!key) return null
    const days = solarDatesOf(mode).map(peekSolarProduction)
    return days.every((day) => day !== undefined) ? days.filter((day): day is SolarProduction => day !== null) : null
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key) return
    let cancelled = false

    async function load() {
      // Worked out per load, so live views move to the next day at midnight. The
      // estimate is an extra: a day that fails is left out (and retried on the
      // next live poll) rather than holding up the rest.
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

// The API has no quarterly totals, so monthly ones are summed (like sumQuarters).
// Each quarter is keyed by its first day and runs to its last, even before its
// last months have days. `files` and their months must be in order.
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

// Estimated energy totals for an aggregate view, from files covering the same
// periods as its dispatch totals (see aggregateWindow). Empty while loading, on
// other views, and while `enabled` is false.
export function useDistributedSolarEnergy(mode: DateMode, enabled: boolean): { files: SolarEnergy[]; loaded: boolean } {
  // Tagged with its view, as useAggregates' totals are, so switching views doesn't
  // chart one's totals against the other's periods
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

// Charts of the same kind can stand in for each other: all 5-minute views chart
// alike, but each aggregate view has its own periods. `prefix` keeps one panel's
// node apart from another's.
export function chartKind(mode: DateMode, prefix = ''): string {
  return `${prefix} ${isAggregateMode(mode) ? JSON.stringify(mode) : 'dispatch'}`
}

// `kind` is its chartKind, or null if it was charted without its estimate
export interface HeldWithSolar<T> {
  kind: string | null
  value: T
}

// `value`, unless still waiting on its estimate; then what's held for the same
// kind of chart, or null. Also returns what to hold from then on.
export function shownWithSolar<T>(value: T, kind: string, enabled: boolean, waiting: boolean, held: HeldWithSolar<T> | null): { shown: T | null; held: HeldWithSolar<T> | null } {
  if (waiting) return { shown: held?.kind === kind ? held.value : null, held }
  // Charted without its estimate (`enabled` false), so not held for when it's turned on
  return { shown: value, held: { kind: enabled ? kind : null, value } }
}

// Once data has loaded, waits up to SOLAR_WAIT_MS for the estimate, so it isn't
// charted a moment after the rest. Meanwhile shows the last value charted of the
// same kind (see chartKind), e.g. Today's while 3d's estimate loads, or null.
// After that, charts without the estimate and adds it when it comes. `view` tells
// one view's wait from the next. No wait while `enabled` is false.
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
