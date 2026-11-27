import Highcharts from 'highcharts'
import type { SolarEnergy, SolarProduction } from '../api'
import { nzLocalMs, nzWallClockMs } from './time'

// The estimate has a point every 15 minutes
const PROFILE_STEP_MS = 15 * 60 * 1000
const DISPATCH_INTERVAL_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

// `points` must be sorted by time. -1 if none is at or before `ms`.
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

// Estimated MW at each of `times` ("local time as UTC"), summed over the GXPs
// `includeGxp` keeps. Interpolated between 15-minute points; the last point holds
// for 15 minutes. Null where the estimate doesn't reach.
export function distributedSolarAt(
  days: SolarProduction[],
  times: number[],
  includeGxp: (gxp: string) => boolean,
): (number | null)[] {
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

// `values` (from distributedSolarAt) without the forecast, too rough to show at a
// single GXP: everything after the newest satellite reading, and any forecast sun
// before it. Readings stop around sunset and nights are forecast as zero; that's
// kept so the line runs through the night into the next day's readings.
export function observedSolar(days: SolarProduction[], times: number[], values: (number | null)[]): (number | null)[] {
  const observedUntil = new Map(
    days.map((day) => [day.date, day.observedUntil ? nzWallClockMs(Date.parse(day.observedUntil)) : -Infinity]),
  )
  const newest = Math.max(...observedUntil.values())
  return values.map((mw, i) => {
    const ms = times[i]
    const forecast = ms > (observedUntil.get(new Date(ms).toISOString().slice(0, 10)) ?? -Infinity)
    return forecast && (ms > newest || mw !== 0) ? null : mw
  })
}

// Installed MW at the kept GXPs, keyed by date. It steps at month ends, which a
// range can span.
export function distributedSolarCapacities(
  days: SolarProduction[],
  includeGxp: (gxp: string) => boolean,
): Map<string, number> {
  return new Map(
    days.map((day) => [
      day.date,
      day.gxps.filter((g) => includeGxp(g.gxp)).reduce((sum, g) => sum + g.distributedMw, 0),
    ]),
  )
}

// `until`: the last time covered, when the forecast is left out
export interface SolarSoFar {
  mwh: number
  until?: number
}

// Today's MWh so far at the kept GXPs, for the aggregate views, as the API's
// totals stop at yesterday. Sums MW at each 5-minute dispatch time from midnight
// to `now` ("local time as UTC"), as the dispatch totals are. `observedOnly`
// leaves out the forecast (see observedSolar). Null with no estimate for today.
export function solarSoFar(
  days: SolarProduction[],
  today: string,
  now: number,
  includeGxp: (gxp: string) => boolean,
  observedOnly = false,
): SolarSoFar | null {
  const estimate = days.filter((day) => day.date === today && day.gxps.some((g) => includeGxp(g.gxp)))
  const times: number[] = []
  for (let ms = nzLocalMs(`${today}T00:00:00`); ms <= now; ms += DISPATCH_INTERVAL_MS) times.push(ms)
  const at = distributedSolarAt(estimate, times, includeGxp)
  const values = observedOnly ? observedSolar(estimate, times, at) : at
  const covered = times.filter((_, i) => values[i] !== null)
  if (covered.length === 0) return null
  const mwh = (values.reduce<number>((sum, mw) => sum + (mw ?? 0), 0) * DISPATCH_INTERVAL_MS) / HOUR_MS
  return observedOnly ? { mwh, until: covered[covered.length - 1] } : { mwh }
}

// `days`: how many days the MWh is from. `until`: on the period so far, the last
// time today's share covers when the forecast is left out.
export interface SolarPeriod {
  mwh: number
  days: number
  until?: number
}

// Each period of `files` at the kept GXPs, keyed by its first day, with `soFar`
// added to the one containing `today` (one starting today has no total yet, so
// it's created under today).
// Periods can be short of days: the backfill covers only part of the oldest, and
// days can still be waiting on weather. Periods with no days are left out.
export function distributedSolarEnergy(
  files: SolarEnergy[],
  includeGxp: (gxp: string) => boolean,
  today: string,
  soFar: SolarSoFar | null,
): Map<string, SolarPeriod> {
  const energy = new Map<string, SolarPeriod>()
  let current: SolarPeriod | undefined
  for (const { series, data } of files) {
    const kept = series.flatMap((gxp, i) => (includeGxp(gxp) ? [i] : []))
    for (const { from, to, days, mwh } of data) {
      const period = { mwh: kept.reduce((sum, i) => sum + mwh[i], 0), days }
      if (from <= today && today <= to) current = period
      energy.set(from, period)
    }
  }
  if (soFar) {
    if (!current) energy.set(today, (current = { mwh: 0, days: 0 }))
    current.mwh += soFar.mwh
    current.days += 1
    if (soFar.until !== undefined) current.until = soFar.until
  }
  for (const [from, period] of energy) if (period.days === 0) energy.delete(from)
  return energy
}

// For the period so far, when today's share stops short of now (see solarSoFar)
export function solarPeriodNote(period: SolarPeriod | undefined): string | null {
  return period?.until !== undefined
    ? `Today's embedded solar estimated up to ${Highcharts.dateFormat('%I:%M %p', period.until)}, from satellite readings`
    : null
}
