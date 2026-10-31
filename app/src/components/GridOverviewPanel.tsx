import { useState, useMemo, lazy, Suspense } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { isAggregateMode, isLiveMode, periodOf } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { aggregatePeriodOf, useAggregates } from '../hooks/useAggregates'
import { chartKind, useDistributedSolar, useDistributedSolarEnergy, useShownWithSolar } from '../hooks/useDistributedSolar'
import type { RecentData, SelectedNode, Unit } from '../types'
import { inServiceAt, inServiceDuring, isCommissioning } from '../utils/generators'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel, CHARGING_FUEL_CODE, DISTRIBUTED_SOLAR_FUEL_CODE, FUEL_CODE_ORDER, HVDC_EXPORT_CODE, HVDC_IMPORT_CODE, RENEWABLE_FUEL_CODES } from '../utils/colours'
import { hvdcInto } from '../utils/hvdc'
import { distributedSolarAt, distributedSolarCapacities, distributedSolarEnergy, solarSoFar } from '../utils/distributedSolar'
import { CHART_CONTAINER_PROPS, DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, chartReach, columnFillEvents, dataInterval, midnightPlotLines, timeChartAccessibility, tooltipTime, withGaps } from '../utils/chart'
import { energyUnit, formatMW, MW_UNIT, PERCENT_UNIT } from '../utils/format'
import type { ChartSettings } from '../utils/chartSettings'
import { nzLocalMs, nzNowMs, todayNZ } from '../utils/time'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { ToggleGroup } from './ToggleGroup'
import DateControls from './DateControls'
import ChartSettingsMenu from './ChartSettingsMenu'
import Panel, { PanelToolbar } from './Panel'
import type { PanelProps } from './Panel'

type Island = 'all' | 'NI' | 'SI'

// A fuel's name in the chart. The HVDC's is the island at its other end.
function fuelLabel(fuel: string, island: Island): string {
  const otherIsland = island === 'SI' ? 'North Island' : 'South Island'
  if (fuel === HVDC_IMPORT_CODE) return `Imported from ${otherIsland}`
  if (fuel === HVDC_EXPORT_CODE) return `Exported to ${otherIsland}`
  return fuelCodeLabel(fuel)
}

// The fuels a series charts. With the solar combined, grid-scale solar's has
// embedded solar's in it too.
function fuelsOf(seriesFuel: string, combineSolar: boolean): string[] {
  return combineSolar && seriesFuel === 'SOL' ? [DISTRIBUTED_SOLAR_FUEL_CODE, 'SOL'] : [seriesFuel]
}

const NodePickerModal = lazy(() => import('./NodePickerModal'))
const PipelineModal = lazy(() => import('./PipelineModal'))

// Fuels the tooltip lists under one heading when two or more of them are in
// it: the heading, its dot's fuel, whether it totals them, and what each
// fuel's series (keyed by its name) is called under it, in order. A battery's
// charging and discharging aren't totalled, as they're power going opposite ways.
const TOOLTIP_GROUPS: { label: string; colourFuel: string; totals: boolean; parts: [string, string][] }[] = [
  {
    label: 'Solar',
    colourFuel: 'SOL',
    totals: true,
    parts: [[fuelCodeLabel(DISTRIBUTED_SOLAR_FUEL_CODE), 'Embedded (estimate)'], [fuelCodeLabel('SOL'), 'Grid-scale']],
  },
  {
    label: 'Battery',
    colourFuel: 'BESS',
    totals: false,
    parts: [[fuelCodeLabel('BESS'), 'Discharging'], [fuelCodeLabel(CHARGING_FUEL_CODE), 'Charging']],
  },
]

interface Props extends PanelProps {
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  onNodeSelect: (node: NonNullable<SelectedNode>) => void
  visible: boolean
  recentData: RecentData | null
  loading: boolean
  error: string | null
  // The fuels charted, or null for all of them
  activeFuels: Set<string> | null
  onActiveFuelsChange: (fuels: Set<string> | null) => void
  chartSettings: ChartSettings
  onChartSettingsChange: (settings: ChartSettings) => void
  pipelineOpen: boolean
  onPipelineOpenChange: (open: boolean) => void
}

