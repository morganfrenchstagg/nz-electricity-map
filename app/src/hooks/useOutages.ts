import { useState, useEffect } from 'react'
import { fetchOutages, peekOutages } from '../api'
import type { OutageData } from '../api'
import { datesBetween, isLiveMode, isPastMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { mergeOutageDays } from '../utils/outages'
import { pollWhileVisible } from '../utils/poll'

// Only reaches the network once the last response's max-age runs out (see api.ts)
const REFRESH_MS = 5 * 60 * 1000

// The days whose outages a view shows, or none for the current ones
function outageDays(mode: DateMode): string[] {
  if (!isPastMode(mode)) return []
  return mode.kind === 'date' ? [mode.date] : datesBetween(mode.from, mode.to)
}

function peekDays(days: string[]): OutageData | null {
  if (days.length === 0) return peekOutages() ?? null
  const held = days.map((day) => peekOutages(day))
  return held.every((d) => d !== undefined) ? mergeOutageDays(held as OutageData[]) : null
}

// A past day's or range's outages are the ones going on in its days, so its
// capacity is what it was then. Every other view has the current ones: Today and
// 3d keep them up to date, and the 90d, 1y, 5y and All views, whose map shows live
// data, load them once and don't refresh them until Today or 3d is picked again.
export function useOutages(mode: DateMode): OutageData | null {
  const key = outageDays(mode).join(',')
  const live = isLiveMode(mode)
  const [shown, setShown] = useState(() => ({ key, outages: peekDays(outageDays(mode)) }))
  // A view picked whose outages haven't loaded yet has none, rather than the last view's
  if (shown.key !== key) setShown({ key, outages: peekDays(outageDays(mode)) })

  useEffect(() => {
    let cancelled = false
    const days = key ? key.split(',') : []
    function load() {
      const outages =
        days.length > 0 ? Promise.all(days.map((day) => fetchOutages(day))).then(mergeOutageDays) : fetchOutages()
      outages
        // Most polls hand back the same cached outages, which would re-render for nothing
        .then((data) => {
          if (!cancelled)
            setShown((prev) => (prev.key === key && prev.outages === data ? prev : { key, outages: data }))
        })
        .catch(() => {})
    }
    load()
    const stopPolling = live ? pollWhileVisible(load, REFRESH_MS) : undefined
    return () => {
      cancelled = true
      stopPolling?.()
    }
  }, [key, live])

  return shown.key === key ? shown.outages : null
}
