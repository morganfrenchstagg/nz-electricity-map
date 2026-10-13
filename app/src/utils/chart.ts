import Highcharts from 'highcharts'
import type { RecentData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'
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

const GAP_MS = 20 * 60 * 1000

export function withGaps(points: [number, number | null][]): [number, number | null][] {
  const result: [number, number | null][] = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i][0] - points[i - 1][0] > GAP_MS) {
      result.push([points[i - 1][0] + 1, null])
    }
    result.push(points[i])
  }
  return result
}

const HOUR_MS = 60 * 60 * 1000

// The MWh `codes` generated over `rows`. Dispatch rows are MW, integrated over
// time with the trapezoidal rule. Gaps that withGaps breaks the line at are
// skipped rather than bridged, so missing data doesn't inflate the total.
// Aggregate rows are already MWh, so those are just summed. Null when there's
// nothing to total.
export function totalMWh(rows: ChartRow[], codes: string[], aggregate: boolean): number | null {
  if (codes.length === 0 || rows.length < (aggregate ? 1 : 2)) return null
  const rowTotal = (row: ChartRow) => codes.reduce((sum, code) => sum + ((row[code] as number) ?? 0), 0)
  if (aggregate) return rows.reduce((total, row) => total + rowTotal(row), 0)
  let total = 0
  for (let i = 1; i < rows.length; i++) {
    const dtMs = nzLocalMs(rows[i].time) - nzLocalMs(rows[i - 1].time)
    if (dtMs <= 0 || dtMs > GAP_MS) continue
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

// Tooltip heading: a 5-minute timestamp, or the day, week or month a total covers.
export function tooltipTime(ms: number, period: AggregatePeriod | null): string {
  switch (period) {
    case 'daily': return Highcharts.dateFormat('%a %e %b', ms)
    case 'weekly': return `${Highcharts.dateFormat('%e %b', ms)} – ${Highcharts.dateFormat('%e %b %Y', ms + 6 * 86400000)}`
    case 'monthly': return Highcharts.dateFormat('%B %Y', ms)
    default: return Highcharts.dateFormat('%e %b %I:%M %p', ms)
  }
}

// Months run 28–31 days, but Highcharts gives every column the width of the
// shortest gap between points (February's), leaving thin gaps after longer
// months. Runs after Highcharts lays out the columns, and widens each one to
// meet its neighbours halfway between their start dates. Both neighbours round
// the same midpoint, so they always share an edge. Highcharts' types mark
// shapeArgs read-only, but replacing it here is what sizes the drawn column.
export function fillMonthColumns(this: Highcharts.Series) {
  const edge = (ms: number) => Math.round(this.xAxis.toPixels(ms, true))
  for (const point of this.points as { x: number; shapeArgs?: Highcharts.SVGAttributes }[]) {
    if (!point.shapeArgs) continue
    const month = new Date(point.x)
    const prev = Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)
    const next = Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)
    const left = edge((prev + point.x) / 2)
    const right = edge((point.x + next) / 2)
    point.shapeArgs = { ...point.shapeArgs, x: left, width: right - left }
  }
}
