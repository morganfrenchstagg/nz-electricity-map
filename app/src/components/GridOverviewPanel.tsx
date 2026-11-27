import { useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { HighchartsReact } from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { isAggregateMode, isLiveMode, periodOf } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { aggregatePeriodOf, useAggregates } from '../hooks/useAggregates'
import { chartKind, useDistributedSolar, useDistributedSolarEnergy, useShownWithSolar } from '../hooks/useDistributedSolar'
import type { Generator, RecentData, SelectedNode, Unit } from '../types'
import type { SolarEnergy, SolarProduction } from '../api'
import type { Period } from '../utils/time'
import type { Compare, PriorData } from '../utils/compare'
import { alignPrior, changeText, priorDescription, priorLine, priorTotalLines } from '../utils/compareChart'
import { CompareLegend } from './CompareMenu'
import { inServiceAt, inServiceDuring, isCommissioning } from '../utils/generators'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel, CHARGING_FUEL_CODE, DISTRIBUTED_SOLAR_FUEL_CODE, FOSSIL_FUEL_CODE, FOSSIL_FUEL_CODES, FUEL_CODE_ORDER, HVDC_EXPORT_CODE, HVDC_IMPORT_CODE, RENEWABLE_FUEL_CODES } from '../utils/colours'
import { hvdcEnergyInto, hvdcInto } from '../utils/hvdc'
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
import { ANALYSIS_PATH } from '../utils/stationPaths'

type Island = 'all' | 'NI' | 'SI'

// A fuel's name in the chart. The HVDC's is the island at its other end.
function fuelLabel(fuel: string, island: Island): string {
  const otherIsland = island === 'SI' ? 'North Island' : 'South Island'
  if (fuel === HVDC_IMPORT_CODE) return `Imported from ${otherIsland}`
  if (fuel === HVDC_EXPORT_CODE) return `Exported to ${otherIsland}`
  return fuelCodeLabel(fuel)
}

// The fuels a series charts, of those there are. With the solar combined,
// grid-scale solar's has embedded solar's in it too, and the fossil fuels'
// series, there only when they're combined, has each of them.
function fuelsOf(seriesFuel: string, fuels: string[], combineSolar: boolean): string[] {
  if (seriesFuel === FOSSIL_FUEL_CODE) return fuels.filter(f => FOSSIL_FUEL_CODES.has(f))
  return combineSolar && seriesFuel === 'SOL' ? [DISTRIBUTED_SOLAR_FUEL_CODE, 'SOL'] : [seriesFuel]
}

const FUEL_ORDER: readonly string[] = FUEL_CODE_ORDER

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
// Listed with them while the fossil fuels are charted as one series
const FOSSIL_TOOLTIP_GROUP: typeof TOOLTIP_GROUPS[number] = {
  label: fuelCodeLabel(FOSSIL_FUEL_CODE),
  colourFuel: FOSSIL_FUEL_CODE,
  totals: true,
  parts: ['GAS', 'CLG', 'DIE'].map(fuel => [fuelCodeLabel(fuel), fuelCodeLabel(fuel)]),
}

// What the HVDC brought into the island shown, and took out of it, at each of
// the data's rows, with its limits each way: MW at each time, or on the
// aggregate views MWh over each period, in which it can have flowed both ways.
// The 3d view only has em6's last day of it (see HvdcData). Null for all of NZ.
type HvdcRow = { in: number; out: number; inLimit: number; outLimit: number } | null

function hvdcRowsOf(data: RecentData | null, island: Island, isAggregate: boolean): HvdcRow[] | null {
  if (island === 'all' || !data?.hvdc) return null
  const times = data.data.map(row => row[0] as string)
  return isAggregate
    ? hvdcEnergyInto(island, data.hvdc, times).map(energy => energy && { ...energy, inLimit: 0, outLimit: 0 })
    : hvdcInto(island, data.hvdc, times).map(t => t && { in: Math.max(t.mw, 0), out: Math.max(-t.mw, 0), inLimit: t.inLimit, outLimit: t.outLimit })
}

