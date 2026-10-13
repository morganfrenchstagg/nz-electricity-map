// Dispatch timestamps are NZ local time with no offset (e.g. "2026-10-13T14:30:00").
// The app treats them as "local time as UTC" by appending 'Z' so Highcharts and
// comparisons are independent of the browser's timezone. Anything measuring how
// old a timestamp is must express "now" in that same convention; comparing
// against Date.now() directly would be off by NZ's UTC offset.

export function nzLocalMs(ts: string): number {
  return new Date(ts + 'Z').getTime()
}

export function nzNowMs(): number {
  return new Date(
    new Date().toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T') + 'Z'
  ).getTime()
}

// Today's NZ date, as "YYYY-MM-DD"
export function todayNZ(): string {
  return new Date(nzNowMs()).toISOString().slice(0, 10)
}

// Outage timestamps carry an offset (e.g. "2026-10-13T14:30:00+13:00"), but
// their clock time is already NZ local, so dropping the offset puts them in
// the same convention as dispatch timestamps.
export function outageMs(iso: string): number {
  return nzLocalMs(iso.replace(/([+-]\d{2}:\d{2}|Z)$/, ''))
}
