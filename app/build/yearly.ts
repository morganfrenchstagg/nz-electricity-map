import { barChart } from './charts'
import { esc, table } from './html'
import type { Definitions } from './html'
import { currentYear, lastFullYear, totalGeneration } from './stats'
import type { Stats } from './stats'

// What every page's yearly figures are worked out from, once for the build

export interface Context {
  defs: Definitions
  stats: Stats | null
  // The grid's generation in each year (GWh)
  total: number[]
  // The latest year wholly covered, and the current one so far, as indices into stats.years, or -1
  full: number
  current: number
}

export function buildContext(defs: Definitions, stats: Stats | null): Context {
  return {
    defs, stats,
    total: stats ? totalGeneration(stats, defs) : [],
    full: stats ? lastFullYear(stats) : -1,
    current: stats ? currentYear(stats) : -1,
  }
}

// "2025", "2026 so far", "1997 (Aug–Dec)"
export function yearLabel(stats: Stats, i: number): string {
  const year = stats.years[i]
  if (!stats.partial.has(year)) return String(year)
  return i === 0 ? `${year} (Aug–Dec)` : `${year} so far`
}

// The first year with anything in it, so a station's table starts when it did
export function firstYear(values: number[]): number {
  const i = values.findIndex((v) => Math.abs(v) >= 0.05)
  return i === -1 ? values.length : i
}

export interface Column {
  head: string
  values: number[]
  format: (v: number) => string
}

// A row a year from `from`, newest first
export function yearlyTable(stats: Stats, columns: Column[], from = 0): string {
  const rows: string[][] = []
  for (let i = stats.years.length - 1; i >= from; i--) {
    rows.push([esc(yearLabel(stats, i)), ...columns.map((c) => esc(c.format(c.values[i])))])
  }
  return table(['Year', ...columns.map((c) => c.head)], rows)
}

export function yearlyChart(stats: Stats, values: number[], from: number, opts: { colour: string; unit: string; label: string; format: (v: number) => string }): string {
  return barChart(stats.years.slice(from).map((year, j) => ({
    label: String(year), value: values[from + j], partial: stats.partial.has(year), title: yearLabel(stats, from + j),
  })), opts)
}
