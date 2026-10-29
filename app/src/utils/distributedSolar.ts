import Highcharts from 'highcharts'
import type { SolarEnergy, SolarProduction } from '../api'
import { nzLocalMs, nzWallClockMs } from './time'

// The estimate has a point every 15 minutes
const PROFILE_STEP_MS = 15 * 60 * 1000
const DISPATCH_INTERVAL_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

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

// Today's distributed solar energy so far, in MWh, and with the forecast left
// out, the last time it covers
export interface SolarSoFar {
  mwh: number
  until?: number
}

// Today's distributed solar energy so far at the GXPs `includeGxp` keeps, for
// the aggregate views' period so far, as the API's totals stop at yesterday.
// Its MW at each 5-minute dispatch time from midnight up to `now` (in the
// "local time as UTC" convention) is summed as the dispatch totals are.
// `observedOnly` leaves out the forecast (see observedSolar). Null when there's
// no estimate for today at those GXPs.
export function solarSoFar(days: SolarProduction[], today: string, now: number, includeGxp: (gxp: string) => boolean, observedOnly = false): SolarSoFar | null {
  const estimate = days.filter((day) => day.date === today && day.gxps.some((g) => includeGxp(g.gxp)))
  const times: number[] = []
  for (let ms = nzLocalMs(`${today}T00:00:00`); ms <= now; ms += DISPATCH_INTERVAL_MS) times.push(ms)
  const at = distributedSolarAt(estimate, times, includeGxp)
  const values = observedOnly ? observedSolar(estimate, times, at) : at
  const covered = times.filter((_, i) => values[i] !== null)
  if (covered.length === 0) return null
  const mwh = values.reduce<number>((sum, mw) => sum + (mw ?? 0), 0) * DISPATCH_INTERVAL_MS / HOUR_MS
  return observedOnly ? { mwh, until: covered[covered.length - 1] } : { mwh }
}

// A period's distributed solar energy estimated at the GXPs kept, in MWh, and
// how many of its days that's from. On the period so far, `until` is the last
// time today's share covers, when the forecast is left out.
export interface SolarPeriod {
  mwh: number
  days: number
  until?: number
}

// Each period of `files`, keyed by its first day, at the GXPs `includeGxp`
// keeps, with `soFar` (see solarSoFar) added to the one `today` falls in. A
// period starting today has no total yet, so it's keyed by today. A period can
// be short of days, as the backfill only covers part of the oldest, and days
// can still be waiting on weather, so it's from the days it has. A period with
// no days estimated is left out.
export function distributedSolarEnergy(files: SolarEnergy[], includeGxp: (gxp: string) => boolean, today: string, soFar: SolarSoFar | null): Map<string, SolarPeriod> {
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
    if (!current) energy.set(today, current = { mwh: 0, days: 0 })
    current.mwh += soFar.mwh
    current.days += 1
    if (soFar.until !== undefined) current.until = soFar.until
  }
  for (const [from, period] of energy) if (period.days === 0) energy.delete(from)
  return energy
}

// The tooltip's note on the period so far, when its share of today stops short
// of now (see solarSoFar), or null
export function solarPeriodNote(period: SolarPeriod | undefined): string | null {
  return period?.until !== undefined ? `Today's embedded solar estimated up to ${Highcharts.dateFormat('%I:%M %p', period.until)}, from satellite readings` : null
}
