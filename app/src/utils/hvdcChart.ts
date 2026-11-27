import type Highcharts from 'highcharts'
import type { HvdcData } from '../types'
import type { AggregatePeriod } from '../hooks/useAggregates'
import { chartReach, columnFillEvents, DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, midnightPlotLines, timeChartAccessibility, tooltipTime, withGaps } from './chart'
import { fuelCodeColour, HVDC_IMPORT_CODE } from './colours'
import { energyUnit, formatMW, MW_UNIT } from './format'
import { hvdcEnergies, hvdcPoints } from './hvdc'
import { nzLocalMs } from './time'
import type { HvdcPoint } from './hvdc'
import { alignPrior, priorDescription, priorLine, priorTooltip } from './compareChart'
import type { PriorPeriod } from './compare'

// As GeneratorPanel's capacity line
const LIMIT_COLOUR = 'var(--color-reference)'
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

// The HVDC over an earlier period a view's compared with (see utils/compare)
export interface HvdcPrior {
  hvdc: HvdcData
  period: PriorPeriod
}

// The HVDC's transfer over its half hours (see HvdcData): flowing north above
// zero and south below it, between step lines of its limits each way where em6
// has them. It spans `times`, the view's dispatch timestamps, so days without
// the HVDC are left blank rather than cut off. An earlier period it's compared
// with is a dotted transfer line. Null with no flows.
export function hvdcChartOptions(hvdc: HvdcData, times = hvdc.data.map((row) => row[0] as string), prior?: HvdcPrior): Highcharts.Options | null {
  const points = hvdcPoints(hvdc)
  if (points.length === 0) return null
  const byMs = new Map(points.map((point) => [point.ms, point]))
  const colour = fuelCodeColour(HVDC_IMPORT_CODE)
  const min = Math.min(nzLocalMs(times[0]), points[0].ms)
  const viewMax = Math.max(nzLocalMs(times[times.length - 1]), points[points.length - 1].ms)

  // The earlier period's transfer, charted on to the end of the view's last day
  const priorPoints = prior ? hvdcPoints(prior.hvdc) : []
  const aligned = prior ? alignPrior(priorPoints.map((point) => point.ms), prior.period, [min, viewMax], false) : null
  const priorXs = aligned ? aligned.xs.filter((_, i) => aligned.charted[i]) : []
  const max = Math.max(viewMax, ...priorXs)

  return {
    chart: { ...FIT_TO_CONTAINER, type: 'line', height: null, animation: false, backgroundColor: 'var(--color-surface)' },
    title: { text: undefined },
    ...timeChartAccessibility(
      'HVDC transfer',
      'The HVDC\'s transfer between the islands, flowing north above zero and south below it, with its limit each way'
        + priorDescription(prior && priorXs.length > 0 ? prior.period : null),
      null,
      MW_UNIT,
      HALF_HOUR_MS,
    ),
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      type: 'datetime',
      dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
      min,
      max,
      plotLines: midnightPlotLines(times),
    },
    yAxis: {
      title: { text: 'Transfer (MW)' },
      gridLineDashStyle: 'Dash',
      plotLines: [{ value: 0, color: 'var(--color-text-faint)', width: 1, zIndex: 3 }],
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
        // The earlier period's transfer at the same time, north positive as on the chart
        const p = aligned?.indexAt(point.ms)
        const earlier = p === undefined ? '' : priorTooltip(priorPoints[p].ms, [
          { name: 'Transfer (north +)', colour, before: priorPoints[p].north, now: point.north },
        ], formatMW, null)
        return `<b>${tooltipTime(point.ms, null)}</b><br/><table>`
          + `<tr><td><span style="color:${colour}">●</span> Transfer</td><td>${transfer}</td></tr>`
          + limit('North limit', point.northLimit)
          + limit('South limit', point.southLimit)
          + `</table>${earlier}`
      },
    },
    series: [
      ...(aligned && prior ? [priorLine({
        name: `Transfer, ${prior.period.label}`,
        colour,
        data: aligned.points(priorPoints.map((point) => point.north)),
        aggregate: false,
        lineWidth: 2,
      })] : []),
      {
        type: 'line',
        name: 'Transfer',
        color: colour,
        lineWidth: 2,
        data: withGaps(points.map((point) => [point.ms, point.north])),
        marker: { enabled: false },
        animation: false,
      },
      limitSeries(points, 'North limit', (point) => point.northLimit),
      limitSeries(points, 'South limit', (point) => (point.southLimit === null ? null : -Math.abs(point.southLimit)), true),
    ],
  }
}

