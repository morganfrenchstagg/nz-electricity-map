import Highcharts from 'highcharts'
import type { RecentData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'

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

// Bus codes are the site, the voltage in kV (3 digits) and a bus number or
// letter, e.g. OTA1103 is Ōtāhuhu's 110kV bus 3. The bus is only named when
// siteCodes has another bus at the same voltage to tell it apart from.
export function busLabel(code: string, siteCodes: string[]): string {
  const kv = parseInt(code.slice(-4, -1), 10)
  if (isNaN(kv)) return code
  const sameVoltage = code.slice(0, -1)
  const shared = siteCodes.some((c) => c !== code && !c.includes(' ') && c.slice(0, -1) === sameVoltage)
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

// HighchartsReact calls chart.update() whenever containerProps changes, so an
// inline object would redraw the chart on every render. Share one instead.
export const CHART_CONTAINER_PROPS = { style: { height: '100%' } }

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
// the same midpoint, so they always share an edge.
export function fillMonthColumns(this: Highcharts.Series) {
  const edge = (ms: number) => Math.round(this.xAxis.toPixels(ms, true))
  for (const point of this.points) {
    if (!point.shapeArgs) continue
    const month = new Date(point.x)
    const prev = Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)
    const next = Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)
    const left = edge((prev + point.x) / 2)
    const right = edge((point.x + next) / 2)
    point.shapeArgs = { ...point.shapeArgs, x: left, width: right - left }
  }
}