export default function GridOverviewPanel({ dateMode, onDateModeChange, onNodeSelect, visible, recentData, loading, error, activeFuels, onActiveFuelsChange, chartSettings, onChartSettingsChange, pipelineOpen, onPipelineOpenChange, ...panel }: Props) {
  const { generators, substations } = useDefinitions()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  const [island, setIsland] = useState<Island>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  // The 90d, 1y, 5y and All views chart every node's MWh totals instead of the
  // 5-minute dispatch data. Not fetched while the panel is hidden.
  const aggregatePeriod = aggregatePeriodOf(dateMode)
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates('all', isAggregateMode(dateMode) && visible ? dateMode : null)
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  // The data is charted with its distributed solar estimate, rather than the
  // estimate following it a moment later, unless it's slow (see useShownWithSolar)
  const solar = useDistributedSolar(dateMode, visible)
  const solarEnergy = useDistributedSolarEnergy(dateMode, visible)
  const { shown, waiting: waitingForSolar } = useShownWithSolar(
    { data: isAggregate ? aggregates.aggregateData : recentData, solarDays: solar.days, solarEnergy: solarEnergy.files },
    JSON.stringify(dateMode), chartKind(dateMode), visible, !dataLoading, solar.loaded && solarEnergy.loaded,
  )
  const data = shown?.data ?? null
  const solarDays = shown?.solarDays
  const solarEnergyFiles = shown?.solarEnergy

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  // The HVDC's transfer into the island shown, at each of the data's rows. Only
  // dispatch/recent has it, so not for past days or the aggregate views.
  const hvdc = useMemo(
    () => (island === 'all' || !data?.hvdc ? null : hvdcInto(island, data.hvdc, data.data.map(row => row[0] as string))),
    [data, island],
  )

  // The estimated output of solar that isn't dispatched on the island shown,
  // charted as a fuel of its own: its MW at each of the data's times, or on
  // the aggregate views its MWh in each period, with today's estimate so far
  // added to the period so far, null where there's no estimate. Null when the
  // estimate covers none of them.
  const distributedSolar = useMemo(() => {
    if (!data || !solarDays || !solarEnergyFiles || (isAggregate ? solarEnergyFiles : solarDays).length === 0) return null
    const islandOf = new Map(substations.map(s => [s.siteId, s.island === 'north' ? 'NI' : 'SI']))
    const includeGxp = (gxp: string) => island === 'all' || islandOf.get(gxp) === island
    if (isAggregate) {
      const today = todayNZ()
      const energy = distributedSolarEnergy(solarEnergyFiles, includeGxp, today, solarSoFar(solarDays, today, nzNowMs(), includeGxp))
      const values = data.data.map(row => energy.get((row[0] as string).slice(0, 10))?.mwh ?? null)
      return values.some(v => v !== null) ? { values, capacityByDate: new Map<string, number>() } : null
    }
    const values = distributedSolarAt(solarDays, data.data.map(row => nzLocalMs(row[0] as string)), includeGxp)
    return values.some(v => v !== null) ? { values, capacityByDate: distributedSolarCapacities(solarDays, includeGxp) } : null
  }, [data, isAggregate, solarDays, solarEnergyFiles, substations, island])

  const { fuels, fuelToIndices, fuelToUnits } = useMemo(() => {
    if (!data || generators.length === 0) return { fuels: [], fuelToIndices: new Map<string, number[]>(), fuelToUnits: new Map<string, Unit[]>() }
    const period = periodOf(dateMode)
    const live = isLiveMode(dateMode)
    const fuelToIndices = new Map<string, number[]>()
    const fuelToUnits = new Map<string, Unit[]>()
    for (const gen of generators) {
      if (island !== 'all' && gen.island !== island) continue
      for (const unit of gen.units) {
        const inPeriod = inServiceDuring(unit, period)
        // Capacity counts every unit in service, including those that didn't dispatch,
        // which the data leaves out
        if (inPeriod) fuelToUnits.set(unit.fuelCode, [...(fuelToUnits.get(unit.fuelCode) ?? []), unit])
        // The live views also chart units still being commissioned once they're dispatching,
        // though they don't count towards capacity, and the aggregate views include retired units' history
        if (!inPeriod && !(live && isCommissioning(unit, period.to)) && !isAggregate) continue
        const idx = data.series.indexOf(unit.node)
        if (idx === -1) continue
        const existing = fuelToIndices.get(unit.fuelCode) ?? []
        fuelToIndices.set(unit.fuelCode, [...existing, idx + 1])
      }
    }
    // Each way the HVDC flowed at some point
    const hvdcCodes = new Set<string>()
    if (hvdc?.some(t => t && t.mw > 0)) hvdcCodes.add(HVDC_IMPORT_CODE)
    if (hvdc?.some(t => t && t.mw < 0)) hvdcCodes.add(HVDC_EXPORT_CODE)
    const fuels = [
      ...FUEL_CODE_ORDER.filter(f => fuelToIndices.has(f) || hvdcCodes.has(f) || (f === DISTRIBUTED_SOLAR_FUEL_CODE && distributedSolar)),
      ...[...fuelToIndices.keys()].filter(f => !(FUEL_CODE_ORDER as readonly string[]).includes(f)),
    ]
    return { fuels, fuelToIndices, fuelToUnits }
  }, [data, generators, island, isAggregate, dateMode, hvdc, distributedSolar])

  // Memoised so the chart options below don't rebuild on every render
  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  // Each series' fuel, a button each. Combined, embedded solar is charted in
  // grid-scale solar's series where there's both (see fuelsOf).
  const combineSolar = chartSettings.solar === 'combined' && fuels.includes(DISTRIBUTED_SOLAR_FUEL_CODE) && fuels.includes('SOL')
  const seriesFuels = useMemo(() => fuels.filter(f => !(combineSolar && f === DISTRIBUTED_SOLAR_FUEL_CODE)), [fuels, combineSolar])
  const isShown = (fuel: string) => fuelsOf(fuel, combineSolar).some(f => effectiveFuels.has(f))

  // Shows or hides a series' fuels together
  function toggleFuel(fuel: string) {
    const show = !isShown(fuel)
    const next = new Set(effectiveFuels)
    for (const f of fuelsOf(fuel, combineSolar)) {
      if (show) next.add(f)
      else next.delete(f)
    }
    // Hiding the only fuel showing shows them all again
    onActiveFuelsChange(next.size === 0 || next.size === fuels.length ? null : next)
  }

  // Shows a series alone, hiding every other
  function isolateFuel(fuel: string) {
    const isolated = fuelsOf(fuel, combineSolar)
    onActiveFuelsChange(isolated.length === fuels.length ? null : new Set(isolated))
  }

  // Stacked, the fuels are charted as their totals or, as proportions, as their
  // shares of the total generation (the tooltip's), which add up to 100%
  const { chartType } = chartSettings
  const stacked = chartType !== 'line'
  const proportion = chartType === 'proportion'

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!data || generators.length === 0 || fuels.length === 0 || effectiveFuels.size === 0) return null

    // Each shown series' fuel, and the fuels it charts that are shown
    const shownFuels = seriesFuels.filter(isShown)
    const shownFuelsOf = (fuel: string) => fuelsOf(fuel, combineSolar).filter(f => effectiveFuels.has(f))
    // Stacked, distributed solar is charted at 0 where there's no estimate, as
    // nulls part way up a stack draw from 0 instead, but it's left out of the
    // tooltip there. Its line just breaks.
    const solarValues = distributedSolar?.values ?? []
    const noSolarEstimateMs = new Set(data.data.filter((_, r) => solarValues[r] === null).map(row => nzLocalMs(row[0] as string)))
    const hvdcPart = (fuel: string, r: number) => {
      const mw = hvdc?.[r]?.mw
      return mw === undefined ? null : fuel === HVDC_IMPORT_CODE ? Math.max(mw, 0) : Math.min(mw, 0)
    }
    // A fuel's total at a row of the data. The HVDC's is what flowed in, or out
    // (as a negative), and null where em6 has nothing.
    const fuelTotal = (fuel: string, r: number): number | null =>
      fuel === DISTRIBUTED_SOLAR_FUEL_CODE ? solarValues[r] ?? (stacked ? 0 : null)
        : fuelToIndices.has(fuel) ? fuelToIndices.get(fuel)!.reduce((sum, i) => sum + (((data.data[r][i] as number) || 0)), 0)
        : hvdcPart(fuel, r)
    // Each shown series' total at each time: its shown fuels', null where they're all null
    const fuelTotals = data.data.map((_, r) => shownFuels.map(fuel => {
      const totals = shownFuelsOf(fuel).map(f => fuelTotal(f, r))
      return totals.every(t => t === null) ? null : totals.reduce((sum: number, t) => sum + (t ?? 0), 0)
    }))
    // Aggregate totals are MWh, charted in GWh unless the columns stay small
    const unit = isAggregate ? energyUnit(chartReach(fuelTotals, stacked)) : MW_UNIT
    // The total generation at each time, as the tooltip gives it: what's stacked above zero
    const generationTotals = fuelTotals.map(totals => totals.reduce((sum: number, total) => sum + Math.max(total ?? 0, 0), 0))
    const shareOf = (total: number, r: number) => (generationTotals[r] > 0 ? (total / generationTotals[r]) * 100 : 0)

    // Aggregate totals: stacked areas become stacked columns, which already stack
    // negative values (battery charging) separately. Stacked areas don't, so
    // those below zero get a stack of their own. As lines, every fuel is charted
    // from zero, whichever the view.
    const columns = stacked && isAggregate
    const series: Highcharts.SeriesOptionsType[] = shownFuels.map((fuel, f) => {
      const points: [number, number | null][] = data.data.map((row, r) => {
        const total = fuelTotals[r][f]
        return [nzLocalMs(row[0] as string), total === null ? null : proportion ? shareOf(total, r) : total / unit.size]
      })
      const colour = fuelCodeColour(fuel)
      return {
        type: !stacked ? 'line' : columns ? 'column' : 'area',
        name: fuelLabel(fuel, island),
        color: colour,
        // Covers 1px rounding gaps between columns (see nodeChartOptions)
        borderColor: colour,
        stacking: stacked ? 'normal' : undefined,
        stack: stacked && !isAggregate ? (fuel === CHARGING_FUEL_CODE || fuel === HVDC_EXPORT_CODE) ? "positive" : "negative" : undefined,
        fillOpacity: 0.8,
        lineWidth: stacked ? 1 : 2,
        // withGaps would read every step between aggregate totals as a gap
        data: columns ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
          : isAggregate ? points
          : withGaps(points),
        marker: { enabled: false },
        events: columns ? columnFillEvents(aggregatePeriod) : undefined,
        animation: false,
      }
    })

    // Each time's row of the data, for the tooltip's fuel totals
    const rowByMs = new Map(data.data.map((row, r) => [nzLocalMs(row[0] as string), r]))

    // Build per-timestamp renewable percentage
    const renewableIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => RENEWABLE_FUEL_CODES.has(fuel))
      .flatMap(([, indices]) => indices)
    const dispatchIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => fuel !== CHARGING_FUEL_CODE)
      .flatMap(([, indices]) => indices)
    // Distributed solar counts towards both, as it's charted with the rest
    const renewablePctByMs = new Map<number, number>()
    data.data.forEach((row, r) => {
      const ms = nzLocalMs(row[0] as string)
      const distributed = solarValues[r] ?? 0
      const totalMW = dispatchIndices.reduce((s, i) => s + ((row[i] as number) || 0), distributed)
      const renewableMW = renewableIndices.reduce((s, i) => s + ((row[i] as number) || 0), distributed)
      renewablePctByMs.set(ms, totalMW > 0 ? (renewableMW / totalMW) * 100 : 0)
    })

    // Build per-timestamp pricing lookup for Otahuhu (NI reference) and Benmore (SI reference).
    // Aggregates have no pricing.
    const otaIdx = data.series.findIndex(s => s.startsWith('OTA'))
    const benIdx = data.series.findIndex(s => s.startsWith('BEN'))
    const refPricingByMs = new Map<number, { ota: number | null; ben: number | null }>()
    for (const row of (data.pricing ?? [])) {
      const ms = nzLocalMs(row[0] as string)
      refPricingByMs.set(ms, {
        ota: otaIdx >= 0 ? (row[otaIdx + 1] as number ?? null) : null,
        ben: benIdx >= 0 ? (row[benIdx + 1] as number ?? null) : null,
      })
    }

    // Each fuel's units, keyed by the series name shown in the tooltip (fuelLabel)
    // so the shared formatter can look them up per point
    const unitsByName = new Map<string, Unit[]>()
    for (const fuel of fuels) {
      unitsByName.set(fuelLabel(fuel, island), fuelToUnits.get(fuel) ?? [])
    }
    // A fuel's total installed capacity (MSGC) at a time: its units in service then.
    // The HVDC's is its transfer limit the way it's flowing. Distributed solar has
    // no units, so it's the installed capacity that day's estimate is from.
    const hvdcByMs = new Map(hvdc ? data.data.map((row, r) => [nzLocalMs(row[0] as string), hvdc[r]]) : [])
    const capacityAt = (name: string, ms: number) => {
      if (name === fuelLabel(HVDC_IMPORT_CODE, island)) return hvdcByMs.get(ms)?.inLimit ?? 0
      if (name === fuelLabel(HVDC_EXPORT_CODE, island)) return hvdcByMs.get(ms)?.outLimit ?? 0
      if (name === fuelLabel(DISTRIBUTED_SOLAR_FUEL_CODE, island)) return distributedSolar?.capacityByDate.get(new Date(ms).toISOString().slice(0, 10)) ?? 0
      return (unitsByName.get(name) ?? [])
        .filter(u => inServiceAt(u, ms))
        .reduce((sum, u) => sum + u.capacity, 0)
    }

    return {
      chart: {
        ...FIT_TO_CONTAINER,
        type: 'area', height: null, animation: false, backgroundColor: '#ffffff',
        className: columns ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      ...timeChartAccessibility(
        `${island === 'all' ? 'New Zealand' : island === 'NI' ? 'North Island' : 'South Island'} generation by fuel`,
        proportion ? "Each fuel's share of the total generation, stacked" : stacked ? 'Generation from each fuel, stacked' : 'Generation from each fuel',
        aggregatePeriod,
        proportion ? PERCENT_UNIT : unit,
        dataInterval(data.data.map(row => row[0] as string)),
      ),
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
        plotLines: isAggregate ? [] : midnightPlotLines(data.data.map(row => row[0] as string)),
      },
      yAxis: {
        title: { text: (proportion ? PERCENT_UNIT : unit).label },
        softMin: 0,
        // The shares' floating point sums can come out a hair over 100
        max: proportion ? 100 : undefined,
        gridLineDashStyle: 'Dash',
      },
      plotOptions: {
        area: {
          lineWidth: 1,
          stacking: 'normal',
          fillOpacity: 0.8,
        },
        column: {
          borderWidth: 1,
          borderRadius: 0,
          pointPadding: 0,
          groupPadding: 0,
          stacking: 'normal',
        },
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function () {
          const points = this.points ?? []
          const x = this.x as number
          const time = tooltipTime(x, aggregatePeriod)
          const formatValue = unit.format
          // Each fuel of each point's series, with its generation. That's looked
          // up from the fuel's total, as the proportion chart's points are shares
          // of the total, and a combined series' point is its fuels' added up.
          const r = rowByMs.get(x)
          const fuelPoints = points.flatMap(p => shownFuelsOf(shownFuels[p.series.index]).flatMap(fuel => {
            const total = r === undefined ? null : fuelTotal(fuel, r)
            return total === null || (fuel === DISTRIBUTED_SOLAR_FUEL_CODE && noSolarEstimateMs.has(x)) ? []
              : [{ name: fuelLabel(fuel, island), colour: fuelCodeColour(fuel), y: total / unit.size }]
          }))
          // The total is what's stacked above zero: the generation, and in an
          // island's views whatever the HVDC brings in. What's below it, a
          // battery charging or the HVDC taking power out, is a share of that
          // too, so the island's exports read as the part of its generation sent away.
          const total = fuelPoints.reduce((sum, p) => sum + Math.max(p.y, 0), 0)

          // A fuel's row: its generation, capacity and share of the total
          const row = (label: string, colour: string, y: number, cap: number, indent = false) => {
            const val = formatValue(y)
            const formatted = y === 0 ? val : `<b>${val}</b>`
            const ratioOfTotal = total > 0 ? y / total : 0
            const percentageStr = ratioOfTotal !== 0 ? `<b>${(ratioOfTotal * 100).toFixed(1)}%</b>` : total > 0 ? '0%' : '–'
            // No capacity comparison for aggregate totals
            const capCell = isAggregate ? '' : `<td style="color:var(--color-text-muted);padding-left:var(--space-lg)">${cap > 0 ? formatMW(cap) : '–'}</td>`
            const labelStyle = indent ? ' style="padding-left:var(--space-lg)"' : ''
            return `<tr><td${labelStyle}><span style="color:${colour}">●</span> ${label}</td><td> ${formatted}</td>${capCell}<td style="padding-left:var(--space-lg)">${percentageStr}</td></tr>`
          }

          // Each group's points, in its parts' order, where two or more are in the tooltip (see TOOLTIP_GROUPS)
          const groups = TOOLTIP_GROUPS
            .map(group => ({
              group,
              points: group.parts.flatMap(([name, label]) => {
                const p = fuelPoints.find(p => p.name === name)
                return p ? [{ p, label }] : []
              }),
            }))
            .filter(({ points }) => points.length > 1)
          const groupOf = (p: typeof fuelPoints[number]) => groups.find(({ points }) => points.some(part => part.p === p))
          // A group's heading and parts take the place of the last of its points
          // in the series' order. That puts Battery at the bottom, where charging is.
          const rows = fuelPoints
            .map(p => {
              const grouped = groupOf(p)
              if (!grouped) return row(p.name, p.colour, p.y, capacityAt(p.name, x))
              if (fuelPoints.filter(s => groupOf(s) === grouped).pop() !== p) return ''
              const { group, points: parts } = grouped
              const colour = fuelCodeColour(group.colourFuel)
              const heading = group.totals
                ? row(group.label, colour, parts.reduce((sum, { p }) => sum + p.y, 0), parts.reduce((sum, { p }) => sum + capacityAt(p.name, x), 0))
                : `<tr><td><span style="color:${colour}">●</span> ${group.label}</td></tr>`
              return heading + parts.map(({ p, label }) => row(label, p.colour, p.y, capacityAt(p.name, x), true)).join('')
            })
            .join('')

          const prices = refPricingByMs.get(this.x as number)
          const priceParts = [
            prices?.ota != null ? `Ōtāhuhu price: <b>$${(prices.ota as number).toFixed(2)}/MWh</b>` : null,
            prices?.ben != null ? `Benmore price: <b>$${(prices.ben as number).toFixed(2)}/MWh</b>` : null,
          ].filter(Boolean)
          const priceRow = priceParts.length > 0
            ? `<br/><br/><span>${priceParts.join('<br/>')}</span>`
            : ''
          const renewablePct = renewablePctByMs.get(this.x as number)
          const renewableRow = renewablePct != null
            ? `<br/><span>Renewable: <b>${Math.round(renewablePct)}%</b></span>`
            : ''
          const capHeader = isAggregate ? '' : '<th style="padding-left:var(--space-lg)">Capacity</th>'
          // Kept to one line a row, as the longer labels would otherwise wrap the table on a narrow panel
          return `<table style="white-space:nowrap"><tr><th>${time}</th><th>Generation</th>${capHeader}<th>% of total gen</th></tr>${rows}</table><br/>Total: <b>${formatValue(total)}</b>${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [data, generators, fuels, seriesFuels, combineSolar, fuelToIndices, fuelToUnits, effectiveFuels, isAggregate, aggregatePeriod, island, hvdc, distributedSolar, stacked, proportion])

  // On the narrowest panels the title is cut short to keep the picker's ▾ in view
  const header = (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>NZ Grid Generation</span>
      <button
        onClick={() => setPickerOpen(true)}
        style={{ fontWeight: 400, fontSize: 'var(--font-size-base)', border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-faint)', lineHeight: 1, flexShrink: 0 }}
      >
        ▾
      </button>
    </div>
  )

  return (
    <Panel {...panel} visible={visible} header={header} actions={[{ label: 'Generation Pipeline ↗', onClick: () => onPipelineOpenChange(true) }]}>
      <Suspense fallback={null}>
        {pickerOpen && (
          <NodePickerModal
            generators={generators}
            substations={substations}
            onSelect={(node) => { onNodeSelect(node); setPickerOpen(false) }}
            onClose={() => setPickerOpen(false)}
          />
        )}
        {pipelineOpen && <PipelineModal onClose={() => onPipelineOpenChange(false)} />}
      </Suspense>

      {/* Island + date picker toolbar */}
      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <ToggleGroup compact={compactToolbar} ariaLabel="Island" options={(['all', 'NI', 'SI'] as const).map(opt => ({
          key: opt,
          label: opt === 'all' ? 'All' : opt === 'NI' ? 'North Island' : 'South Island',
          menuLabel: opt === 'all' ? 'All islands' : undefined,
          active: island === opt,
          onClick: () => setIsland(opt),
        }))} />
        {!compactToolbar && <div className="divider" />}
        <DateControls
          dateMode={dateMode}
          picker={datePicker}
          compact={compactToolbar}
          lastUpdated={lastUpdated}
          loading={dataLoading || waitingForSolar}
          error={dataError}
          empty={!data}
        />
        {/* At the toolbar's end, under the header's Close */}
        <div style={{ display: 'flex', marginLeft: 'auto' }}>
          <ChartSettingsMenu settings={chartSettings} onChange={onChartSettingsChange} offered={['chartType', 'solar']} />
        </div>
      </PanelToolbar>

      {/* Fuel pills */}
      {fuels.length > 0 && (
        <div className="section">
          <SeriesButtonRow
            items={seriesFuels.map(fuel => (
              <SeriesButton key={fuel} colour={fuelCodeColour(fuel)} active={isShown(fuel)} onClick={() => toggleFuel(fuel)} onIsolate={() => isolateFuel(fuel)}>
                {fuelLabel(fuel, island)}
              </SeriesButton>
            ))}
            trail={[
              <ClearButton
                key="clear"
                cleared={activeFuels !== null && activeFuels.size === 0}
                onClick={() => onActiveFuelsChange(activeFuels !== null && activeFuels.size === 0 ? null : new Set())}
              />,
            ]}
          />
        </div>
      )}

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        {(dataLoading || waitingForSolar) && !data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: 'var(--color-text-muted)' }}>
            Loading…
          </div>
        )}
        {dataError && !data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: 'var(--color-danger)' }}>
            Failed to load data
          </div>
        )}
        {chartOptions && (
          <HighchartsReact key={`${String(panel.expanded)}-${aggregatePeriod ?? 'live'}-${chartType}`} highcharts={Highcharts} options={chartOptions} containerProps={CHART_CONTAINER_PROPS} />
        )}
      </div>
    </Panel>
  )
}
