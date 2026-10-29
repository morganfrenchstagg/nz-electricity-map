import type Highcharts from 'highcharts'
import type { HvdcData } from '../types'
import { DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, midnightPlotLines, timeChartAccessibility, tooltipTime, withGaps } from './chart'
import { fuelCodeColour, HVDC_IMPORT_CODE } from './colours'
import { formatMW, MW_UNIT } from './format'
import { hvdcPoints } from './hvdc'
import type { HvdcPoint } from './hvdc'

// As GeneratorPanel's capacity line
const LIMIT_COLOUR = '#222222'
const HALF_HOUR_MS = 30 * 60 * 1000

// A limit's step line, each half hour's held until the next, labelled at its end
// as GeneratorPanel's capacity line is. The south limit's label goes `below` its
// line, away from the transfer above it.
function limitSeries(points: HvdcPoint[], name: string, limitOf: (point: HvdcPoint) => number | null, below = false): Highcharts.SeriesLineOptions {
  const data = points.map((point) => [point.ms, limitOf(point)] as [number, number | null])
  const lastMs = [...data].reverse().find(([, y]) => y !== null)?.[0]
  return {
    type: 'line',
    name,
    data: withGaps(data).map(([x, y]) => ({
      x,
      y,
      dataLabels: x === lastMs && y !== null ? {
        enabled: true,
        format: `${name}: ${formatMW(Math.abs(y))}`,
        align: 'right',
        verticalAlign: below ? 'top' : 'bottom',
        y: below ? 2 : -2,
        style: { color: LIMIT_COLOUR, fontSize: 'var(--font-size-2xs)', fontWeight: 'normal', textOutline: 'none' },
        crop: false,
        overflow: 'allow' as const,
        x: -4,
      } : { enabled: false },
    })),
    color: LIMIT_COLOUR,
    lineWidth: 1.5,
    step: 'left',
    marker: { enabled: false },
    animation: false,
    enableMouseTracking: false,
  }
}

// The HVDC's transfer over em6's half hours (see HvdcData): flowing north above
// zero and south below it, between step lines of its limits each way. Null when
// em6 has no flows.
export function hvdcChartOptions(hvdc: HvdcData): Highcharts.Options | null {
  const points = hvdcPoints(hvdc)
  if (points.length === 0) return null
  const byMs = new Map(points.map((point) => [point.ms, point]))
  const colour = fuelCodeColour(HVDC_IMPORT_CODE)

  return {
    chart: { ...FIT_TO_CONTAINER, type: 'area', height: null, animation: false, backgroundColor: '#ffffff' },
    title: { text: undefined },
    ...timeChartAccessibility(
      'HVDC transfer',
      'The HVDC\'s transfer between the islands, flowing north above zero and south below it, with its limit each way',
      null,
      MW_UNIT,
      HALF_HOUR_MS,
    ),
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      type: 'datetime',
      dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
      plotLines: midnightPlotLines(hvdc.data.map((row) => row[0] as string)),
    },
    yAxis: {
      title: { text: 'Transfer (MW)' },
      gridLineDashStyle: 'Dash',
      plotLines: [{ value: 0, color: '#999999', width: 1, zIndex: 3 }],
    },
    tooltip: {
      shared: true,
      useHTML: true,
      formatter: function () {
        const point = byMs.get(this.x as number)
        if (!point) return false
        const mw = Math.round(point.north)
        const transfer = mw === 0 ? 'No transfer' : `<b>${formatMW(Math.abs(mw))}</b> ${mw > 0 ? 'north' : 'south'}`
        const limit = (name: string, value: number | null) =>
          value === null ? '' : `<tr><td>${name}</td><td>${formatMW(Math.abs(value))}</td></tr>`
        return `<b>${tooltipTime(point.ms, null)}</b><br/><table>`
          + `<tr><td><span style="color:${colour}">●</span> Transfer</td><td>${transfer}</td></tr>`
          + limit('North limit', point.northLimit)
          + limit('South limit', point.southLimit)
          + '</table>'
      },
    },
    plotOptions: {
      area: { lineWidth: 1.5, fillOpacity: 0.8, threshold: 0 },
    },
    series: [
      {
        type: 'area',
        name: 'Transfer',
        color: colour,
        data: withGaps(points.map((point) => [point.ms, point.north])),
        marker: { enabled: false },
        animation: false,
      },
      limitSeries(points, 'North limit', (point) => point.northLimit),
      limitSeries(points, 'South limit', (point) => (point.southLimit === null ? null : -Math.abs(point.southLimit)), true),
    ],
  }
}
