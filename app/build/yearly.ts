import { barChart } from './charts'
import type { ChartOptions } from './charts'
import { esc, figures, list, shareCell, shareText, table } from './html'
import type { Definitions } from './html'
import { currentYear, lastFullYear, totalGeneration } from './stats'
import type { MonthlyStats, Stats } from './stats'

// What every page's yearly figures are worked out from, once for the build

export interface Context {
  defs: Definitions
  stats: Stats | null
  monthly: MonthlyStats | null
  // When each retired station last generated, by its site code (YYYY-MM-DD)
  lastGenerated: ReadonlyMap<string, string>
  // The grid's generation in each year (GWh)
  total: number[]
  // The latest year wholly covered, and the current one so far, as indices into stats.years, or -1
  full: number
  current: number
}

export function buildContext(
  defs: Definitions,
  stats: Stats | null,
  monthly: MonthlyStats | null = null,
  lastGenerated: ReadonlyMap<string, string> = new Map(),
): Context {
  return {
    defs,
    stats,
    monthly,
    lastGenerated,
    total: stats ? totalGeneration(stats, defs) : [],
    full: stats ? lastFullYear(stats) : -1,
    current: stats ? currentYear(stats) : -1,
  }
}

// "2025", "2026 so far", "1997 (Aug–Dec)"
function yearLabel(stats: Stats, i: number): string {
  const year = stats.years[i]
  if (!stats.partial.has(year)) return String(year)
  return i === 0 ? `${year} (Aug–Dec)` : `${year} so far`
}

// The first year with anything in it, so a station's table starts when it did
export function firstYear(values: number[]): number {
  const i = values.findIndex((v) => Math.abs(v) >= 0.05)
  return i === -1 ? values.length : i
}

// A column of GWh a year, or of shares of something (fractions)
export interface Column {
  head: string
  values: number[]
  share?: boolean
}

// The years a table shows before its toggle for the rest
const RECENT_YEARS = 10

// A row a year from `from` to `to`, newest first. Past a dozen, the years
// before the latest ten wait behind a toggle.
export function yearlyTable(stats: Stats, columns: Column[], from = 0, to = stats.years.length - 1): string {
  const cells = columns.map((c) => (c.share ? c.values.map(shareCell) : figures(c.values.slice(from, to + 1))))
  const rows: string[][] = []
  for (let i = to; i >= from; i--) {
    // A year on one line, even on a phone
    const year = esc(yearLabel(stats, i)).replace(/ /g, '&nbsp;')
    rows.push([year, ...columns.map((c, j) => (c.share ? cells[j][i] : cells[j][i - from]))])
  }
  const head = ['Year', ...columns.map((c) => (c.share ? c.head : `${c.head} (GWh)`))]
  if (rows.length <= RECENT_YEARS + 2) return table(head, rows, 1)
  const earlier = rows.slice(RECENT_YEARS)
  return table(head, rows.slice(0, RECENT_YEARS), 1, {
    label: `Earlier years, ${stats.years[from]}–${stats.years[to - RECENT_YEARS]}`,
    rows: earlier,
  })
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// "July 2008", from "2008-07"
export function monthName(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

// A row a year, newest first, of each month's GWh, from the first month with
// any to the `to`th. A month before it or after it is blank. Past a dozen
// years, those before the latest ten wait behind a toggle, as yearlyTable's do.
export function monthlyTable(monthly: MonthlyStats, values: number[], to = values.length - 1): string {
  const from = firstYear(values)
  if (from > to) return ''
  const cells = figures(values.slice(from, to + 1))
  const years = new Map<string, string[]>()
  monthly.months.slice(from, to + 1).forEach((month, i) => {
    const row = years.get(month.slice(0, 4)) ?? MONTH_NAMES.map(() => '')
    row[Number(month.slice(5, 7)) - 1] = cells[i]
    years.set(month.slice(0, 4), row)
  })
  const rows = [...years].reverse().map(([year, row]) => [year, ...row])
  const head = ['Year', ...MONTH_NAMES.map((m) => m.slice(0, 3))]
  if (rows.length <= RECENT_YEARS + 2) return table(head, rows, 1)
  return table(head, rows.slice(0, RECENT_YEARS), 1, {
    label: `Earlier years, ${rows[rows.length - 1][0]}–${rows[RECENT_YEARS][0]}`,
    rows: rows.slice(RECENT_YEARS),
  })
}

// A series of figures a year that a chart's tooltips give beside its bars'
export interface TipSeries {
  name: string
  values: number[]
  format: (v: number) => string
}

// GWh a year as shares of the grid's generation, for a chart's tooltips
export function gridShare(ctx: Context, values: number[]): TipSeries {
  return {
    name: 'Share of grid',
    values: values.map((v, i) => (ctx.total[i] > 0 ? v / ctx.total[i] : 0)),
    format: shareText,
  }
}

// A bar a year from `from` to `to`, with a second series, if `marks`, across them, any
// `more` in their tooltips, and a key to what's what when there's more than one
// kind of bar or mark
export function yearlyChart(
  stats: Stats,
  values: number[],
  from: number,
  opts: ChartOptions & { marks?: number[]; more?: TipSeries[]; to?: number },
): string {
  const { marks, more = [], to = stats.years.length - 1, ...chart } = opts
  const svg = barChart(
    stats.years.slice(from, to + 1).map((year, j) => ({
      label: String(year),
      value: values[from + j],
      partial: stats.partial.has(year),
      title: yearLabel(stats, from + j),
      mark: marks?.[from + j],
      more: more.map((m): [string, string] => [m.name, m.format(m.values[from + j])]),
    })),
    chart,
  )
  const partial = stats.years.map((_, i) => i).filter((i) => i >= from && i <= to && stats.partial.has(stats.years[i]))
  const swatch = (style: string, cls = '') => `<span class="prerender__swatch${cls}" style="${esc(style)}"></span>`
  const items = [
    marks ? `${swatch(`background:${opts.colour}`)}${esc(opts.name)}` : '',
    marks ? `${swatch('', ' prerender__swatch--mark')}${esc(opts.markName ?? '')}` : '',
    partial.length
      ? `${swatch(`background:${opts.colour};opacity:0.45`)}Part ${partial.length > 1 ? 'years' : 'year'}: ${esc(list(partial.map((i) => yearLabel(stats, i))))}`
      : '',
  ].filter(Boolean)
  return `${svg}${items.length ? `<p class="prerender__key">${items.map((item) => `<span>${item}</span>`).join('')}</p>` : ''}`
}