// The estimated output of solar that isn't dispatched, at the GXPs kept,
// charted as a fuel of its own: its MW at each of the data's times, or on the
// aggregate views its MWh in each period, with today's estimate so far added
// to the period so far, null where there's no estimate. Null when the estimate
// covers none of them.
function distributedSolarOf(
  data: RecentData | null, solarDays: SolarProduction[] | undefined, solarEnergyFiles: SolarEnergy[] | undefined,
  includeGxp: (gxp: string) => boolean, isAggregate: boolean,
): { values: (number | null)[]; capacityByDate: Map<string, number> } | null {
  if (!data || !solarDays || !solarEnergyFiles || (isAggregate ? solarEnergyFiles : solarDays).length === 0) return null
  if (isAggregate) {
    const today = todayNZ()
    const energy = distributedSolarEnergy(solarEnergyFiles, includeGxp, today, solarSoFar(solarDays, today, nzNowMs(), includeGxp))
    const values = data.data.map(row => energy.get((row[0] as string).slice(0, 10))?.mwh ?? null)
    return values.some(v => v !== null) ? { values, capacityByDate: new Map<string, number>() } : null
  }
  const values = distributedSolarAt(solarDays, data.data.map(row => nzLocalMs(row[0] as string)), includeGxp)
  return values.some(v => v !== null) ? { values, capacityByDate: distributedSolarCapacities(solarDays, includeGxp) } : null
}

// Each fuel's columns in the data, of the units on the island shown. The live
// views also chart units still being commissioned once they're dispatching,
// though they don't count towards capacity, and the aggregate views include
// retired units' history.
function fuelIndicesOf(data: RecentData, generators: Generator[], island: Island, period: Period, live: boolean, isAggregate: boolean): Map<string, number[]> {
  const fuelToIndices = new Map<string, number[]>()
  for (const gen of generators) {
    if (island !== 'all' && gen.island !== island) continue
    for (const unit of gen.units) {
      if (!inServiceDuring(unit, period) && !(live && isCommissioning(unit, period.to)) && !isAggregate) continue
      const idx = data.series.indexOf(unit.node)
      if (idx === -1) continue
      fuelToIndices.set(unit.fuelCode, [...(fuelToIndices.get(unit.fuelCode) ?? []), idx + 1])
    }
  }
  return fuelToIndices
}

// A fuel's total at a row of the data. The HVDC's is what flowed in, or out
// (as a negative), and null where there's none. Stacked, distributed solar is
// charted at 0 where there's no estimate, as nulls part way up a stack draw
// from 0 instead. Its line just breaks.
function fuelTotalOf(data: RecentData, fuelToIndices: Map<string, number[]>, hvdc: HvdcRow[] | null, solarValues: (number | null)[], stacked: boolean) {
  const hvdcPart = (fuel: string, r: number) => {
    const transfer = hvdc?.[r]
    return !transfer ? null : fuel === HVDC_IMPORT_CODE ? transfer.in : -transfer.out || 0 // 0, not -0
  }
  return (fuel: string, r: number): number | null =>
    fuel === DISTRIBUTED_SOLAR_FUEL_CODE ? solarValues[r] ?? (stacked ? 0 : null)
      : fuelToIndices.has(fuel) ? fuelToIndices.get(fuel)!.reduce((sum, i) => sum + (((data.data[r][i] as number) || 0)), 0)
      : hvdcPart(fuel, r)
}

