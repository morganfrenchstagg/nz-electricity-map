// Dispatch timestamps are NZ local time with no offset ("2026-10-13T14:30:00"). The app reads them
// as UTC ("local time as UTC") so Highcharts and comparisons ignore the browser's time zone.
// "Now" must use the same convention (nzNowMs); Date.now() is off by NZ's UTC offset.

export function nzLocalMs(ts: string): number {
  return new Date(ts + 'Z').getTime()
}

// An instant's NZ wall-clock time, in the same convention
export function nzWallClockMs(ms: number): number {
  return new Date(
    new Date(ms).toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T') + 'Z'
  ).getTime()
}

export function nzNowMs(): number {
  return nzWallClockMs(Date.now())
}

// Both ends included, in the same convention
export interface Period {
  from: number
  to: number
}

// Today's NZ date, as "YYYY-MM-DD"
export function todayNZ(): string {
  return new Date(nzNowMs()).toISOString().slice(0, 10)
}

// A real timestamp, not local time as UTC: 13 hours before UTC midnight in NZDT, 12 in NZST.
// NZ's clocks change at 2am or 3am, so midnight is never skipped or repeated.
export function nzMidnightMs(isoDate: string): number {
  const wallClock = nzLocalMs(`${isoDate}T00:00:00`)
  const nzdt = wallClock - 13 * 60 * 60 * 1000
  return nzWallClockMs(nzdt) === wallClock ? nzdt : wallClock - 12 * 60 * 60 * 1000
}

// Outage timestamps carry an offset ("2026-10-13T14:30:00+13:00") but their clock time is NZ
// local, so dropping the offset matches the dispatch convention.
export function outageMs(iso: string): number {
  return nzLocalMs(iso.replace(/([+-]\d{2}:\d{2}|Z)$/, ''))
}
