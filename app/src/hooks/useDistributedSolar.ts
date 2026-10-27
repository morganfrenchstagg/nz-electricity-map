import { useEffect, useState } from 'react'
import { fetchSolarProduction, peekSolarProduction } from '../api'
import type { SolarProduction } from '../api'
import { datesBetween, isAggregateMode, isLiveMode, periodOf } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { pollWhileVisible } from '../utils/poll'

// Cheap: only reaches the network once the cached estimate expires (see api.ts)
const POLL_MS = 15 * 1000

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The dates of the distributed solar estimate a view charts, oldest first:
// each day it covers. The aggregate views' MWh totals have nothing to put it with.
export function solarDatesOf(mode: DateMode): string[] {
  if (isAggregateMode(mode)) return []
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
