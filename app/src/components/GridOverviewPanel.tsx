import { useState, useMemo, lazy, Suspense } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { isAggregateMode, isLiveMode, periodOf } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { aggregatePeriodOf, useAggregates } from '../hooks/useAggregates'
import type { RecentData, SelectedNode, Unit } from '../types'
import { inServiceAt, inServiceDuring, isCommissioning } from '../utils/generators'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel, CHARGING_FUEL_CODE, FUEL_CODE_ORDER, HVDC_EXPORT_CODE, HVDC_IMPORT_CODE, RENEWABLE_FUEL_CODES } from '../utils/colours'
import { hvdcInto } from '../utils/hvdc'
import { CHART_CONTAINER_PROPS, DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, chartReach, columnFillEvents, dataInterval, midnightPlotLines, timeChartAccessibility, tooltipTime, withGaps } from '../utils/chart'
import { energyUnit, formatMW, MW_UNIT } from '../utils/format'
import { nzLocalMs } from '../utils/time'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { ToggleGroup } from './ToggleGroup'
import DateControls from './DateControls'
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

const NodePickerModal = lazy(() => import('./NodePickerModal'))
const PipelineModal = lazy(() => import('./PipelineModal'))

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
  pipelineOpen: boolean
  onPipelineOpenChange: (open: boolean) => void
}

