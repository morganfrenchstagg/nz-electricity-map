import type { Generator, Unit } from '../src/types'
import { isCharging } from '../src/utils/generators'
import { unitFuel } from './html'
import type { Definitions } from './html'

// Yearly figures for the built pages, from the API's yearly totals
// (/v1/dispatch/aggregates/annual): a row for each year, its first day then
// each node's MWh. A generating unit's node ("HLY2201 HLY5") is what it sent to
// the grid, and a bus's ("OTA0221") is negative where power was taken from it.
// Before 10 September 2020 they're EMI's metered generation and grid exit
// volumes, and after it the five-minute dispatch.

export interface AnnualAggregates {
  series: string[]
  data: (string | number | null)[][]
  hvdc?: { series: string[]; data: (string | number | null)[][] }
}

// The renewable fuels, as the API's MCP server counts them
export const RENEWABLE_FUELS = ['Hydro', 'Geothermal', 'Wind', 'Solar']

// The totals start in August 1997
const FIRST_YEAR_STARTS_MIDWAY = 1997

export interface Stats {
  years: number[]
  // The years only partly covered: the first, and the current one so far
  partial: ReadonlySet<number>
  // Each node's MWh in each of the years
  mwh: Map<string, number[]>
  // GWh the HVDC sent each way in each of the years
  hvdc: { north: number[]; south: number[] } | null
}

export function parseStats(aggregates: AnnualAggregates, thisYear: number): Stats {
  const years = aggregates.data.map((row) => Number(String(row[0]).slice(0, 4)))
  const mwh = new Map(aggregates.series.map((code, i) => [code, aggregates.data.map((row) => Number(row[i + 1]) || 0)]))
  const partial = new Set(years.filter((y) => y <= FIRST_YEAR_STARTS_MIDWAY || y >= thisYear))
  let hvdc: Stats['hvdc'] = null
  if (aggregates.hvdc) {
    const { series, data } = aggregates.hvdc
    const north = series.indexOf('northFlow') + 1,
      south = series.indexOf('southFlow') + 1
    const byYear = new Map(data.map((row) => [Number(String(row[0]).slice(0, 4)), row]))
    const flow = (col: number) => years.map((y) => (Number(byYear.get(y)?.[col]) || 0) / 1000)
    if (north && south) hvdc = { north: flow(north), south: flow(south) }
  }
  return { years, partial, mwh, hvdc }
}

// The GWh in each year at these nodes, each counted once
export function sumNodes(stats: Stats, nodes: Iterable<string>): number[] {
  const total = stats.years.map(() => 0)
  for (const node of new Set(nodes))
    stats.mwh.get(node)?.forEach((v, i) => {
      total[i] += v
    })
  return total.map((v) => v / 1000)
}

// The nodes units generate at: each one's but a battery's charging unit, which draws power
export function generationNodes(units: Unit[]): string[] {
  return [...new Set(units.filter((u) => !isCharging(u)).map((u) => u.node))]
}

// The grid's generation in each year: every generating node, even one the definitions don't have
export function totalGeneration(stats: Stats, defs: Definitions): number[] {
  const charging = new Set(defs.generators.flatMap((g) => g.units.filter(isCharging).map((u) => u.node)))
  return sumNodes(
    stats,
    [...stats.mwh.keys()].filter((code) => code.includes(' ') && !charging.has(code)),
  )
}

// Generation in each year grouped by `key`, from each node's first unit, e.g.
// by fuel. A unit `key` gives null for is left out.
export function generationBy(
  stats: Stats,
  defs: Definitions,
  key: (g: Generator, u: Unit) => string | null,
): Map<string, number[]> {
  const nodes = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const g of defs.generators) {
    for (const u of g.units) {
      if (isCharging(u) || seen.has(u.node)) continue
      seen.add(u.node)
      const k = key(g, u)
      if (k !== null) nodes.set(k, [...(nodes.get(k) ?? []), u.node])
    }
  }
  return new Map([...nodes].map(([k, n]) => [k, sumNodes(stats, n)]))
}

export function generationByFuel(stats: Stats, defs: Definitions): Map<string, number[]> {
  return generationBy(stats, defs, (_g, u) => unitFuel(u))
}

// What was taken from the grid at a substation in each year: its buses' load,
// net of any generation embedded behind them
export function substationDemand(stats: Stats, siteId: string): number[] {
  return sumNodes(
    stats,
    [...stats.mwh.keys()].filter((code) => !code.includes(' ') && code.slice(0, 3) === siteId),
  ).map((v) => -v)
}

// The latest year wholly covered, or -1
export function lastFullYear(stats: Stats): number {
  for (let i = stats.years.length - 1; i >= 0; i--) if (!stats.partial.has(stats.years[i])) return i
  return -1
}

// The current year so far, or -1
export function currentYear(stats: Stats): number {
  const i = stats.years.length - 1
  return i > 0 && stats.partial.has(stats.years[i]) ? i : -1
}

export function hoursIn(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365) * 24
}
