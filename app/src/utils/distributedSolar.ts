import type { SolarProduction } from '../api'
import { nzWallClockMs } from './time'

// The estimate has a point every 15 minutes
const PROFILE_STEP_MS = 15 * 60 * 1000

// The index of the last of `points` at or before `ms`, or -1 if there's none
function lastAtOrBefore(points: [number, number][], ms: number): number {
  let lo = 0
  let hi = points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

// Distributed solar's estimated MW at each of `times` (in the "local time as
// UTC" convention), summed over the GXPs `includeGxp` keeps. It's interpolated
// between the estimate's 15-minute points, and its last point holds for the 15
// minutes after it. Times the estimate doesn't cover are null.
export function distributedSolarAt(days: SolarProduction[], times: number[], includeGxp: (gxp: string) => boolean): (number | null)[] {
  const points = days
    .flatMap((day) => {
      const gxps = day.gxps.filter((g) => includeGxp(g.gxp))
      return day.profileTimes.map((time, i): [number, number] => [
        nzWallClockMs(Date.parse(time)),
        gxps.reduce((sum, g) => sum + g.profileMw[i], 0),
      ])
    })
    .sort(([a], [b]) => a - b)

  return times.map((ms) => {
    const i = lastAtOrBefore(points, ms)
    if (i === -1 || ms - points[i][0] >= PROFILE_STEP_MS) return null
    const [t0, mw0] = points[i]
    const next = points[i + 1]
    // Not across a gap between days
    if (!next || next[0] - t0 > PROFILE_STEP_MS) return mw0
    const [t1, mw1] = next
    return mw0 + ((mw1 - mw0) * (ms - t0)) / (t1 - t0)
  })
}

// The distributed solar installed at the GXPs `includeGxp` keeps, keyed by
// each of `days`' dates. It steps at month ends, which a range can span.
export function distributedSolarCapacities(days: SolarProduction[], includeGxp: (gxp: string) => boolean): Map<string, number> {
  return new Map(days.map((day) => [
    day.date,
    day.gxps.filter((g) => includeGxp(g.gxp)).reduce((sum, g) => sum + g.distributedMw, 0),
  ]))
}
