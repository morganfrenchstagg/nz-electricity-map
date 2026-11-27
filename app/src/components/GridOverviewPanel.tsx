import { useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { HighchartsReact } from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { isAggregateMode, isLiveMode, periodOf } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { aggregatePeriodOf, useAggregates } from '../hooks/useAggregates'
import {
  chartKind,
  useDistributedSolar,
  useDistributedSolarEnergy,
  useShownWithSolar,
} from '../hooks/useDistributedSolar'
import type { RecentData, SelectedNode, Unit } from '../types'
import { inServiceAt, inServiceDuring, isCommissioning } from '../utils/generators'
import { useDefinitions } from '../hooks/useDefinitions'
import {
  fuelCodeColour,
  fuelCodeLabel,
  CHARGING_FUEL_CODE,
  DISTRIBUTED_SOLAR_FUEL_CODE,
  FOSSIL_FUEL_CODE,
  FOSSIL_FUEL_CODES,
  FUEL_CODE_ORDER,
  HVDC_EXPORT_CODE,
  HVDC_IMPORT_CODE,
  RENEWABLE_FUEL_CODES,
} from '../utils/colours'
import { hvdcEnergyInto, hvdcInto } from '../utils/hvdc'
import {
  distributedSolarAt,
  distributedSolarCapacities,
  distributedSolarEnergy,
  solarSoFar,
} from '../utils/distributedSolar'
import {
  CHART_CONTAINER_PROPS,
  DATETIME_LABEL_FORMATS,
  FIT_TO_CONTAINER,
  chartReach,
  columnFillEvents,
  dataInterval,
  midnightPlotLines,
  timeChartAccessibility,
  tooltipTime,
  withGaps,
} from '../utils/chart'
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
import { ChevronDown } from './icons'
import { ANALYSIS_PATH } from '../utils/stationPaths'

type Island = 'all' | 'NI' | 'SI'

// The HVDC is named for the island at its other end.
function fuelLabel(fuel: string, island: Island): string {
  const otherIsland = island === 'SI' ? 'North Island' : 'South Island'
  if (fuel === HVDC_IMPORT_CODE) return `Imported from ${otherIsland}`
  if (fuel === HVDC_EXPORT_CODE) return `Exported to ${otherIsland}`
  return fuelCodeLabel(fuel)
}

// Combined solar puts embedded solar in grid-scale solar's series. The fossil
// series exists only when combined, and holds every fossil fuel present.
function fuelsOf(seriesFuel: string, fuels: string[], combineSolar: boolean): string[] {
  if (seriesFuel === FOSSIL_FUEL_CODE) return fuels.filter((f) => FOSSIL_FUEL_CODES.has(f))
  return combineSolar && seriesFuel === 'SOL' ? [DISTRIBUTED_SOLAR_FUEL_CODE, 'SOL'] : [seriesFuel]
}

const FUEL_ORDER: readonly string[] = FUEL_CODE_ORDER

const NodePickerModal = lazy(() => import('./NodePickerModal'))
const PipelineModal = lazy(() => import('./PipelineModal'))

// Fuels the tooltip groups under one heading when two or more are present.
// `parts` maps each series name to its label under the heading, in order.
// Battery isn't totalled: charging and discharging flow opposite ways.
const TOOLTIP_GROUPS: { label: string; colourFuel: string; totals: boolean; parts: [string, string][] }[] = [
  {
    label: 'Solar',
    colourFuel: 'SOL',
    totals: true,
    parts: [
      [fuelCodeLabel(DISTRIBUTED_SOLAR_FUEL_CODE), 'Embedded (estimate)'],
      [fuelCodeLabel('SOL'), 'Grid-scale'],
    ],
  },
  {
    label: 'Battery',
    colourFuel: 'BESS',
    totals: false,
    parts: [
      [fuelCodeLabel('BESS'), 'Discharging'],
      [fuelCodeLabel(CHARGING_FUEL_CODE), 'Charging'],
    ],
  },
]
// Added to TOOLTIP_GROUPS while the fossil fuels are combined
const FOSSIL_TOOLTIP_GROUP: (typeof TOOLTIP_GROUPS)[number] = {
  label: fuelCodeLabel(FOSSIL_FUEL_CODE),
  colourFuel: FOSSIL_FUEL_CODE,
  totals: true,
  parts: ['GAS', 'CLG', 'DIE'].map((fuel) => [fuelCodeLabel(fuel), fuelCodeLabel(fuel)]),
}

interface Props extends PanelProps {
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  onNodeSelect: (node: NonNullable<SelectedNode>) => void
  visible: boolean
  recentData: RecentData | null
  loading: boolean
  error: string | null
  // null means all fuels
  activeFuels: Set<string> | null
  onActiveFuelsChange: (fuels: Set<string> | null) => void
  chartSettings: ChartSettings
  onChartSettingsChange: (settings: ChartSettings) => void
  pipelineOpen: boolean
  onPipelineOpenChange: (open: boolean) => void
}

export default function GridOverviewPanel({
  dateMode,
  onDateModeChange,
  onNodeSelect,
  visible,
  recentData,
  loading,
  error,
  activeFuels,
  onActiveFuelsChange,
  chartSettings,
  onChartSettingsChange,
  pipelineOpen,
  onPipelineOpenChange,
  ...panel
}: Props) {
  const { generators, substations } = useDefinitions()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  const [island, setIsland] = useState<Island>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  // 90d, 1y, 5y and All chart MWh totals instead of 5-minute dispatch data.
  // Not fetched while the panel is hidden.
  const aggregatePeriod = aggregatePeriodOf(dateMode)
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates('all', isAggregateMode(dateMode) && visible ? dateMode : null)
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  // Shown together with its solar estimate rather than the estimate popping in
  // later, unless the estimate is slow (see useShownWithSolar)
  const solar = useDistributedSolar(dateMode, visible)
  const solarEnergy = useDistributedSolarEnergy(dateMode, visible)
  const { shown, waiting: waitingForSolar } = useShownWithSolar(
    {
      data: isAggregate ? aggregates.aggregateData : recentData,
      solarDays: solar.days,
      solarEnergy: solarEnergy.files,
    },
    JSON.stringify(dateMode),
    chartKind(dateMode),
    visible,
    !dataLoading,
    solar.loaded && solarEnergy.loaded,
  )
  const data = shown?.data ?? null
  const solarDays = shown?.solarDays
  const solarEnergyFiles = shown?.solarEnergy

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  // HVDC flow into and out of the shown island per row, with its limits: MW, or
  // MWh per period on aggregate views (where it can flow both ways in one period).
  // The 3d view only has em6's last day of it (see HvdcData).
  const hvdc = useMemo(() => {
    if (island === 'all' || !data?.hvdc) return null
    const times = data.data.map((row) => row[0] as string)
    return isAggregate
      ? hvdcEnergyInto(island, data.hvdc, times).map((energy) => energy && { ...energy, inLimit: 0, outLimit: 0 })
      : hvdcInto(island, data.hvdc, times).map(
          (t) => t && { in: Math.max(t.mw, 0), out: Math.max(-t.mw, 0), inLimit: t.inLimit, outLimit: t.outLimit },
        )
  }, [data, island, isAggregate])

  // Estimated undispatched solar on the shown island, charted as its own fuel: MW
  // per row, or MWh per period on aggregate views (today's estimate so far added
  // to the current period). Null per row with no estimate, or entirely if none has one.
  const distributedSolar = useMemo(() => {
    if (!data || !solarDays || !solarEnergyFiles || (isAggregate ? solarEnergyFiles : solarDays).length === 0)
      return null
    const islandOf = new Map(substations.map((s) => [s.siteId, s.island === 'north' ? 'NI' : 'SI']))
    const includeGxp = (gxp: string) => island === 'all' || islandOf.get(gxp) === island
    if (isAggregate) {
      const today = todayNZ()
      const energy = distributedSolarEnergy(
        solarEnergyFiles,
        includeGxp,
        today,
        solarSoFar(solarDays, today, nzNowMs(), includeGxp),
      )
      const values = data.data.map((row) => energy.get((row[0] as string).slice(0, 10))?.mwh ?? null)
      return values.some((v) => v !== null) ? { values, capacityByDate: new Map<string, number>() } : null
    }
    const values = distributedSolarAt(
      solarDays,
      data.data.map((row) => nzLocalMs(row[0] as string)),
      includeGxp,
    )
    return values.some((v) => v !== null)
      ? { values, capacityByDate: distributedSolarCapacities(solarDays, includeGxp) }
      : null
  }, [data, isAggregate, solarDays, solarEnergyFiles, substations, island])

  const { fuels, fuelToIndices, fuelToUnits } = useMemo(() => {
    if (!data || generators.length === 0)
      return { fuels: [], fuelToIndices: new Map<string, number[]>(), fuelToUnits: new Map<string, Unit[]>() }
    const period = periodOf(dateMode)
    const live = isLiveMode(dateMode)
    const fuelToIndices = new Map<string, number[]>()
    const fuelToUnits = new Map<string, Unit[]>()
    for (const gen of generators) {
      if (island !== 'all' && gen.island !== island) continue
      for (const unit of gen.units) {
        const inPeriod = inServiceDuring(unit, period)
        // Capacity counts units in service that didn't dispatch, which the data omits
        if (inPeriod) fuelToUnits.set(unit.fuelCode, [...(fuelToUnits.get(unit.fuelCode) ?? []), unit])
        // Live views also chart commissioning units once dispatching (not counted in
        // capacity); aggregate views include retired units' history
        if (!inPeriod && !(live && isCommissioning(unit, period.to)) && !isAggregate) continue
        const idx = data.series.indexOf(unit.node)
        if (idx === -1) continue
        const existing = fuelToIndices.get(unit.fuelCode) ?? []
        fuelToIndices.set(unit.fuelCode, [...existing, idx + 1])
      }
    }
    // Each HVDC direction with any flow
    const hvdcCodes = new Set<string>()
    if (hvdc?.some((t) => t && t.in > 0)) hvdcCodes.add(HVDC_IMPORT_CODE)
    if (hvdc?.some((t) => t && t.out > 0)) hvdcCodes.add(HVDC_EXPORT_CODE)
    const fuels = [
      ...FUEL_CODE_ORDER.filter(
        (f) => fuelToIndices.has(f) || hvdcCodes.has(f) || (f === DISTRIBUTED_SOLAR_FUEL_CODE && distributedSolar),
      ),
      ...[...fuelToIndices.keys()].filter((f) => !(FUEL_CODE_ORDER as readonly string[]).includes(f)),
    ]
    return { fuels, fuelToIndices, fuelToUnits }
  }, [data, generators, island, isAggregate, dateMode, hvdc, distributedSolar])

  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  // One series and button per entry. Combining merges embedded solar into
  // grid-scale solar, and the fossil fuels into one series (see fuelsOf).
  const combineSolar =
    chartSettings.solar === 'combined' && fuels.includes(DISTRIBUTED_SOLAR_FUEL_CODE) && fuels.includes('SOL')
  const combineFossil = chartSettings.fossil === 'combined' && fuels.some((f) => FOSSIL_FUEL_CODES.has(f))
  const seriesFuels = useMemo(() => {
    const series = fuels.filter(
      (f) => !(combineSolar && f === DISTRIBUTED_SOLAR_FUEL_CODE) && !(combineFossil && FOSSIL_FUEL_CODES.has(f)),
    )
    if (!combineFossil) return series
    // Before the first fuel later in FUEL_ORDER, or missing from it
    const order = (f: string) => FUEL_ORDER.indexOf(f)
    const at = series.findIndex((f) => order(f) === -1 || order(f) > order(FOSSIL_FUEL_CODE))
    return at === -1 ? [...series, FOSSIL_FUEL_CODE] : [...series.slice(0, at), FOSSIL_FUEL_CODE, ...series.slice(at)]
  }, [fuels, combineSolar, combineFossil])
  const isShown = useCallback(
    (fuel: string) => fuelsOf(fuel, fuels, combineSolar).some((f) => effectiveFuels.has(f)),
    [fuels, combineSolar, effectiveFuels],
  )

  // Shows or hides a series' fuels together
  function toggleFuel(fuel: string) {
    const show = !isShown(fuel)
    const next = new Set(effectiveFuels)
    for (const f of fuelsOf(fuel, fuels, combineSolar)) {
      if (show) next.add(f)
      else next.delete(f)
    }
    // Hiding the only fuel showing shows them all again
    onActiveFuelsChange(next.size === 0 || next.size === fuels.length ? null : next)
  }

  function isolateFuel(fuel: string) {
    const isolated = fuelsOf(fuel, fuels, combineSolar)
    onActiveFuelsChange(isolated.length === fuels.length ? null : new Set(isolated))
  }

  // Proportion stacks each fuel's share of total generation (as in the tooltip),
  // adding to 100%
  const { chartType } = chartSettings
  const stacked = chartType !== 'line'
  const proportion = chartType === 'proportion'

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!data || generators.length === 0 || fuels.length === 0 || effectiveFuels.size === 0) return null

    // Shown series, and each one's shown fuels
    const shownFuels = seriesFuels.filter(isShown)
    const shownFuelsOf = (fuel: string) => fuelsOf(fuel, fuels, combineSolar).filter((f) => effectiveFuels.has(f))
    // Stacked, missing solar estimates are charted as 0 (a null mid-stack draws
    // from 0) but left out of the tooltip. As a line it just breaks.
    const solarValues = distributedSolar?.values ?? []
    const noSolarEstimateMs = new Set(
      data.data.filter((_, r) => solarValues[r] === null).map((row) => nzLocalMs(row[0] as string)),
    )
    const hvdcPart = (fuel: string, r: number) => {
      const transfer = hvdc?.[r]
      return !transfer ? null : fuel === HVDC_IMPORT_CODE ? transfer.in : -transfer.out || 0 // 0, not -0
    }
    // The HVDC's total is its inflow, or outflow as a negative; null where there's none
    const fuelTotal = (fuel: string, r: number): number | null =>
      fuel === DISTRIBUTED_SOLAR_FUEL_CODE
        ? (solarValues[r] ?? (stacked ? 0 : null))
        : fuelToIndices.has(fuel)
          ? fuelToIndices.get(fuel)!.reduce((sum, i) => sum + ((data.data[r][i] as number) || 0), 0)
          : hvdcPart(fuel, r)
    // Per row, each shown series' total; null where all its shown fuels are null
    const fuelTotals = data.data.map((_, r) =>
      shownFuels.map((fuel) => {
        const totals = shownFuelsOf(fuel).map((f) => fuelTotal(f, r))
        return totals.every((t) => t === null) ? null : totals.reduce((sum: number, t) => sum + (t ?? 0), 0)
      }),
    )
    // Aggregate totals are MWh, charted in GWh unless the columns stay small
    const unit = isAggregate ? energyUnit(chartReach(fuelTotals, stacked)) : MW_UNIT
    // Live MW past 2 GW is labelled in GW on the axis to keep labels short. Data
    // and tooltip stay in MW, matching the capacities.
    const axisInGW = !isAggregate && !proportion && chartReach(fuelTotals, stacked) > 2000
    // Total generation per row, as in the tooltip: everything stacked above zero
    const generationTotals = fuelTotals.map((totals) =>
      totals.reduce((sum: number, total) => sum + Math.max(total ?? 0, 0), 0),
    )
    const shareOf = (total: number, r: number) => (generationTotals[r] > 0 ? (total / generationTotals[r]) * 100 : 0)

    // Stacked aggregates are columns, which stack negatives (battery charging)
    // separately. Areas don't, so fuels below zero get their own stack. Lines
    // chart every fuel from zero.
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
        stack:
          stacked && !isAggregate
            ? fuel === CHARGING_FUEL_CODE || fuel === HVDC_EXPORT_CODE
              ? 'positive'
              : 'negative'
            : undefined,
        fillOpacity: 0.8,
        lineWidth: stacked ? 1 : 2,
        // withGaps would read every step between aggregate totals as a gap
        data: columns
          ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
          : isAggregate
            ? points
            : withGaps(points),
        marker: { enabled: false },
        events: columns ? columnFillEvents(aggregatePeriod) : undefined,
        animation: false,
      }
    })

    // Row index per time, for the tooltip's fuel totals
    const rowByMs = new Map(data.data.map((row, r) => [nzLocalMs(row[0] as string), r]))

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

    // Otahuhu and Benmore are the NI and SI reference prices. Aggregates have no pricing.
    const otaIdx = data.series.findIndex((s) => s.startsWith('OTA'))
    const benIdx = data.series.findIndex((s) => s.startsWith('BEN'))
    const refPricingByMs = new Map<number, { ota: number | null; ben: number | null }>()
    for (const row of data.pricing ?? []) {
      const ms = nzLocalMs(row[0] as string)
      refPricingByMs.set(ms, {
        ota: otaIdx >= 0 ? ((row[otaIdx + 1] as number) ?? null) : null,
        ben: benIdx >= 0 ? ((row[benIdx + 1] as number) ?? null) : null,
      })
    }

    // Keyed by series name (fuelLabel), which is what the shared tooltip has per point
    const unitsByName = new Map<string, Unit[]>()
    for (const fuel of fuels) {
      unitsByName.set(fuelLabel(fuel, island), fuelToUnits.get(fuel) ?? [])
    }
    // Installed capacity (MSGC) of a fuel's units in service at a time. For the HVDC,
    // its transfer limit in that direction; for distributed solar, the installed
    // capacity behind that day's estimate.
    const hvdcByMs = new Map(hvdc ? data.data.map((row, r) => [nzLocalMs(row[0] as string), hvdc[r]]) : [])
    const capacityAt = (name: string, ms: number) => {
      if (name === fuelLabel(HVDC_IMPORT_CODE, island)) return hvdcByMs.get(ms)?.inLimit ?? 0
      if (name === fuelLabel(HVDC_EXPORT_CODE, island)) return hvdcByMs.get(ms)?.outLimit ?? 0
      if (name === fuelLabel(DISTRIBUTED_SOLAR_FUEL_CODE, island))
        return distributedSolar?.capacityByDate.get(new Date(ms).toISOString().slice(0, 10)) ?? 0
      return (unitsByName.get(name) ?? []).filter((u) => inServiceAt(u, ms)).reduce((sum, u) => sum + u.capacity, 0)
    }

    return {
      chart: {
        ...FIT_TO_CONTAINER,
        type: 'area',
        height: null,
        animation: false,
        backgroundColor: 'var(--color-surface)',
        className: columns ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      ...timeChartAccessibility(
        `${island === 'all' ? 'New Zealand' : island === 'NI' ? 'North Island' : 'South Island'} generation by fuel`,
        proportion
          ? "Each fuel's share of the total generation, stacked"
          : stacked
            ? 'Generation from each fuel, stacked'
            : 'Generation from each fuel',
        aggregatePeriod,
        proportion ? PERCENT_UNIT : unit,
        dataInterval(data.data.map((row) => row[0] as string)),
      ),
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
        plotLines: isAggregate ? [] : midnightPlotLines(data.data.map((row) => row[0] as string)),
      },
      yAxis: {
        title: { text: axisInGW ? 'GW' : (proportion ? PERCENT_UNIT : unit).label },
        // A tick per whole GW, not per half. The axis then stops at the lowest value
        // so battery charging doesn't stretch it to -1 GW.
        tickInterval: axisInGW ? 1000 : undefined,
        startOnTick: !axisInGW,
        // Updating in place keeps omitted options, so the formatter must be cleared
        // explicitly when the axis returns to MW
        labels: {
          formatter: axisInGW
            ? function () {
                return String((this.value as number) / 1000)
              }
            : undefined,
        },
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
          const x = this.x
          const time = tooltipTime(x, aggregatePeriod)
          const formatValue = unit.format
          // Generation per fuel comes from fuelTotal, not the point: proportion
          // points are shares, and a combined series' point sums its fuels.
          const r = rowByMs.get(x)
          const fuelPoints = points.flatMap((p) =>
            shownFuelsOf(shownFuels[p.series.index]).flatMap((fuel) => {
              const total = r === undefined ? null : fuelTotal(fuel, r)
              return total === null || (fuel === DISTRIBUTED_SOLAR_FUEL_CODE && noSolarEstimateMs.has(x))
                ? []
                : [{ name: fuelLabel(fuel, island), colour: fuelCodeColour(fuel), y: total / unit.size }]
            }),
          )
          // The total is what's stacked above zero: generation plus, for an island,
          // HVDC imports. Battery charging and HVDC exports are shown as shares of
          // it, so exports read as the part of generation sent away.
          const total = fuelPoints.reduce((sum, p) => sum + Math.max(p.y, 0), 0)

          // Group parts are indented and not bold, to set the heading apart
          const row = (label: string, colour: string, y: number, cap: number, indent = false) => {
            const bold = (text: string) => (indent ? text : `<b>${text}</b>`)
            const val = formatValue(y)
            const formatted = y === 0 ? val : bold(val)
            const ratioOfTotal = total > 0 ? y / total : 0
            const percentageStr =
              ratioOfTotal !== 0 ? bold(`${(ratioOfTotal * 100).toFixed(1)}%`) : total > 0 ? '0%' : '–'
            // No capacity comparison for aggregate totals
            const capCell = isAggregate
              ? ''
              : `<td style="color:var(--color-text-muted);padding-left:var(--space-lg)">${cap > 0 ? formatMW(cap) : '–'}</td>`
            const labelStyle = indent ? ' style="padding-left:var(--space-lg)"' : ''
            return `<tr><td${labelStyle}><span style="color:${colour}">●</span> ${label}</td><td> ${formatted}</td>${capCell}<td style="padding-left:var(--space-lg)">${percentageStr}</td></tr>`
          }

          // Groups with two or more points present, in parts order (see TOOLTIP_GROUPS)
          const groups = (combineFossil ? [...TOOLTIP_GROUPS, FOSSIL_TOOLTIP_GROUP] : TOOLTIP_GROUPS)
            .map((group) => ({
              group,
              points: group.parts.flatMap(([name, label]) => {
                const p = fuelPoints.find((p) => p.name === name)
                return p ? [{ p, label }] : []
              }),
            }))
            .filter(({ points }) => points.length > 1)
          const groupOf = (p: (typeof fuelPoints)[number]) =>
            groups.find(({ points }) => points.some((part) => part.p === p))
          // A group's rows replace its last point in series order, which puts
          // Battery at the bottom, where charging is.
          const rows = fuelPoints
            .map((p) => {
              const grouped = groupOf(p)
              if (!grouped) return row(p.name, p.colour, p.y, capacityAt(p.name, x))
              if (fuelPoints.filter((s) => groupOf(s) === grouped).pop() !== p) return ''
              const { group, points: parts } = grouped
              const colour = fuelCodeColour(group.colourFuel)
              const heading = group.totals
                ? row(
                    group.label,
                    colour,
                    parts.reduce((sum, { p }) => sum + p.y, 0),
                    parts.reduce((sum, { p }) => sum + capacityAt(p.name, x), 0),
                  )
                : `<tr><td><span style="color:${colour}">●</span> ${group.label}</td></tr>`
              return (
                heading + parts.map(({ p, label }) => row(label, p.colour, p.y, capacityAt(p.name, x), true)).join('')
              )
            })
            .join('')

          const prices = refPricingByMs.get(this.x)
          const priceParts = [
            prices?.ota != null ? `Ōtāhuhu price: <b>$${prices.ota.toFixed(2)}/MWh</b>` : null,
            prices?.ben != null ? `Benmore price: <b>$${prices.ben.toFixed(2)}/MWh</b>` : null,
          ].filter(Boolean)
          const priceRow = priceParts.length > 0 ? `<br/><br/><span>${priceParts.join('<br/>')}</span>` : ''
          const renewablePct = renewablePctByMs.get(this.x)
          const renewableRow =
            renewablePct != null ? `<br/><span>Renewable: <b>${Math.round(renewablePct)}%</b></span>` : ''
          const capHeader = isAggregate ? '' : '<th style="padding-left:var(--space-lg)">Capacity</th>'
          // One line per row, or long labels wrap the table on a narrow panel
          return `<table style="white-space:nowrap"><tr><th>${time}</th><th>Generation</th>${capHeader}<th>% of total gen</th></tr>${rows}</table><br/>Total: <b>${formatValue(total)}</b>${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [
    data,
    generators,
    fuels,
    seriesFuels,
    combineSolar,
    combineFossil,
    fuelToIndices,
    fuelToUnits,
    effectiveFuels,
    isShown,
    isAggregate,
    aggregatePeriod,
    island,
    hvdc,
    distributedSolar,
    stacked,
    proportion,
  ])

  // On the narrowest panels the title truncates to keep the picker's chevron in view
  const header = (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        NZ grid generation
      </span>
      <button
        onClick={() => setPickerOpen(true)}
        aria-label="Pick a generator or substation"
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--color-text-faint)',
          flexShrink: 0,
        }}
      >
        <ChevronDown size={12} />
      </button>
    </div>
  )

  return (
    <Panel
      {...panel}
      visible={visible}
      header={header}
      actions={[
        { label: 'Analysis', href: ANALYSIS_PATH },
        { label: 'Generation pipeline', onClick: () => onPipelineOpenChange(true) },
      ]}
    >
      <Suspense fallback={null}>
        {pickerOpen && (
          <NodePickerModal
            generators={generators}
            substations={substations}
            onSelect={(node) => {
              onNodeSelect(node)
              setPickerOpen(false)
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
        {pipelineOpen && <PipelineModal onClose={() => onPipelineOpenChange(false)} />}
      </Suspense>

      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <ToggleGroup
          compact={compactToolbar}
          ariaLabel="Island"
          options={(['all', 'NI', 'SI'] as const).map((opt) => ({
            key: opt,
            label: opt === 'all' ? 'All' : opt === 'NI' ? 'North Island' : 'South Island',
            menuLabel: opt === 'all' ? 'All islands' : undefined,
            active: island === opt,
            onClick: () => setIsland(opt),
          }))}
        />
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
          <ChartSettingsMenu
            settings={chartSettings}
            onChange={onChartSettingsChange}
            offered={['chartType', 'solar', 'fossil']}
          />
        </div>
      </PanelToolbar>

      {fuels.length > 0 && (
        <div className="section">
          <SeriesButtonRow
            items={seriesFuels.map((fuel) => (
              <SeriesButton
                key={fuel}
                colour={fuelCodeColour(fuel)}
                active={isShown(fuel)}
                onClick={() => toggleFuel(fuel)}
                onIsolate={() => isolateFuel(fuel)}
              >
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

      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        {(dataLoading || waitingForSolar) && !data && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 500,
              color: 'var(--color-text-muted)',
            }}
          >
            Loading…
          </div>
        )}
        {dataError && !data && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 500,
              color: 'var(--color-danger)',
            }}
          >
            Failed to load data
          </div>
        )}
        {chartOptions && (
          <HighchartsReact
            key={`${String(panel.expanded)}-${aggregatePeriod ?? 'live'}-${chartType}`}
            highcharts={Highcharts}
            options={chartOptions}
            containerProps={CHART_CONTAINER_PROPS}
          />
        )}
      </div>
    </Panel>
  )
}
