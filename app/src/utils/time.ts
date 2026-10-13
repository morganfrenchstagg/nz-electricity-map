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
