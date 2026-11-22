import { barChart } from './charts'
import { esc, table } from './html'
import type { Definitions } from './html'
import { currentYear, lastFullYear, totalGeneration, yearLabel } from './stats'
import type { Stats } from './stats'

export { firstYear, yearLabel } from './stats'

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
    label: String(year), value: values[from + j], partial: stats.partial.has(year),
  })), opts)
}