export default function GridOverviewPanel({ dateMode, onDateModeChange, onNodeSelect, visible, recentData, loading, error, activeFuels, onActiveFuelsChange, pipelineOpen, onPipelineOpenChange, ...panel }: Props) {
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
  const data = isAggregate ? aggregates.aggregateData : recentData
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  // The HVDC's transfer into the island shown, at each of the data's rows. Only
  // dispatch/recent has it, so not for past days or the aggregate views.
  const hvdc = useMemo(
    () => (island === 'all' || !data?.hvdc ? null : hvdcInto(island, data.hvdc, data.data.map(row => row[0] as string))),
    [data, island],
  )

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
      ...FUEL_CODE_ORDER.filter(f => fuelToIndices.has(f) || hvdcCodes.has(f)),
      ...[...fuelToIndices.keys()].filter(f => !(FUEL_CODE_ORDER as readonly string[]).includes(f)),
    ]
    return { fuels, fuelToIndices, fuelToUnits }
  }, [data, generators, island, isAggregate, dateMode, hvdc])

  // Memoised so the chart options below don't rebuild on every render
  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  function toggleFuel(fuel: string) {
    const next = new Set(effectiveFuels)
    if (next.has(fuel)) next.delete(fuel)
    else next.add(fuel)
    // Hiding the only fuel showing shows them all again
    onActiveFuelsChange(next.size === 0 || next.size === fuels.length ? null : next)
  }

  // Shows a fuel alone, hiding every other
  function isolateFuel(fuel: string) {
    onActiveFuelsChange(fuels.length === 1 ? null : new Set([fuel]))
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!data || generators.length === 0 || fuels.length === 0 || effectiveFuels.size === 0) return null

    // Each shown fuel's total at each time. The HVDC's is what flowed in, or out
    // (as a negative), and null where em6 has nothing.
    const shownFuels = fuels.filter(f => effectiveFuels.has(f))
    const hvdcPart = (fuel: string, r: number) => {
      const mw = hvdc?.[r]?.mw
      return mw === undefined ? null : fuel === HVDC_IMPORT_CODE ? Math.max(mw, 0) : Math.min(mw, 0)
    }
    const fuelTotals = data.data.map((row, r) => shownFuels.map(fuel => fuelToIndices.has(fuel)
      ? fuelToIndices.get(fuel)!.reduce((sum, i) => sum + (((row[i] as number) || 0)), 0)
      : hvdcPart(fuel, r),
    ))
    // Aggregate totals are MWh, charted in GWh unless the columns stay small
    const unit = isAggregate ? energyUnit(chartReach(fuelTotals, true)) : MW_UNIT

    // Aggregate totals: stacked areas become stacked columns, which already stack
    // negative values (battery charging) separately. Stacked areas don't, so
    // those below zero get a stack of their own.
    const series: Highcharts.SeriesOptionsType[] = shownFuels.map((fuel, f) => {
      const points: [number, number | null][] = data.data.map((row, r) => {
        const total = fuelTotals[r][f]
        return [nzLocalMs(row[0] as string), total === null ? null : total / unit.size]
      })
      const colour = fuelCodeColour(fuel)
      return {
        type: isAggregate ? 'column' : 'area',
        name: fuelLabel(fuel, island),
        color: colour,
        // Covers 1px rounding gaps between columns (see nodeChartOptions)
        borderColor: colour,
        stacking: 'normal',
        stack: isAggregate ? undefined : (fuel === CHARGING_FUEL_CODE || fuel === HVDC_EXPORT_CODE) ? "positive" : "negative",
        fillOpacity: 0.8,
        lineWidth: 1,
        data: isAggregate
          ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
          : withGaps(points),
        marker: { enabled: false },
        events: columnFillEvents(aggregatePeriod),
        animation: false,
      }
    })

    // Build per-timestamp renewable percentage
    const renewableIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => RENEWABLE_FUEL_CODES.has(fuel))
      .flatMap(([, indices]) => indices)
    const dispatchIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => fuel !== CHARGING_FUEL_CODE)
      .flatMap(([, indices]) => indices)
    const renewablePctByMs = new Map<number, number>()
    for (const row of data.data) {
      const ms = nzLocalMs(row[0] as string)
      const totalMW = dispatchIndices.reduce((s, i) => s + ((row[i] as number) || 0), 0)
      const renewableMW = renewableIndices.reduce((s, i) => s + ((row[i] as number) || 0), 0)
      renewablePctByMs.set(ms, totalMW > 0 ? (renewableMW / totalMW) * 100 : 0)
    }

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
    // The HVDC's is its transfer limit the way it's flowing.
    const hvdcByMs = new Map(hvdc ? data.data.map((row, r) => [nzLocalMs(row[0] as string), hvdc[r]]) : [])
    const capacityAt = (name: string, ms: number) => {
      if (name === fuelLabel(HVDC_IMPORT_CODE, island)) return hvdcByMs.get(ms)?.inLimit ?? 0
      if (name === fuelLabel(HVDC_EXPORT_CODE, island)) return hvdcByMs.get(ms)?.outLimit ?? 0
      return (unitsByName.get(name) ?? [])
        .filter(u => inServiceAt(u, ms))
        .reduce((sum, u) => sum + u.capacity, 0)
    }

    return {
      chart: {
        ...FIT_TO_CONTAINER,
        type: 'area', height: null, animation: false, backgroundColor: '#ffffff',
        className: isAggregate ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      ...timeChartAccessibility(
        `${island === 'all' ? 'New Zealand' : island === 'NI' ? 'North Island' : 'South Island'} generation by fuel`,
        'Generation from each fuel, stacked',
        aggregatePeriod,
        unit,
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
        title: { text: unit.label },
        softMin: 0,
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
          const time = tooltipTime(this.x as number, aggregatePeriod)
          const formatValue = unit.format
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)

          const rows = points
            .slice()
            .map(p => {
              const val = formatValue(p.y ?? 0)
              const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
              const ratioOfTotal = (p.y ?? 0) / total;
              const percentageStr = ratioOfTotal > 0 ? `<b>${(ratioOfTotal * 100).toFixed(1)}%</b>` : '0%';
              // No capacity comparison for aggregate totals
              const cap = capacityAt(p.series.name, this.x as number)
              const capCell = isAggregate ? '' : `<td style="color:var(--color-text-muted);padding-left:var(--space-lg)">${cap > 0 ? formatMW(cap) : '–'}</td>`
              return `<tr><td><span style="color:${String(p.color)}">●</span> ${p.series.name}</td><td> ${formatted}</td>${capCell}<td style="padding-left:var(--space-lg)">${percentageStr}</td></tr>`
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
          return `<table><tr><th>${time}</th><th>Generation</th>${capHeader}<th>% of total gen</th></tr>${rows}</table><br/>Total: <b>${formatValue(total)}</b>${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [data, generators, fuels, fuelToIndices, fuelToUnits, effectiveFuels, isAggregate, aggregatePeriod, island, hvdc])

  // The pipeline button wraps under the title when there isn't room beside it,
  // and on the narrowest panels the title is cut short to keep the picker's ▾ in view
  const header = (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>NZ Grid Generation</span>
        <button
          onClick={() => setPickerOpen(true)}
          style={{ fontWeight: 400, fontSize: 'var(--font-size-base)', border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-faint)', lineHeight: 1, flexShrink: 0 }}
        >
          ▾
        </button>
      </div>
      <button
        onClick={() => onPipelineOpenChange(true)}
        className="button-secondary"
        style={{ padding: 'var(--space-xs) var(--space-md)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}
      >
        Generation Pipeline ↗
      </button>
    </div>
  )

  return (
    <Panel {...panel} visible={visible} header={header}>
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
          loading={dataLoading}
          error={dataError}
          empty={!data}
        />
      </PanelToolbar>

      {/* Fuel pills */}
      {fuels.length > 0 && (
        <div className="section">
          <SeriesButtonRow
            items={fuels.map(fuel => (
              <SeriesButton key={fuel} colour={fuelCodeColour(fuel)} active={effectiveFuels.has(fuel)} onClick={() => toggleFuel(fuel)} onIsolate={() => isolateFuel(fuel)}>
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
        {dataLoading && !data && (
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
          <HighchartsReact key={`${String(panel.expanded)}-${aggregatePeriod ?? 'live'}`} highcharts={Highcharts} options={chartOptions} containerProps={CHART_CONTAINER_PROPS} />
        )}
      </div>
    </Panel>
  )
}
