import Highcharts from 'highcharts'
import type { RecentData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'
import type { DisplayUnit } from './format'
import { nzLocalMs } from './time'

export interface ChartRow {
  time: string
  [code: string]: string | number
}

export interface ChartData {
  rows: ChartRow[]
  codes: string[]
}

export function extractChartData(recent: RecentData, requestedCodes: string[]): ChartData {
  const codes = requestedCodes.filter((c) => recent.series.includes(c))
  const indices = codes.map((c) => recent.series.indexOf(c) + 1) // +1: col 0 is timestamp

  const rows: ChartRow[] = recent.data.map((row) => {
    const point: ChartRow = { time: row[0] as string }
    codes.forEach((code, i) => {
      point[code] = row[indices[i]] as number
    })
    return point
  })

  return { rows, codes }
}

export function substationCodes(recent: RecentData, siteId: string): string[] {
  return recent.series.filter((s) => s.startsWith(siteId))
}

// A generator's code is the bus it's connected to, a space and the unit, e.g.
// ATI2201 ATI0. A substation's codes are its buses' and its generators'.
export function isGeneratorCode(code: string): boolean {
  return code.includes(' ')
}

// The unit of a generator's code, e.g. ATI0 of ATI2201 ATI0
export function unitOfCode(code: string): string {
  return code.split(' ')[1]
}

// Bus codes are the site, the voltage in kV (3 digits) and a bus number or
// letter, e.g. OTA1103 is Ōtāhuhu's 110kV bus 3. The bus is only named when
// siteCodes has another bus at the same voltage to tell it apart from.
export function busLabel(code: string, siteCodes: string[]): string {
  const kv = parseInt(code.slice(-4, -1), 10)
  if (isNaN(kv)) return code
  const sameVoltage = code.slice(0, -1)
  const shared = siteCodes.some((c) => c !== code && !isGeneratorCode(c) && c.slice(0, -1) === sameVoltage)
  return shared ? `${kv}kV – ${code.slice(-1)}` : `${kv}kV`
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
// Dispatch data has a point every 5 minutes, but days before 11 September 2020
// are metered generation, with a point every half-hour trading period
const DISPATCH_INTERVAL_MS = 5 * MINUTE_MS
const TRADING_PERIOD_MS = 30 * MINUTE_MS
// A step of more than this many of the data's intervals is a gap in it: over
// 20 minutes of dispatch data, or 2 hours of trading periods
const GAP_INTERVALS = 4

// How often each day of `times` has a point: its shortest step between points,
// which missing points don't lengthen. Keyed by the day (days since 1970, in
// the "local time as UTC" convention), so half-hourly and 5-minute days in the
// same range each keep their own.
function intervalsByDay(times: number[]): Map<number, number> {
  const intervals = new Map<number, number>()
  for (let i = 1; i < times.length; i++) {
    const day = Math.floor(times[i] / DAY_MS)
    const step = times[i] - times[i - 1]
    if (step > 0 && Math.floor(times[i - 1] / DAY_MS) === day) {
      intervals.set(day, Math.min(step, intervals.get(day) ?? Infinity))
    }
  }
  return intervals
}

// How often a run of dispatch timestamps has a point: the shortest of its days'
// intervals, or 5 minutes when no day has two points to tell by
export function dataInterval(times: string[]): number {
  const intervals = [...intervalsByDay(times.map(nzLocalMs)).values()]
  return intervals.length > 0 ? Math.min(...intervals) : DISPATCH_INTERVAL_MS
}

// Whether the step to each of `times` from the one before it is a gap in the
// data: more than GAP_INTERVALS of the longer interval of the days either side,
// so a range running from half-hourly days into 5-minute ones isn't broken
// where it changes over
function gapsBefore(times: number[]): boolean[] {
  const intervals = intervalsByDay(times)
  const intervalOn = (ms: number) => intervals.get(Math.floor(ms / DAY_MS)) ?? 0
  return times.map((ms, i) => {
    if (i === 0) return false
    const interval = Math.max(intervalOn(times[i - 1]), intervalOn(ms)) || DISPATCH_INTERVAL_MS
    return ms - times[i - 1] > GAP_INTERVALS * interval
  })
}

// Breaks a line at each gap in its data (see gapsBefore), with a null just
// after the point before the gap
export function withGaps(points: [number, number | null][]): [number, number | null][] {
  const gaps = gapsBefore(points.map(([ms]) => ms))
  const result: [number, number | null][] = []
  points.forEach((point, i) => {
    if (gaps[i]) result.push([points[i - 1][0] + 1, null])
    result.push(point)
  })
  return result
}

// The MWh `codes` generated over `rows`. Dispatch rows are MW, integrated over
// time with the trapezoidal rule. Gaps that withGaps breaks the line at are
// skipped rather than bridged, so missing data doesn't inflate the total.
// Aggregate rows are already MWh, so those are just summed. Null when there's
// nothing to total.
export function totalMWh(rows: ChartRow[], codes: string[], aggregate: boolean): number | null {
  if (codes.length === 0 || rows.length < (aggregate ? 1 : 2)) return null
  const rowTotal = (row: ChartRow) => codes.reduce((sum, code) => sum + ((row[code] as number) ?? 0), 0)
  if (aggregate) return rows.reduce((total, row) => total + rowTotal(row), 0)
  const times = rows.map((row) => nzLocalMs(row.time))
  const gaps = gapsBefore(times)
  let total = 0
  for (let i = 1; i < rows.length; i++) {
    const dtMs = times[i] - times[i - 1]
    if (dtMs <= 0 || gaps[i]) continue
    total += ((rowTotal(rows[i - 1]) + rowTotal(rows[i])) / 2) * (dtMs / HOUR_MS)
  }
  return total
}

// How far a chart's values reach from zero, given a row of the series' values
// at each time. Stacked, that's the largest total at any one time, with
// positive and negative values stacking apart as Highcharts stacks them.
// Otherwise it's the largest single value.
export function chartReach(rows: number[][], stacked: boolean): number {
  let reach = 0
  for (const row of rows) {
    let up = 0
    let down = 0
    for (const value of row) {
      if (!stacked) reach = Math.max(reach, Math.abs(value || 0))
      else if (value > 0) up += value
      else if (value < 0) down -= value
    }
    reach = Math.max(reach, up, down)
  }
  return reach
}

// Highcharts 13's types only allow the object form of each format, but plain
// strings still work. The object form would also merge in the default
// day.boundary format, relabelling midnight on hourly axes with the date.
export const DATETIME_LABEL_FORMATS = {
  day: '%e %b', hour: '%I:%M %p', minute: '%I:%M %p',
} as Highcharts.AxisDateTimeLabelFormatsOptions

// A line, labelled with the date, at each midnight in a run of dispatch timestamps
export function midnightPlotLines(times: string[]): Highcharts.XAxisPlotLinesOptions[] {
  return times
    .filter((time, i) => i > 0 && time.slice(0, 10) !== times[i - 1].slice(0, 10))
    .map((time) => ({
      value: nzLocalMs(time),
      color: '#aaaaaa',
      width: 1,
      dashStyle: 'Solid',
      label: {
        text: Highcharts.dateFormat('%e %b', nzLocalMs(time)),
        style: { color: '#888888', fontSize: 'var(--font-size-2xs)' },
        y: 14,
      },
      zIndex: 3,
    }))
}

// HighchartsReact calls chart.update() whenever containerProps changes, so an
// inline object would redraw the chart on every render. Share one instead.
export const CHART_CONTAINER_PROPS = { style: { height: '100%' } }

// Highcharts resizes a chart to fit its container 100ms after the container
// resizes, so a chart drawn before its panel's layout settles (SeriesButtonRow
// putting buttons behind "+N more", a header going compact) is first painted
// at the old size. These chart options swap that for a ResizeObserver that
// resizes it as soon as its container does, before the browser paints.
export const FIT_TO_CONTAINER: Highcharts.ChartOptions = {
  reflow: false,
  events: {
    load() {
      const observer = new ResizeObserver(() => this.reflow())
      // The HighchartsReact div the chart was rendered to
      observer.observe(this.container.parentElement!)
      Highcharts.addEvent(this, 'destroy', () => observer.disconnect())
    },
  },
}

// Tooltip heading: a 5-minute timestamp, or the day, week, month, quarter or year a total covers.
export function tooltipTime(ms: number, period: AggregatePeriod | null): string {
  switch (period) {
    case 'daily': return Highcharts.dateFormat('%a %e %b', ms)
    case 'weekly': return `${Highcharts.dateFormat('%e %b', ms)} – ${Highcharts.dateFormat('%e %b %Y', ms + 6 * 86400000)}`
    case 'monthly': return Highcharts.dateFormat('%B %Y', ms)
    case 'quarterly': {
      const start = new Date(ms)
      const lastMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 1)
      return `${Highcharts.dateFormat('%b', ms)} – ${Highcharts.dateFormat('%b %Y', lastMonth)}`
    }
    case 'annual': return Highcharts.dateFormat('%Y', ms)
    default: return Highcharts.dateFormat('%e %b %I:%M %p', ms)
  }
}

// Screen reader options for a chart (Highcharts' accessibility module, loaded
// in main.tsx). The charts have no titles of their own, their panels' headers
// naming them instead, so without `title` every one would be read out as "Chart".
export function chartAccessibility(title: string, accessibility: Highcharts.AccessibilityOptions): Pick<Highcharts.Options, 'lang' | 'accessibility'> {
  return { lang: { accessibility: { defaultChartTitle: title } }, accessibility }
}

// How often a chart over time has a point: every 5 minutes or half hour of
// dispatch data (its `intervalMs`, see dataInterval), or the day, week, month,
// quarter or year each of an aggregate view's totals covers
function everyInterval(period: AggregatePeriod | null, intervalMs: number): string {
  switch (period) {
    case 'daily': return 'each day'
    case 'weekly': return 'each week'
    case 'monthly': return 'each month'
    case 'quarterly': return 'each quarter'
    case 'annual': return 'each year'
    default: return intervalMs >= TRADING_PERIOD_MS ? 'every half hour' : 'every 5 minutes'
  }
}

// Screen reader options for a chart over time whose values are in `unit`.
// `description` says what's charted, and is followed by the unit and how often.
// Each point is read out with the time its tooltip is headed with, rather than
// Highcharts' own US-style date, and its value in the unit.
export function timeChartAccessibility(title: string, description: string, period: AggregatePeriod | null, unit: DisplayUnit, intervalMs = DISPATCH_INTERVAL_MS): Pick<Highcharts.Options, 'lang' | 'accessibility'> {
  return chartAccessibility(title, {
    description: `${description}, in ${unit.label} ${everyInterval(period, intervalMs)}.`,
    // An aggregate view's points are all at midnight, so its range needs no time
    screenReaderSection: { axisRangeDateFormat: period ? '%e %b %Y' : '%e %b %Y %I:%M %p' },
    point: {
      descriptionFormatter: (point) => `${tooltipTime(point.x, period)}, ${unit.format(point.y ?? 0)}. ${point.series.name}.`,
    },
  })
}

// Months run 28–31 days, quarters 90–92 and years 365–366, but Highcharts
// gives every column the width of the shortest gap between points (February's,
// or a non-leap year's), leaving thin gaps after longer ones. Runs after Highcharts lays out
// the columns, and widens each one, `months` long, to meet its neighbours
// halfway between their start dates. Both neighbours round the same midpoint,
// so they always share an edge. Highcharts' types mark shapeArgs read-only,
// but replacing it here is what sizes the drawn column.
function fillColumns(series: Highcharts.Series, months: number) {
  const edge = (ms: number) => Math.round(series.xAxis.toPixels(ms, true))
  for (const point of series.points as { x: number; shapeArgs?: Highcharts.SVGAttributes }[]) {
    if (!point.shapeArgs) continue
    const start = new Date(point.x)
    const prev = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1)
    const next = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1)
    const left = edge((prev + point.x) / 2)
    const right = edge((point.x + next) / 2)
    point.shapeArgs = { ...point.shapeArgs, x: left, width: right - left }
  }
}

// The series events that size a monthly, quarterly or annual chart's columns
// (see fillColumns). Not in Highcharts' types, but any function under `events`
// is registered as a listener, and columns fire this after layout.
export function columnFillEvents(period: AggregatePeriod | null): Highcharts.SeriesEventsOptionsObject | undefined {
  const months = period === 'monthly' ? 1 : period === 'quarterly' ? 3 : period === 'annual' ? 12 : 0
  if (!months) return undefined
  return { afterColumnTranslate(this: Highcharts.Series) { fillColumns(this, months) } } as Highcharts.SeriesEventsOptionsObject
}
