import type { RecentData } from '../types'

// The most intervals dispatch/recent holds (3 days of them), dropping the oldest
// as each new one arrives. Matches the API's MAX_DATA_POINTS.
export const RECENT_INTERVALS = (60 / 5) * 24 * 3

// The newest interval held, so only the ones after it need fetching (dispatch/recent?since=)
export function newestTimestamp(recent: RecentData): string | undefined {
  return recent.data[recent.data.length - 1]?.[0] as string | undefined
}

// Adds the intervals fetched since the newest one held, dropping the oldest
// past RECENT_INTERVALS like the API does, so it matches what fetching all of
// them would give. Only rows newer than those held are added, so an API that
// ignores `since` and sends everything is fine too. The HVDC's whole last day
// comes every time, so it replaces the one held. Gives back `held` itself when
// there's nothing new, so it isn't re-charted.
//
// Null when the nodes have changed, as the held rows' columns no longer line
// up with the new ones and it all needs fetching again.
export function appendRecent(held: RecentData, added: RecentData): RecentData | null {
  if (added.series.length !== held.series.length || added.series.some((s, i) => s !== held.series[i])) return null

  const newest = newestTimestamp(held)
  const isNew = (row: (string | number | null)[]) => newest === undefined || (row[0] as string) > newest
  const data = added.data.filter(isNew)
  const hvdc = added.hvdc ?? held.hvdc
  // em6 publishes each half hour well after the dispatch, so it can bring something new on its own
  const newestHvdc = (h: RecentData['hvdc']) => h?.data[h.data.length - 1]?.[0]
  const hvdcIsNew = newestHvdc(hvdc) !== newestHvdc(held.hvdc)
  if (data.length === 0) return hvdcIsNew ? { ...held, hvdc } : held

  return {
    series: held.series,
    data: [...held.data, ...data].slice(-RECENT_INTERVALS),
    pricing: [...(held.pricing ?? []), ...(added.pricing ?? []).filter(isNew)].slice(-RECENT_INTERVALS),
    ...(hvdc && { hvdc }),
  }
}