interface Props extends PanelProps {
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  // The earlier period the view is compared with, and its data (see utils/compare)
  compare: Compare | null
  onCompareChange: (compare: Compare | null) => void
  prior: PriorData | null
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

export default function GridOverviewPanel({ dateMode, onDateModeChange, compare, onCompareChange, prior, onNodeSelect, visible, recentData, loading, error, activeFuels, onActiveFuelsChange, chartSettings, onChartSettingsChange, pipelineOpen, onPipelineOpenChange, ...panel }: Props) {
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

  // The GXPs on the island shown, for its distributed solar estimate
  const includeGxp = useMemo(() => {
    const islandOf = new Map(substations.map(s => [s.siteId, s.island === 'north' ? 'NI' : 'SI']))
    return (gxp: string) => island === 'all' || islandOf.get(gxp) === island
  }, [substations, island])

  const hvdc = useMemo(() => hvdcRowsOf(data, island, isAggregate), [data, island, isAggregate])
  const distributedSolar = useMemo(
    () => distributedSolarOf(data, solarDays, solarEnergyFiles, includeGxp, isAggregate),
    [data, isAggregate, solarDays, solarEnergyFiles, includeGxp],
  )

  // The earlier period the view's compared with, charted once its data and its
  // distributed solar estimate have loaded: App's dispatch data for it, or every
  // node's totals that far back. Not fetched while the panel is hidden.
  const priorMode = prior?.period.mode ?? null
  const priorAggregateMode = priorMode && isAggregateMode(priorMode) && visible ? priorMode : null
  const priorDispatchMode = priorMode && !isAggregateMode(priorMode) ? priorMode : null
  const priorAggregates = useAggregates('all', priorAggregateMode, prior?.period.shift)
  const priorSolar = useDistributedSolar(priorDispatchMode ?? dateMode, visible && priorDispatchMode !== null)
  const priorSolarEnergy = useDistributedSolarEnergy(priorAggregateMode ?? dateMode, priorAggregateMode !== null, prior?.period.shift)
  const priorLoaded = priorSolar.loaded && priorSolarEnergy.loaded
  const priorData = !prior || !priorLoaded ? null : priorAggregateMode ? priorAggregates.aggregateData : prior.recentData
  const priorLoading = prior !== null && (priorAggregateMode ? priorAggregates.loading : prior.loading)
  const priorError = prior !== null && (priorAggregateMode ? priorAggregates.error : prior.error) !== null
  const priorFuels = useMemo(() => {
    if (!priorData || !priorMode || generators.length === 0) return null
    // The earlier period's own units, in service then
    const fuelToIndices = fuelIndicesOf(priorData, generators, island, periodOf(priorMode), false, isAggregate)
    const solar = distributedSolarOf(priorData, priorSolar.days, priorSolarEnergy.files, includeGxp, isAggregate)
    return { data: priorData, fuelToIndices, hvdc: hvdcRowsOf(priorData, island, isAggregate), solarValues: solar?.values ?? [] }
  }, [priorData, priorMode, generators, island, isAggregate, priorSolar.days, priorSolarEnergy.files, includeGxp])

  const { fuels, fuelToIndices, fuelToUnits } = useMemo(() => {
    if (!data || generators.length === 0) return { fuels: [], fuelToIndices: new Map<string, number[]>(), fuelToUnits: new Map<string, Unit[]>() }
    const period = periodOf(dateMode)
    const fuelToIndices = fuelIndicesOf(data, generators, island, period, isLiveMode(dateMode), isAggregate)
    // Capacity counts every unit in service, including those that didn't
    // dispatch, which the data leaves out
    const fuelToUnits = new Map<string, Unit[]>()
    for (const gen of generators) {
      if (island !== 'all' && gen.island !== island) continue
      for (const unit of gen.units) {
        if (inServiceDuring(unit, period)) fuelToUnits.set(unit.fuelCode, [...(fuelToUnits.get(unit.fuelCode) ?? []), unit])
      }
    }
    // Each way the HVDC flowed at some point
    const hvdcCodes = new Set<string>()
    if (hvdc?.some(t => t && t.in > 0)) hvdcCodes.add(HVDC_IMPORT_CODE)
    if (hvdc?.some(t => t && t.out > 0)) hvdcCodes.add(HVDC_EXPORT_CODE)
    const fuels = [
      ...FUEL_CODE_ORDER.filter(f => fuelToIndices.has(f) || hvdcCodes.has(f) || (f === DISTRIBUTED_SOLAR_FUEL_CODE && distributedSolar)),
      ...[...fuelToIndices.keys()].filter(f => !(FUEL_CODE_ORDER as readonly string[]).includes(f)),
    ]
    return { fuels, fuelToIndices, fuelToUnits }
  }, [data, generators, island, isAggregate, dateMode, hvdc, distributedSolar])

  // Memoised so the chart options below don't rebuild on every render
  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  // Each series' fuel, a button each. Combined, embedded solar is charted in
  // grid-scale solar's series where there's both, and the fossil fuels in one
  // series of their own (see fuelsOf).
  const combineSolar = chartSettings.solar === 'combined' && fuels.includes(DISTRIBUTED_SOLAR_FUEL_CODE) && fuels.includes('SOL')
  const combineFossil = chartSettings.fossil === 'combined' && fuels.some(f => FOSSIL_FUEL_CODES.has(f))
  const seriesFuels = useMemo(() => {
    const series = fuels.filter(f => !(combineSolar && f === DISTRIBUTED_SOLAR_FUEL_CODE) && !(combineFossil && FOSSIL_FUEL_CODES.has(f)))
    if (!combineFossil) return series
    // Before the first fuel after it in the order, or one that isn't in it
    const order = (f: string) => FUEL_ORDER.indexOf(f)
    const at = series.findIndex(f => order(f) === -1 || order(f) > order(FOSSIL_FUEL_CODE))
    return at === -1 ? [...series, FOSSIL_FUEL_CODE] : [...series.slice(0, at), FOSSIL_FUEL_CODE, ...series.slice(at)]
  }, [fuels, combineSolar, combineFossil])
  const isShown = useCallback(
    (fuel: string) => fuelsOf(fuel, fuels, combineSolar).some(f => effectiveFuels.has(f)),
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

  // Shows a series alone, hiding every other
  function isolateFuel(fuel: string) {
    const isolated = fuelsOf(fuel, fuels, combineSolar)
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
    const shownFuelsOf = (fuel: string) => fuelsOf(fuel, fuels, combineSolar).filter(f => effectiveFuels.has(f))
    // Distributed solar is left out of the tooltip where there's no estimate (see fuelTotalOf)
    const solarValues = distributedSolar?.values ?? []
    const noSolarEstimateMs = new Set(data.data.filter((_, r) => solarValues[r] === null).map(row => nzLocalMs(row[0] as string)))
    const fuelTotal = fuelTotalOf(data, fuelToIndices, hvdc, solarValues, stacked)
    // Each shown series' total at each time: its shown fuels', null where they're all null
    const seriesTotals = (total: typeof fuelTotal, rows: number) => Array.from({ length: rows }, (_, r) => shownFuels.map(fuel => {
      const totals = shownFuelsOf(fuel).map(f => total(f, r))
      return totals.every(t => t === null) ? null : totals.reduce((sum: number, t) => sum + (t ?? 0), 0)
    }))
    const fuelTotals = seriesTotals(fuelTotal, data.data.length)
    // The earlier period's, by its own rows, and its rows' times on the view's axis
    const priorFuelTotal = priorFuels && fuelTotalOf(priorFuels.data, priorFuels.fuelToIndices, priorFuels.hvdc, priorFuels.solarValues, stacked)
    const priorTotals = priorFuels && priorFuelTotal ? seriesTotals(priorFuelTotal, priorFuels.data.data.length) : null
    const priorMs = priorFuels?.data.data.map(row => nzLocalMs(row[0] as string)) ?? []
    const aligned = prior && priorTotals ? alignPrior(priorMs, prior.period, data.data.map(row => nzLocalMs(row[0] as string)), isAggregate) : null
    // Aggregate totals are MWh, charted in GWh unless the columns stay small
    const unit = isAggregate ? energyUnit(chartReach(fuelTotals, stacked)) : MW_UNIT
    // Live MW reaching past 2 GW is labelled on the axis in GW, which keeps its
    // numbers short. The data and the tooltip stay in MW, alongside the capacities.
    const axisInGW = !isAggregate && !proportion && chartReach(fuelTotals, stacked) > 2000
    // The total generation at each time, as the tooltip gives it: what's stacked above zero
    const generationOf = (totals: (number | null)[]) => totals.reduce((sum: number, total) => sum + Math.max(total ?? 0, 0), 0)
    const generationTotals = fuelTotals.map(generationOf)
    const priorGeneration = priorTotals?.map(generationOf) ?? []
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
        // Each fuel's own, so an update in place matches series by fuel rather
        // than by position, which the earlier period's dotted lines can take
        id: fuel,
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

    // The earlier period's dotted lines: stacked, its total generation of the
    // fuels shown, over the stack; as lines, each fuel's. Shares always add up
    // to 100%, so the proportion chart only has it in the tooltip.
    if (aligned && prior && priorTotals) {
      const label = prior.period.label
      if (stacked && !proportion) {
        series.push(...priorTotalLines({
          name: `Total, ${label}`,
          colour: 'var(--color-reference)',
          data: aligned.points(priorGeneration.map(total => total / unit.size)),
          aggregate: isAggregate,
        }))
      } else if (!stacked) {
        series.push(...shownFuels.map((fuel, f) => priorLine({
          name: `${fuelLabel(fuel, island)}, ${label}`,
          colour: fuelCodeColour(fuel),
          data: aligned.points(priorTotals.map(totals => totals[f] === null ? null : totals[f]! / unit.size)),
          aggregate: isAggregate,
        })))
      }
    }

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
        type: 'area', height: null, animation: false, backgroundColor: 'var(--color-surface)',
        className: columns ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      ...timeChartAccessibility(
        `${island === 'all' ? 'New Zealand' : island === 'NI' ? 'North Island' : 'South Island'} generation by fuel`,
        (proportion ? "Each fuel's share of the total generation, stacked" : stacked ? 'Generation from each fuel, stacked' : 'Generation from each fuel')
          + priorDescription(aligned && !proportion ? prior?.period ?? null : null),
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
        title: { text: axisInGW ? 'GW' : (proportion ? PERCENT_UNIT : unit).label },
        // A tick at each whole GW, rather than at each half. The axis then stops
        // at the lowest value, so a battery charging doesn't stretch it to -1 GW.
        tickInterval: axisInGW ? 1000 : undefined,
        startOnTick: !axisInGW,
        // The chart is updated in place, which keeps options that are left out,
        // so the formatter is cleared outright when the axis goes back to MW
        labels: { formatter: axisInGW ? function () { return String((this.value as number) / 1000) } : undefined },
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
          // The earlier period's row at the same time, whose values take the
          // capacity column's place
          const pr = aligned?.indexAt(x)
          const comparing = aligned !== null
          const beforeOf = (fuel: string) => {
            const before = pr === undefined || !priorFuelTotal ? null : priorFuelTotal(fuel, pr)
            return before === null ? null : before / unit.size
          }
          const fuelPoints = points.flatMap(p => shownFuelsOf(shownFuels[p.series.index]).flatMap(fuel => {
            const total = r === undefined ? null : fuelTotal(fuel, r)
            return total === null || (fuel === DISTRIBUTED_SOLAR_FUEL_CODE && noSolarEstimateMs.has(x)) ? []
              : [{ name: fuelLabel(fuel, island), colour: fuelCodeColour(fuel), y: total / unit.size, before: beforeOf(fuel) }]
          }))
          // The total is what's stacked above zero: the generation, and in an
          // island's views whatever the HVDC brings in. What's below it, a
          // battery charging or the HVDC taking power out, is a share of that
          // too, so the island's exports read as the part of its generation sent away.
          const total = fuelPoints.reduce((sum, p) => sum + Math.max(p.y, 0), 0)

          // A fuel's row: its generation, capacity and share of the total. A
          // group's parts are indented, and not bold, to set its heading apart.
          const row = (label: string, colour: string, y: number, cap: number, before: number | null, indent = false) => {
            const bold = (text: string) => (indent ? text : `<b>${text}</b>`)
            const val = formatValue(y)
            const formatted = y === 0 ? val : bold(val)
            const ratioOfTotal = total > 0 ? y / total : 0
            const percentageStr = ratioOfTotal !== 0 ? bold(`${(ratioOfTotal * 100).toFixed(1)}%`) : total > 0 ? '0%' : '–'
            // Compared, the earlier period's value; otherwise capacity, but
            // not for aggregate totals
            const muted = 'color:var(--color-text-muted);padding-left:var(--space-lg)'
            const capCell = comparing ? `<td style="${muted}">${before !== null ? formatValue(before) : '–'}</td>`
              : isAggregate ? '' : `<td style="${muted}">${cap > 0 ? formatMW(cap) : '–'}</td>`
            const labelStyle = indent ? ' style="padding-left:var(--space-lg)"' : ''
            return `<tr><td${labelStyle}><span style="color:${colour}">●</span> ${label}</td><td> ${formatted}</td>${capCell}<td style="padding-left:var(--space-lg)">${percentageStr}</td></tr>`
          }

          // Each group's points, in its parts' order, where two or more are in the tooltip (see TOOLTIP_GROUPS)
          const groups = (combineFossil ? [...TOOLTIP_GROUPS, FOSSIL_TOOLTIP_GROUP] : TOOLTIP_GROUPS)
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
              if (!grouped) return row(p.name, p.colour, p.y, capacityAt(p.name, x), p.before)
              if (fuelPoints.filter(s => groupOf(s) === grouped).pop() !== p) return ''
              const { group, points: parts } = grouped
              const colour = fuelCodeColour(group.colourFuel)
              const partsBefore = parts.every(({ p }) => p.before === null) ? null : parts.reduce((sum, { p }) => sum + (p.before ?? 0), 0)
              const heading = group.totals
                ? row(group.label, colour, parts.reduce((sum, { p }) => sum + p.y, 0), parts.reduce((sum, { p }) => sum + capacityAt(p.name, x), 0), partsBefore)
                : `<tr><td><span style="color:${colour}">●</span> ${group.label}</td></tr>`
              return heading + parts.map(({ p, label }) => row(label, p.colour, p.y, capacityAt(p.name, x), p.before, true)).join('')
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
          const priorTime = pr === undefined ? null : tooltipTime(priorMs[pr], aggregatePeriod)
          const capHeader = comparing ? `<th style="padding-left:var(--space-lg)">${priorTime ?? prior?.period.label ?? ''}</th>`
            : isAggregate ? '' : '<th style="padding-left:var(--space-lg)">Capacity</th>'
          // The earlier period's total generation of the same fuels, and how it's changed since
          const totalBefore = pr === undefined ? null : priorGeneration[pr] / unit.size
          const totalChange = totalBefore !== null ? ` <span style="color:var(--color-text-muted)">· ${changeText(total, totalBefore, formatValue)} on ${priorTime}</span>` : ''
          // Kept to one line a row, as the longer labels would otherwise wrap the table on a narrow panel
          return `<table style="white-space:nowrap"><tr><th>${time}</th><th>Generation</th>${capHeader}<th>% of total gen</th></tr>${rows}</table><br/>Total: <b>${formatValue(total)}</b>${totalChange}${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [data, generators, fuels, seriesFuels, combineSolar, combineFossil, fuelToIndices, fuelToUnits, effectiveFuels, isShown, isAggregate, aggregatePeriod, island, hvdc, distributedSolar, stacked, proportion, prior, priorFuels])

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
    <Panel {...panel} visible={visible} header={header} actions={[{ label: 'Analysis ↗', href: ANALYSIS_PATH }, { label: 'Generation Pipeline ↗', onClick: () => onPipelineOpenChange(true) }]}>
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
          compare={compare}
          onCompareChange={onCompareChange}
          compact={compactToolbar}
          lastUpdated={lastUpdated}
          loading={dataLoading || waitingForSolar || priorLoading}
          error={dataError}
          priorError={priorError}
          empty={!data}
        />
        {/* At the toolbar's end, under the header's Close */}
        <div style={{ display: 'flex', marginLeft: 'auto' }}>
          <ChartSettingsMenu settings={chartSettings} onChange={onChartSettingsChange} offered={['chartType', 'solar', 'fossil']} />
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
        {prior && priorFuels && chartOptions && (
          <CompareLegend
            dateMode={dateMode}
            period={prior.period}
            note={chartType === 'proportion' ? 'in the tooltip' : chartType === 'line' ? 'each fuel' : undefined}
          />
        )}
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
