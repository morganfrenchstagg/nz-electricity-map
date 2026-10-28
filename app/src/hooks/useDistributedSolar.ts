import { useEffect, useState } from 'react'
import { fetchSolarEnergy, fetchSolarProduction, peekSolarProduction } from '../api'
import type { SolarEnergy, SolarProduction } from '../api'
import { datesBetween, isAggregateMode, isLiveMode, periodOf } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { aggregateWindow, quarterStart } from './useAggregates'
import { pollWhileVisible } from '../utils/poll'
import { todayNZ } from '../utils/time'

// Cheap: only reaches the network once the cached estimate expires (see api.ts)
const POLL_MS = 15 * 1000

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

// The distributed solar estimate for each day a view charts (see solarDatesOf)
// that the API has it for. Empty while it loads. Not fetched while `enabled` is false.
export function useDistributedSolar(mode: DateMode, enabled: boolean): SolarProduction[] {
  const [days, setDays] = useState<SolarProduction[]>([])

  useEffect(() => {
    let cancelled = false
    const live = isLiveMode(mode)

    // Most polls hand back the same cached days, which would re-chart for nothing
    function show(next: (SolarProduction | null)[]) {
      const found = next.filter((day): day is SolarProduction => day !== null)
      setDays((prev) => (prev.length === found.length && found.every((d, i) => d === prev[i]) ? prev : found))
    }

    async function load() {
      // Worked out on each load, so the live views move on to the next day at midnight
      const dates = enabled ? solarDatesOf(mode) : []
      const cached = dates.map(peekSolarProduction)
      if (cached.every((d) => d !== undefined)) show(cached as (SolarProduction | null)[])
      // The estimate is an extra, so a day that fails is left out (and retried
      // on the live views' next poll) rather than holding up the rest
      const fetched = await Promise.all(dates.map((date) => fetchSolarProduction(date).catch(() => null)))
      if (!cancelled) show(fetched)
    }

    load()
    const stopPolling = live && enabled ? pollWhileVisible(load, POLL_MS) : undefined

    return () => {
      cancelled = true
      stopPolling?.()
    }
  }, [mode, enabled])

  return days
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
// aggregateWindow). Empty while they load, on the other views, and while
// `enabled` is false.
export function useDistributedSolarEnergy(mode: DateMode, enabled: boolean): SolarEnergy[] {
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

  return result && result.modeKey === modeKey ? result.files : NO_ENERGY
}
