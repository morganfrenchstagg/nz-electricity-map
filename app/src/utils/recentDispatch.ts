import type { RecentData } from '../types'

// dispatch/recent holds 3 days of 5-minute intervals, dropping the oldest as each arrives.
// Matches the API's MAX_DATA_POINTS.
export const RECENT_INTERVALS = (60 / 5) * 24 * 3

// Newest intervals refetched each time: the API can revise an interval after it's first fetched,
// or fill in one it skipped, and a bad one kept would stay on the chart until a reload.
export const REFETCHED_INTERVALS = 6

// For dispatch/recent?since=: the interval before the last REFETCHED_INTERVALS, or the oldest if fewer
export function refetchSince(recent: RecentData): string | undefined {
  const row = recent.data[Math.max(recent.data.length - 1 - REFETCHED_INTERVALS, 0)]
  return row?.[0] as string | undefined
}

type Row = (string | number | null)[]

// Replaces held intervals after `since` with the fetched ones, dropping the oldest past
// RECENT_INTERVALS like the API, so it matches a full fetch. Filters to after `since` in case
// the API ignores it. The HVDC's whole last day comes every time, so it replaces the held one.
// Returns `held` itself when unchanged, so it isn't re-charted.
//
// Null when the nodes have changed: the held columns no longer line up, so refetch it all.
export function appendRecent(held: RecentData, added: RecentData, since: string): RecentData | null {
  if (added.series.length !== held.series.length || added.series.some((s, i) => s !== held.series[i])) return null

  const isAfter = (row: Row) => (row[0] as string) > since
  const heldPricing = held.pricing ?? []
  const data = added.data.filter(isAfter)
  const pricing = (added.pricing ?? []).filter(isAfter)
  const hvdc = added.hvdc ?? held.hvdc
  // em6 publishes each half hour well after the dispatch, so it can bring something new on its own
  const newestHvdc = (h: RecentData['hvdc']) => h?.data[h.data.length - 1]?.[0]
  const hvdcIsNew = newestHvdc(hvdc) !== newestHvdc(held.hvdc)
  const unchanged = sameRows(held.data.filter(isAfter), data) && sameRows(heldPricing.filter(isAfter), pricing)
  if (unchanged) return hvdcIsNew ? { ...held, hvdc } : held

  return {
    series: held.series,
    data: [...held.data.filter(row => !isAfter(row)), ...data].slice(-RECENT_INTERVALS),
    pricing: [...heldPricing.filter(row => !isAfter(row)), ...pricing].slice(-RECENT_INTERVALS),
    ...(hvdc && { hvdc }),
  }
}

function sameRows(a: Row[], b: Row[]): boolean {
  return a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((v, j) => v === b[i][j]))
}
