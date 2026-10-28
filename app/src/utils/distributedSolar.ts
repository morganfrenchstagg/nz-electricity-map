import type { SolarEnergy, SolarProduction } from '../api'
import { nzWallClockMs } from './time'

// The estimate has a point every 15 minutes
const PROFILE_STEP_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

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

// `values` (distributedSolarAt's MW at each of `times`) with the forecast left
// out, as at a single GXP it's too rough to show: everything after the newest
// satellite reading, and before that, any forecast of sun. A day's readings
// stop around sunset, and its night is forecast as none, which is kept so the
// line runs on through it into the next day's readings.
export function observedSolar(days: SolarProduction[], times: number[], values: (number | null)[]): (number | null)[] {
  const observedUntil = new Map(days.map((day) => [
    day.date,
    day.observedUntil ? nzWallClockMs(Date.parse(day.observedUntil)) : -Infinity,
  ]))
  const newest = Math.max(...observedUntil.values())
  return values.map((mw, i) => {
    const ms = times[i]
    const forecast = ms > (observedUntil.get(new Date(ms).toISOString().slice(0, 10)) ?? -Infinity)
    return forecast && (ms > newest || mw !== 0) ? null : mw
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

// How many days run from one "YYYY-MM-DD" date to another, counting both
function daysThrough(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1
}

// A period's distributed solar energy estimated at the GXPs kept, in MWh, and
// how many of its days that's from, of the `ofDays` there could be
export interface SolarPeriod {
  mwh: number
  days: number
  ofDays: number
}

// Each period of `files`, keyed by its first day, at the GXPs `includeGxp`
// keeps. A period can be short of days, as the backfill only covers part of
// the oldest, and days can still be waiting on weather. `ofDays` counts its
// days up to `yesterday`, as the API has none for today. A period with no days
// estimated is left out.
export function distributedSolarEnergy(files: SolarEnergy[], includeGxp: (gxp: string) => boolean, yesterday: string): Map<string, SolarPeriod> {
  const energy = new Map<string, SolarPeriod>()
  for (const { series, data } of files) {
    const kept = series.flatMap((gxp, i) => (includeGxp(gxp) ? [i] : []))
    for (const { from, to, days, mwh } of data) {
      if (days === 0) continue
      energy.set(from, {
        mwh: kept.reduce((sum, i) => sum + mwh[i], 0),
        days,
        ofDays: daysThrough(from, to < yesterday ? to : yesterday),
      })
    }
  }
  return energy
}

// The tooltip's note on a period the estimate is short of days for, or null
export function shortOfDaysNote(period: SolarPeriod | undefined): string | null {
  return period && period.days < period.ofDays ? `Distributed solar estimated for ${period.days} of ${period.ofDays} days` : null
}
