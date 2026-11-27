import type { RecentData } from '../types'

// A generator's records at All (see GenerationRecords), from the MWh its codes
// generated each month, added together. Where two months or years tie, the
// earlier one holds the record.
export interface GenerationRecords {
  // The first and last months it generated in, by their first days ("YYYY-MM-DD")
  firstMonth: string
  lastMonth: string
  bestMonth: { month: string; mwh: number }
  bestYear: { year: string; mwh: number }
}

interface Total {
  date: string
  mwh: number
}

// The MWh the codes generated in each row, from its first day ("YYYY-MM-DD")
function totals(data: RecentData, codes: string[]): Total[] {
  const columns = codes.map((code) => data.series.indexOf(code) + 1).filter((col) => col > 0)
  return data.data.map((row) => ({
    date: String(row[0]).slice(0, 10),
    mwh: columns.reduce((sum, col) => sum + (Number(row[col]) || 0), 0),
  }))
}

function best<T extends { mwh: number }>(items: T[]): T {
  return items.reduce((b, item) => (item.mwh > b.mwh ? item : b))
}

// From monthly totals in date order. Null when the codes generated in none of them.
export function generationRecords(monthly: RecentData, codes: string[]): GenerationRecords | null {
  const months = totals(monthly, codes)
  const generated = months.filter((m) => m.mwh > 0)
  if (generated.length === 0) return null
  const years = new Map<string, number>()
  for (const m of months) years.set(m.date.slice(0, 4), (years.get(m.date.slice(0, 4)) ?? 0) + m.mwh)
  const bestMonth = best(generated)
  const bestYear = best([...years].map(([year, mwh]) => ({ year, mwh })))
  return {
    firstMonth: generated[0].date,
    lastMonth: generated[generated.length - 1].date,
    bestMonth: { month: bestMonth.date, mwh: bestMonth.mwh },
    bestYear,
  }
}

// The first and last days the codes generated on, from a month's daily totals
export function firstDayGenerated(daily: RecentData, codes: string[]): string | null {
  return totals(daily, codes).find((d) => d.mwh > 0)?.date ?? null
}

export function lastDayGenerated(daily: RecentData, codes: string[]): string | null {
  return (
    totals(daily, codes)
      .reverse()
      .find((d) => d.mwh > 0)?.date ?? null
  )
}

const HOUR_MS = 60 * 60 * 1000

// The average MW of a month's MWh, over its hours, or those so far for the month
// `nowMs` falls in (both in the "local time as UTC" convention, see utils/time).
// A month the clocks change in is an hour longer or shorter, which is near enough.
export function averageMW(month: string, mwh: number, nowMs: number): number {
  const start = Date.parse(`${month.slice(0, 7)}-01T00:00:00Z`)
  const startOfNext = new Date(start)
  startOfNext.setUTCMonth(startOfNext.getUTCMonth() + 1)
  const hours = (Math.min(startOfNext.getTime(), nowMs) - start) / HOUR_MS
  return hours > 0 ? mwh / hours : 0
}

// The first day of the month before the one `today` ("YYYY-MM-DD") falls in. A
// generator that last generated before it has stopped, for now at least.
export function lastMonthStart(today: string): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 10)
}
