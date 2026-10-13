import type { OutageRecord } from '../api'
import { outageMs } from './time'

export interface OutageSegment {
  start: number
  end: number
  mw: number
}

// Collapses overlapping outage records for a single unit into a timeline of
// distinct MW-loss segments (e.g. two overlapping 3MW outages become one 6MW
// segment for the overlap, then a 3MW segment for the tail). Segments that have
// already fully ended are dropped, but a segment's start is its real record
// start — never clipped to "now" — so an ongoing outage still shows when it
// actually began. Times are outageMs's, so `nowMs` must be nzNowMs().
export function mergeOutageSegments(records: OutageRecord[], nowMs: number): OutageSegment[] {
  const events = new Set<number>()
  for (const r of records) {
    events.add(outageMs(r.timeStart))
    events.add(outageMs(r.timeEnd))
  }
  const sorted = [...events].sort((a, b) => a - b)
  const segments: OutageSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]
    const segEnd = sorted[i + 1]
    if (segEnd <= nowMs) continue
    const mw = records.reduce((sum, r) => {
      const s = outageMs(r.timeStart)
      const e = outageMs(r.timeEnd)
      return s <= segStart && e >= segEnd ? sum + r.mwattLost : sum
    }, 0)
    if (mw <= 0) continue
    const last = segments[segments.length - 1]
    if (last && Math.abs(last.mw - mw) < 0.001 && last.end === segStart) last.end = segEnd
    else segments.push({ start: segStart, end: segEnd, mw })
  }
  return segments
}
