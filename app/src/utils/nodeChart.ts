import type Highcharts from 'highcharts'
import type { RecentData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'
import { DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, columnFillEvents, midnightPlotLines, withGaps } from './chart'
import type { ChartData } from './chart'
import { nzLocalMs } from './time'

const identity = (value: number) => value

interface NodeChartOptions {
  chartData: ChartData
  aggregatePeriod: AggregatePeriod | null
  // Shown codes; the rest are charted hidden
  effectiveCodes: Set<string>
  // A generator's units are areas (columns for aggregate totals); a substation's are lines
  type: 'area' | 'line'
  stacking?: Highcharts.OptionsStackingValue
  labelFor: (code: string) => string
  colourFor: (code: string) => string
  // Applied to every value, e.g. to chart a substation's load
  transformValue?: (value: number) => number
  // Charted after the codes' series
  extraSeries?: Highcharts.SeriesOptionsType[]
  legend?: boolean
  yAxis: Highcharts.YAxisOptions
  tooltipFormatter: Highcharts.TooltipFormatterCallbackFunction
  // Screen reader name and description (see timeChartAccessibility)
  accessibility: Pick<Highcharts.Options, 'lang' | 'accessibility'>
}

// Shared by GeneratorPanel and SubstationPanel, which supply their own axis, tooltip and extra series
export function nodeChartOptions({ chartData, aggregatePeriod, effectiveCodes, type, stacking, labelFor, colourFor, transformValue = identity, extraSeries = [], legend = false, yAxis, tooltipFormatter, accessibility }: NodeChartOptions): Highcharts.Options {
  const isAggregate = aggregatePeriod !== null
  // Aggregate totals: areas become columns, which stack negatives apart without a 'neg' stack
  const columns = isAggregate && type === 'area'

  const series: Highcharts.SeriesOptionsType[] = chartData.codes.map((code) => {
    const points: [number, number][] = chartData.rows.map((row) => [
      nzLocalMs(row.time),
      transformValue(row[code] as number),
    ])
    const colour = colourFor(code)
    return {
      type: columns ? 'column' : type,
      name: labelFor(code),
      color: colour,
      // Highcharts rounds each column's edges separately, which can leave 1px gaps. A border in
      // the column's colour covers them; zero-height columns skip it, or it draws as a line.
      borderColor: colour,
      visible: effectiveCodes.has(code),
      data: isAggregate
        ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
        : withGaps(points),
      stack: isAggregate ? undefined : chartData.rows.some((row) => (row[code] as number) < 0) ? 'neg' : 'pos',
      marker: { enabled: isAggregate && type === 'line', radius: 3 },
      events: columnFillEvents(aggregatePeriod),
      animation: false,
    }
  })

  return {
    chart: {
      ...FIT_TO_CONTAINER,
      type, height: null, animation: false, backgroundColor: 'var(--color-surface)',
      className: columns ? 'aggregate-columns' : undefined, // see index.css
    },
    title: { text: undefined },
    ...accessibility,
    credits: { enabled: false },
    legend: { enabled: legend, itemStyle: { fontWeight: 'normal' } },
    xAxis: {
      type: 'datetime',
      dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
      plotLines: isAggregate ? [] : midnightPlotLines(chartData.rows.map((row) => row.time)),
    },
    yAxis,
    tooltip: {
      shared: true,
      useHTML: true,
      formatter: tooltipFormatter,
    },
    plotOptions: {
      area: {
        lineWidth: 1.5,
        fillOpacity: 0.8,
        stacking,
      },
      column: {
        borderWidth: 1,
        borderRadius: 0,
        pointPadding: 0,
        groupPadding: 0,
        stacking,
      },
    },
    series: [...series, ...extraSeries],
  }
}

// Built once per chart, not per tooltip, which fires on every mouse move. Null where a node has no price.
export function pricesByTime(recentData: RecentData | null, codes: string[]): Map<number, Record<string, number | null>> {
  const prices = new Map<number, Record<string, number | null>>()
  if (!recentData?.pricing) return prices
  const indices = codes.map((c) => recentData.series.indexOf(c) + 1)
  for (const row of recentData.pricing) {
    const ms = nzLocalMs(row[0] as string)
    const entry: Record<string, number | null> = {}
    codes.forEach((code, i) => { entry[code] = row[indices[i]] as number | null })
    prices.set(ms, entry)
  }
  return prices
}

interface TooltipRowContext {
  // The charted codes, in series order
  codes: string[]
  // Each code's price at the tooltip's time
  prices: Record<string, number | null> | undefined
  formatValue: (value: number) => string
  // Set when the tooltip lists more than one series
  showName: boolean
  // When the value isn't the charted y, as a unit's generation charted as its share
  valueFor?: (point: Highcharts.Point) => number
}

// Colour, series name, value (then `after`, as a generator's capacity) and node price
export function tooltipRow(point: Highcharts.Point, { codes, prices, formatValue, showName, valueFor }: TooltipRowContext, after = ''): string {
  const value = valueFor ? valueFor(point) : point.y ?? 0
  const val = formatValue(value)
  const formatted = value === 0 ? val : `<b>${val}</b>`
  const code = codes[point.series.index]
  const price = code !== undefined && prices ? prices[code] : undefined
  const priceStr = price != null ? `$${price.toFixed(2)}/MWh` : ''
  return `<tr><td><span style="color:${String(point.color)}">●</span> ${showName ? point.series.name : ''}</td><td>${formatted}${after}</td><td>${priceStr}</td></tr>`
}

// The tooltip's last row, when it lists more than one point
export function tooltipTotalRow(total: number, formatValue: (value: number) => string, after = ''): string {
  return `<tr><td></td></tr><tr><td>Total: <b>${formatValue(total)}${after}</td></tr>`
}
