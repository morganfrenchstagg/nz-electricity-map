import { useState, useMemo, lazy, Suspense } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { DateMode } from '../hooks/useDispatchData'
import { AGGREGATE_PERIODS, useAggregates } from '../hooks/useAggregates'
import type { RecentData, SelectedNode } from '../types'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel, CHARGING_FUEL_CODE, FUEL_CODE_ORDER } from '../utils/colours'
import { CHART_CONTAINER_PROPS, DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, fillMonthColumns, midnightPlotLines, tooltipTime, withGaps } from '../utils/chart'
import { formatMW, formatMWh } from '../utils/format'
import { nzLocalMs } from '../utils/time'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { ToggleGroup } from './ToggleGroup'
import DateControls from './DateControls'
import Panel, { PanelToolbar } from './Panel'
import type { PanelProps } from './Panel'

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
  const [island, setIsland] = useState<'all' | 'NI' | 'SI'>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  // The 30d, 1y and All views chart every node's MWh totals instead of the
  // 5-minute dispatch data. Not fetched while the panel is hidden.
  const aggregatePeriod = AGGREGATE_PERIODS[dateMode.kind] ?? null
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates(isAggregate && visible ? 'all' : null, aggregatePeriod)
  const data = isAggregate ? aggregates.aggregateData : recentData
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  const { fuels, fuelToIndices, fuelToCapacity } = useMemo(() => {
    if (!data || generators.length === 0) return { fuels: [], fuelToIndices: new Map<string, number[]>(), fuelToCapacity: new Map<string, number>() }
    const fuelToIndices = new Map<string, number[]>()
    const fuelToCapacity = new Map<string, number>()
    for (const gen of generators) {
      if (island !== 'all' && gen.island !== island) continue
      for (const unit of gen.units) {
        // The aggregate views include retired units' history
        if (unit.active === false && !isAggregate) continue
        const idx = data.series.indexOf(unit.node)
        if (idx === -1) continue
        const existing = fuelToIndices.get(unit.fuelCode) ?? []
        fuelToIndices.set(unit.fuelCode, [...existing, idx + 1])
        fuelToCapacity.set(unit.fuelCode, (fuelToCapacity.get(unit.fuelCode) ?? 0) + unit.capacity)
      }
    }
    const fuels = [
      ...FUEL_CODE_ORDER.filter(f => fuelToIndices.has(f)),
      ...[...fuelToIndices.keys()].filter(f => !(FUEL_CODE_ORDER as readonly string[]).includes(f)),
    ]
    return { fuels, fuelToIndices, fuelToCapacity }
  }, [data, generators, island, isAggregate])

  // Memoised so the chart options below don't rebuild on every render
  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  function toggleFuel(fuel: string) {
    const next = new Set(effectiveFuels)
    if (next.has(fuel)) { next.delete(fuel); if (next.size === 0) return }
    else next.add(fuel)
    onActiveFuelsChange(next.size === fuels.length ? null : next)
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!data || generators.length === 0 || fuels.length === 0 || effectiveFuels.size === 0) return null

    // Aggregate totals: stacked areas become stacked columns, which already stack
    // negative values (battery charging) separately.
    const series: Highcharts.SeriesOptionsType[] = fuels.filter(f => effectiveFuels.has(f)).map(fuel => {
      const points: [number, number][] = data.data.map(row => [
        nzLocalMs(row[0] as string),
        (fuelToIndices.get(fuel)!).reduce((sum, i) => sum + (((row[i] as number) || 0)), 0),
      ])
      const colour = fuelCodeColour(fuel)
      return {
        type: isAggregate ? 'column' : 'area',
        name: fuelCodeLabel(fuel),
        color: colour,
        // Covers 1px rounding gaps between columns (see nodeChartOptions)
        borderColor: colour,
        stacking: 'normal',
        stack: isAggregate ? undefined : (fuel === CHARGING_FUEL_CODE) ? "positive" : "negative",
        fillOpacity: 0.8,
        lineWidth: 1,
        data: isAggregate
          ? points.map(([x, y]) => (y === 0 ? { x, y, borderWidth: 0 } : [x, y]))
          : withGaps(points),
        marker: { enabled: false },
        events: aggregatePeriod === 'monthly'
          ? { afterColumnTranslate: fillMonthColumns } as Highcharts.SeriesEventsOptionsObject
          : undefined,
        animation: false,
      }
    })

    // Build per-timestamp renewable percentage
    const RENEWABLE_FUEL_CODES = new Set(['HYD', 'GEO', 'WIN', 'SOL', 'BESS'])
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

    // Total installed capacity (MSGC) per fuel, keyed by the series name shown in
    // the tooltip (fuelCodeLabel) so the shared formatter can look it up per point.
    const capacityByName = new Map<string, number>()
    for (const fuel of fuels) {
      capacityByName.set(fuelCodeLabel(fuel), fuelToCapacity.get(fuel) ?? 0)
    }

    return {
      chart: {
        ...FIT_TO_CONTAINER,
        type: 'area', height: null, animation: false, backgroundColor: '#ffffff',
        className: isAggregate ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
        plotLines: isAggregate ? [] : midnightPlotLines(data.data.map(row => row[0] as string)),
      },
      yAxis: {
        title: { text: isAggregate ? 'MWh' : 'MW' },
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
          const formatValue = isAggregate ? formatMWh : formatMW
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)

          const rows = points
            .slice()
            .map(p => {
              const val = formatValue(p.y ?? 0)
              const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
              const ratioOfTotal = (p.y ?? 0) / total;
              const percentageStr = ratioOfTotal > 0 ? `<b>${(ratioOfTotal * 100).toFixed(1)}%</b>` : '0%';
              // No capacity comparison for aggregate totals
              const cap = capacityByName.get(p.series.name) ?? 0
              const capCell = isAggregate ? '' : `<td style="color:var(--color-text-muted);padding-left:var(--space-lg)">${cap > 0 ? formatMW(cap) : '–'}</td>`
              return `<tr><td><span style="color:${String(p.color)}">●</span> ${p.series.name}:</td><td> ${formatted}</td>${capCell}<td style="padding-left:var(--space-lg)">${percentageStr}</td></tr>`
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
  }, [data, generators, fuels, fuelToIndices, fuelToCapacity, effectiveFuels, isAggregate, aggregatePeriod])

  // The pipeline button wraps under the title when there isn't room beside it
  const header = (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="title" style={{ whiteSpace: 'nowrap' }}>NZ Grid Generation</span>
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
              <SeriesButton key={fuel} colour={fuelCodeColour(fuel)} active={effectiveFuels.has(fuel)} onClick={() => toggleFuel(fuel)}>
                {fuelCodeLabel(fuel)}
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
