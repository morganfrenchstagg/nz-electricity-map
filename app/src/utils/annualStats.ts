import type { Generator, Substation, Unit } from '../types'
import { isCharging, isRetired } from './generators'

// Each station's and substation's figures a year, from the API's yearly totals
// (/v1/dispatch/aggregates/annual): a row for each year, its first day then
// each node's MWh. A generating unit's node ("HLY2201 HLY5") is what it sent to
// the grid, and a bus's ("OTA0221") is negative where power was taken from it.
// Before 10 September 2020 they're EMI's metered generation and grid exit
// volumes, and after it the five-minute dispatch. Both the built station pages
// (see build/pages.ts) and the panels' yearly summaries work from these, so
// they say the same.

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
    const north = series.indexOf('northFlow') + 1, south = series.indexOf('southFlow') + 1
    const byYear = new Map(data.map((row) => [Number(String(row[0]).slice(0, 4)), row]))
    const flow = (col: number) => years.map((y) => (Number(byYear.get(y)?.[col]) || 0) / 1000)
    if (north && south) hvdc = { north: flow(north), south: flow(south) }
  }
  return { years, partial, mwh, hvdc }
}

// The GWh in each year at these nodes, each counted once
export function sumNodes(stats: Stats, nodes: Iterable<string>): number[] {
  const total = stats.years.map(() => 0)
  for (const node of new Set(nodes)) stats.mwh.get(node)?.forEach((v, i) => { total[i] += v })
  return total.map((v) => v / 1000)
}

// The nodes units generate at: each one's but a battery's charging unit, which draws power
export function generationNodes(units: Unit[]): string[] {
  return [...new Set(units.filter((u) => !isCharging(u)).map((u) => u.node))]
}

// The grid's generation in each year: every generating node, even one the definitions don't have
export function totalGeneration(stats: Stats, { generators }: { generators: Generator[] }): number[] {
  const charging = new Set(generators.flatMap((g) => g.units.filter(isCharging).map((u) => u.node)))
  return sumNodes(stats, [...stats.mwh.keys()].filter((code) => code.includes(' ') && !charging.has(code)))
}

