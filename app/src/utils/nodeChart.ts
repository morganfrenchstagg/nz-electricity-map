import type Highcharts from 'highcharts'
import type { RecentData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'
import { DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, fillMonthColumns, midnightPlotLines, withGaps } from './chart'
import type { ChartData } from './chart'
import { nzLocalMs } from './time'

const identity = (value: number) => value

interface NodeChartOptions {
  chartData: ChartData
  aggregatePeriod: AggregatePeriod | null
  // The codes the user has shown; the rest are charted hidden
  effectiveCodes: Set<string>
  // A generator's units are areas, which become columns for the aggregate
  // views' totals. A substation's buses and generators are lines.
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
  // The chart's name and description for screen readers (see timeChartAccessibility)
  accessibility: Pick<Highcharts.Options, 'lang' | 'accessibility'>
}

// The chart GeneratorPanel and SubstationPanel share: a series per code, and a
// line at each midnight of the dispatch data, around each panel's own axis,
// tooltip and extra series.
export function nodeChartOptions({ chartData, aggregatePeriod, effectiveCodes, type, stacking, labelFor, colourFor, transformValue = identity, extraSeries = [], legend = false, yAxis, tooltipFormatter, accessibility }: NodeChartOptions): Highcharts.Options {
  const isAggregate = aggregatePeriod !== null
  // Aggregate totals: stacked areas become stacked columns (which already stack
  // negative values separately, so no 'neg' stack), and lines get markers.
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
      // Highcharts rounds each column's edges to whole pixels separately, so a
      // boundary landing on a half pixel can round apart and leave a 1px gap.
      // A border in the column's own colour (see plotOptions.column) covers it.
      // Zero-height columns skip the border, or it would draw as a 1px line.
      borderColor: colour,
      visible: effectiveCodes.has(code),
      data: isAggregate
        ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
        : withGaps(points),
      stack: isAggregate ? undefined : chartData.rows.some((row) => (row[code] as number) < 0) ? 'neg' : 'pos',
      marker: { enabled: isAggregate && type === 'line', radius: 3 },
      // Not in Highcharts' types, but any function under `events` is
      // registered as a listener, and columns fire this after layout.
      events: aggregatePeriod === 'monthly'
        ? { afterColumnTranslate: fillMonthColumns } as Highcharts.SeriesEventsOptionsObject
        : undefined,
      animation: false,
    }
  })

  return {
    chart: {
      ...FIT_TO_CONTAINER,
      type, height: null, animation: false, backgroundColor: '#ffffff',
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

// Each charted code's price at each dispatch timestamp. Built once per chart
// rather than per tooltip, which fires on every mouse move. A node can have no
// price at some timestamps, so values may be null.
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
  // Name each row's series, when the tooltip lists more than one
  showName: boolean
}

// A point's row in a node chart's tooltip: its colour, its series' name, its
// value (and `after` it, e.g. a generator's capacity) and its node's price
export function tooltipRow(point: Highcharts.Point, { codes, prices, formatValue, showName }: TooltipRowContext, after = ''): string {
  const val = formatValue(point.y ?? 0)
  const formatted = (point.y ?? 0) === 0 ? val : `<b>${val}</b>`
  const code = codes[point.series.index]
  const price = code !== undefined && prices ? prices[code] : undefined
  const priceStr = price != null ? `$${price.toFixed(2)}/MWh` : ''
  return `<tr><td><span style="color:${String(point.color)}">●</span> ${showName ? point.series.name : ''}</td><td>${formatted}${after}</td><td>${priceStr}</td></tr>`
}

// The tooltip's last row, totalling its points when it lists more than one
export function tooltipTotalRow(total: number, formatValue: (value: number) => string, after = ''): string {
  return `<tr><td></td></tr><tr><td>Total: <b>${formatValue(total)}${after}</td></tr>`
}