// The MWh the HVDC sent each way in each of an aggregate view's periods (see
// HvdcData), as columns: north above zero and south below it, as it can have
// flowed both ways. An earlier period it's compared with is a dotted line each
// way. Null with no totals.
export function hvdcEnergyChartOptions(hvdc: HvdcData, period: AggregatePeriod, prior?: HvdcPrior): Highcharts.Options | null {
  const energies = hvdcEnergies(hvdc)
  if (energies.length === 0) return null
  const byMs = new Map(energies.map((energy) => [energy.ms, energy]))
  const colour = fuelCodeColour(HVDC_IMPORT_CODE)
  // In GWh unless the columns stay small
  const unit = energyUnit(chartReach(energies.map((energy) => [energy.north, -energy.south]), true))

  const priorEnergies = prior ? hvdcEnergies(prior.hvdc) : []
  const aligned = prior ? alignPrior(priorEnergies.map((energy) => energy.ms), prior.period, energies.map((energy) => energy.ms), true) : null
  const priorSeries = aligned && prior ? [
    priorLine({ name: `North, ${prior.period.label}`, colour: 'var(--color-reference)', data: aligned.points(priorEnergies.map((energy) => energy.north / unit.size)), aggregate: true, lineWidth: 2 }),
    priorLine({ name: `South, ${prior.period.label}`, colour: 'var(--color-reference)', data: aligned.points(priorEnergies.map((energy) => -energy.south / unit.size || 0)), aggregate: true, lineWidth: 2 }),
  ] : []

  const columns = (name: string, mwhOf: (energy: typeof energies[number]) => number): Highcharts.SeriesColumnOptions => ({
    type: 'column',
    name,
    color: colour,
    // Covers 1px rounding gaps between columns (see GridOverviewPanel)
    borderColor: colour,
    data: energies.map((energy) => {
      const y = mwhOf(energy) / unit.size
      return y === 0 ? { x: energy.ms, y, borderWidth: 0 } : [energy.ms, y]
    }),
    events: columnFillEvents(period),
    animation: false,
  })

  return {
    chart: {
      ...FIT_TO_CONTAINER,
      type: 'column', height: null, animation: false, backgroundColor: 'var(--color-surface)',
      className: 'aggregate-columns', // see index.css
    },
    title: { text: undefined },
    ...timeChartAccessibility(
      'HVDC transfer',
      'The energy the HVDC sent between the islands, north above zero and south below it'
        + priorDescription(priorSeries.length > 0 ? prior?.period ?? null : null),
      period,
      unit,
    ),
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: { type: 'datetime', dateTimeLabelFormats: DATETIME_LABEL_FORMATS },
    yAxis: {
      title: { text: `Transfer (${unit.label})` },
      gridLineDashStyle: 'Dash',
      plotLines: [{ value: 0, color: 'var(--color-text-faint)', width: 1, zIndex: 3 }],
    },
    plotOptions: {
      column: { borderWidth: 1, borderRadius: 0, pointPadding: 0, groupPadding: 0, stacking: 'normal' },
    },
    tooltip: {
      shared: true,
      useHTML: true,
      formatter: function () {
        const energy = byMs.get(this.x as number)
        if (!energy) return false
        const row = (name: string, mwh: number) => {
          const value = unit.format(mwh / unit.size)
          return `<tr><td><span style="color:${colour}">●</span> ${name}</td><td>${mwh === 0 ? value : `<b>${value}</b>`}</td></tr>`
        }
        // The earlier period's totals each way, and how they've changed
        const p = aligned?.indexAt(energy.ms)
        const before = p === undefined ? null : priorEnergies[p]
        const earlier = !before ? '' : priorTooltip(before.ms, [
          { name: 'North', colour, before: before.north / unit.size, now: energy.north / unit.size },
          { name: 'South', colour, before: before.south / unit.size, now: energy.south / unit.size },
        ], unit.format, period)
        return `<b>${tooltipTime(energy.ms, period)}</b><br/><table>${row('North', energy.north)}${row('South', energy.south)}</table>${earlier}`
      },
    },
    series: [columns('North', (energy) => energy.north), columns('South', (energy) => -energy.south || 0), ...priorSeries], // 0, not -0
  }
}