// What was taken from the grid at a substation in each year: its buses' load,
// net of any generation embedded behind them
export function substationDemand(stats: Stats, siteId: string): number[] {
  return sumNodes(stats, [...stats.mwh.keys()].filter((code) => !code.includes(' ') && code.slice(0, 3) === siteId)).map((v) => -v)
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

// "2025", "2026 so far", "1997 (Aug–Dec)"
export function yearLabel(stats: Stats, i: number): string {
  const year = stats.years[i]
  if (!stats.partial.has(year)) return String(year)
  return i === 0 ? `${year} (Aug–Dec)` : `${year} so far`
}

// The first year with anything in it, so a station's figures start when it did
export function firstYear(values: number[]): number {
  const i = values.findIndex((v) => Math.abs(v) >= 0.05)
  return i === -1 ? values.length : i
}

// Every station's generation in each year, and where each ranked in the latest full year
export interface StationFigures {
  yearly: Map<Generator, number[]>
  rank: Map<Generator, number>
}

export function stationFigures(stats: Stats, generators: Generator[]): StationFigures {
  const yearly = new Map(generators.map((g) => [g, sumNodes(stats, generationNodes(g.units))]))
  const full = lastFullYear(stats)
  const ranked = full < 0 ? [] : [...yearly].filter(([, v]) => v[full] > 0).sort((a, b) => b[1][full] - a[1][full])
  return { yearly, rank: new Map(ranked.map(([g], i) => [g, i + 1])) }
}

export interface YearFigure {
  year: number
  gwh: number
}

// What a station's yearly figures lead with
export interface StationSummary {
  // The latest full year, and its share of the grid's generation then. Left
  // out for a station since retired.
  latest: (YearFigure & { share: number }) | null
  // Its best full year, once it has more than one
  best: YearFigure | null
  // The current year so far, unless it's retired
  soFar: YearFigure | null
}

// `values` is the station's GWh each year, and `total` the grid's (see totalGeneration)
export function stationSummary(stats: Stats, values: number[], total: number[], retired: boolean): StationSummary {
  const full = lastFullYear(stats), current = currentYear(stats)
  const from = firstYear(values)
  const figure = (i: number): YearFigure => ({ year: stats.years[i], gwh: values[i] })
  const fullYears = stats.years.map((_, i) => i).filter((i) => i >= from && !stats.partial.has(stats.years[i]))
  const best = fullYears.length > 1 ? fullYears.reduce((b, i) => values[i] > values[b] ? i : b, fullYears[0]) : -1
  return {
    latest: !retired && full >= 0 && values[full] > 0 ? { ...figure(full), share: total[full] > 0 ? values[full] / total[full] : 0 } : null,
    best: best >= 0 ? figure(best) : null,
    soFar: !retired && current >= 0 && values[current] > 0 ? figure(current) : null,
  }
}

// What a substation's yearly figures lead with
export interface DemandSummary {
  // What was taken from the grid in the latest full year
  latest: YearFigure
  // Its change on ten years before, where there's demand then
  change: { year: number; fraction: number } | null
}

// `values` is the substation's demand in GWh each year (see substationDemand).
// Null without any in the latest full year.
export function demandSummary(stats: Stats, values: number[]): DemandSummary | null {
  const full = lastFullYear(stats)
  if (full < 0 || !(values[full] > 0.05)) return null
  const before = full - 10 >= firstYear(values) && values[full - 10] > 0 ? full - 10 : -1
  return {
    latest: { year: stats.years[full], gwh: values[full] },
    change: before >= 0 ? { year: stats.years[before], fraction: values[full] / values[before] - 1 } : null,
  }
}

// What the panels' yearly summaries are worked out from, once for every panel
export interface AnnualFigures {
  stats: Stats
  // The grid's generation in each year (GWh)
  total: number[]
  // Each station's rank in the latest full year, by its site
  rankBySite: Map<string, number>
}

export function annualFigures(aggregates: AnnualAggregates, generators: Generator[], thisYear: number): AnnualFigures {
  const stats = parseStats(aggregates, thisYear)
  const { rank } = stationFigures(stats, generators)
  return { stats, total: totalGeneration(stats, { generators }), rankBySite: new Map([...rank].map(([g, r]) => [g.site, r])) }
}

// A station's summary, or several picked together's as one. Only one station has a rank.
export function generatorsSummary({ stats, total, rankBySite }: AnnualFigures, generators: Generator[]): StationSummary & { rank: number | null } {
  const values = sumNodes(stats, generationNodes(generators.flatMap((g) => g.units)))
  const summary = stationSummary(stats, values, total, generators.every((g) => isRetired(g)))
  return { ...summary, rank: generators.length === 1 ? rankBySite.get(generators[0].site) ?? null : null }
}

// A substation's demand summary, or several picked together's as one
export function substationsSummary({ stats }: AnnualFigures, substations: Substation[]): DemandSummary | null {
  const values = stats.years.map(() => 0)
  for (const siteId of new Set(substations.map((s) => s.siteId))) substationDemand(stats, siteId).forEach((v, i) => { values[i] += v })
  return demandSummary(stats, values)
}

// Whole GWh from 100 up, and to a decimal place below
export function gwh(n: number): string {
  return `${n.toLocaleString('en-NZ', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 })} GWh`
}

// To a decimal place, so a share too small to show one says so
export function pct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0005) return 'under 0.1%'
  return `${(fraction * 100).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}%`
}

export function ordinal(n: number): string {
  const tens = n % 100, ones = n % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// "up 12.3% on 2015", "down 4% on 2015", "about the same as in 2015"
export function changeOn({ year, fraction }: { year: number; fraction: number }): string {
  if (Math.abs(fraction) < 0.005) return `about the same as in ${year}`
  return `${fraction > 0 ? 'up' : 'down'} ${pct(Math.abs(fraction))} on ${year}`
}
