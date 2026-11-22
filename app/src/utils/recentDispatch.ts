import type { RecentData } from '../types'

// The most intervals dispatch/recent holds (3 days of them), dropping the oldest
// as each new one arrives. Matches the API's MAX_DATA_POINTS.
export const RECENT_INTERVALS = (60 / 5) * 24 * 3

// How many of the newest intervals held are fetched again with each new one.
// The API can give an interval different values after it's first been fetched,
// and fill in one it skipped, so these are taken from it again rather than
// kept as first fetched. Kept as first fetched, a bad interval would stay on
// the chart until the page was reloaded.
export const REFETCHED_INTERVALS = 6

// The interval to fetch everything after (dispatch/recent?since=): the one
// before the last REFETCHED_INTERVALS held, or the oldest when there are fewer
export function refetchSince(recent: RecentData): string | undefined {
  const row = recent.data[Math.max(recent.data.length - 1 - REFETCHED_INTERVALS, 0)]
  return row?.[0] as string | undefined
}

type Row = (string | number | null)[]

// Takes the intervals fetched after `since` in place of those held, dropping
// the oldest past RECENT_INTERVALS like the API does, so it matches what
// fetching all of them would give. Only rows after `since` are taken, so an
// API that ignores `since` and sends everything is fine too. The HVDC's whole
// last day comes every time, so it replaces the one held. Gives back `held`
// itself when nothing has changed, so it isn't re-charted.
//
// Null when the nodes have changed, as the held rows' columns no longer line
// up with the new ones and it all needs fetching again.
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
