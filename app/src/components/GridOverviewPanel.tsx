import { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { DateMode } from '../hooks/useDispatchData'
import { AGGREGATE_PERIODS, useAggregates, yesterdayNZ } from '../hooks/useAggregates'
import type { RecentData, SelectedNode } from '../types'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel, FUEL_CODE_ORDER } from '../utils/colours'
import { CHART_CONTAINER_PROPS, DATETIME_LABEL_FORMATS, fillMonthColumns, tooltipTime, withGaps } from '../utils/chart'
import { formatMW, formatMWh } from '../utils/format'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import SeriesButtonRow, { ClearButton, seriesButtonStyle } from './SeriesButtonRow'
import { PeriodToggle, ToggleGroup } from './ToggleGroup'

const NodePickerModal = lazy(() => import('./NodePickerModal'))
const PipelineModal = lazy(() => import('./PipelineModal'))

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 0,
  width: '60vw',
  height: '100%',
  background: 'white',
  boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 10,
  overflow: 'hidden',
}


interface Props {
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  onClose: () => void
  onNodeSelect: (node: NonNullable<SelectedNode>) => void
  visible: boolean
  recentData: RecentData | null
  loading: boolean
  error: string | null
  panelWidth: number
  onResizeHandleMouseDown: (e: React.MouseEvent) => void
  expanded: boolean
  onExpandedChange: (v: boolean) => void
  isMobile?: boolean
}

export default function GridOverviewPanel({ dateMode, onDateModeChange, onClose, onNodeSelect, visible, recentData, loading, error, panelWidth, onResizeHandleMouseDown, expanded, onExpandedChange, isMobile = false }: Props) {
  const { generators, substations } = useDefinitions()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  const [island, setIsland] = useState<'all' | 'NI' | 'SI'>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pipelineOpen, setPipelineOpen] = useState(() => window.location.pathname === '/pipeline')
  const chartRef = useRef<HighchartsReact.RefObject>(null)
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  useEffect(() => { chartRef.current?.chart.reflow() }, [panelWidth])

  // The 30d, 1y and All views chart every node's MWh totals instead of the
  // 5-minute dispatch data. Not fetched while the panel is hidden.
  const aggregatePeriod = AGGREGATE_PERIODS[dateMode.kind] ?? null
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates(isAggregate && visible ? 'all' : null, aggregatePeriod)
  const data = isAggregate ? aggregates.aggregateData : recentData
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  useEffect(() => {
    if (pipelineOpen) {
      if (window.location.pathname !== '/pipeline') {
        window.history.pushState({}, '', '/pipeline' + window.location.search)
      }
    } else {
      if (window.location.pathname === '/pipeline') {
        window.history.replaceState({}, '', '/' + window.location.search)
      }
    }
  }, [pipelineOpen])

  useEffect(() => {
    const onPopState = () => {
      setPipelineOpen(window.location.pathname === '/pipeline')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const {
    fromDate, toDate, customDates, showDateInputs, fromInputRef, toMax, rangeError,
    handleFromChange, handleToChange, handlePeriodClick, handleCustomClick,
  } = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

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

  const [activeFuels, setActiveFuels] = useState<Set<string> | null>(() => {
    const param = new URLSearchParams(window.location.search).get('fuels')
    return param ? new Set(param.split(',').filter(Boolean)) : null
  })
  // Memoised so the chart options below don't rebuild on every render
  const effectiveFuels = useMemo(() => activeFuels ?? new Set(fuels), [activeFuels, fuels])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (activeFuels === null) p.delete('fuels')
    else p.set('fuels', [...activeFuels].join(','))
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [activeFuels])

  function toggleFuel(fuel: string) {
    const next = new Set(effectiveFuels)
    if (next.has(fuel)) { next.delete(fuel); if (next.size === 0) return }
    else next.add(fuel)
    setActiveFuels(next.size === fuels.length ? null : next)
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!data || generators.length === 0 || fuels.length === 0 || effectiveFuels.size === 0) return null

    // Aggregate totals: stacked areas become stacked columns, which already stack
    // negative values (battery charging) separately.
    const series: Highcharts.SeriesOptionsType[] = fuels.filter(f => effectiveFuels.has(f)).map(fuel => {
      const points: [number, number][] = data.data.map(row => [
        new Date((row[0] as string) + 'Z').getTime(),
        (fuelToIndices.get(fuel)!).reduce((sum, i) => sum + (((row[i] as number) || 0)), 0),
      ])
      const colour = fuelCodeColour(fuel)
      return {
        type: isAggregate ? 'column' : 'area',
        name: fuelCodeLabel(fuel),
        color: colour,
        // Covers 1px rounding gaps between columns (see NodePanel)
        borderColor: colour,
        stacking: 'normal',
        stack: isAggregate ? undefined : (fuel === "BESS-C") ? "positive" : "negative",
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
      .filter(([fuel]) => fuel !== 'BESS-C')
      .flatMap(([, indices]) => indices)
    const renewablePctByMs = new Map<number, number>()
    for (const row of data.data) {
      const ms = new Date((row[0] as string) + 'Z').getTime()
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
      const ms = new Date((row[0] as string) + 'Z').getTime()
      refPricingByMs.set(ms, {
        ota: otaIdx >= 0 ? (row[otaIdx + 1] as number ?? null) : null,
        ben: benIdx >= 0 ? (row[benIdx + 1] as number ?? null) : null,
      })
    }

    const midnightPlotLines: Highcharts.XAxisPlotLinesOptions[] = data.data
      .filter((row, i) => {
        if (i === 0 || isAggregate) return false
        return (row[0] as string).slice(0, 10) !== (data.data[i - 1][0] as string).slice(0, 10)
      })
      .map(row => ({
        value: new Date((row[0] as string) + 'Z').getTime(),
        color: '#aaaaaa',
        width: 1,
        dashStyle: 'Solid' as const,
        label: {
          text: Highcharts.dateFormat('%e %b', new Date((row[0] as string) + 'Z').getTime()),
          style: { color: '#888888', fontSize: '10px' },
          y: 14,
        },
        zIndex: 3,
      }))

    // Total installed capacity (MSGC) per fuel, keyed by the series name shown in
    // the tooltip (fuelCodeLabel) so the shared formatter can look it up per point.
    const capacityByName = new Map<string, number>()
    for (const fuel of fuels) {
      capacityByName.set(fuelCodeLabel(fuel), fuelToCapacity.get(fuel) ?? 0)
    }

    return {
      chart: {
        type: 'area', height: null, animation: false, backgroundColor: '#ffffff',
        className: isAggregate ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
        plotLines: midnightPlotLines,
      },
      yAxis: {
        title: { text: isAggregate ? 'MWh' : 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
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
              const capCell = isAggregate ? '' : `<td style="color:#888;padding-left:10px">${cap > 0 ? formatMW(cap) : '–'}</td>`
              return `<tr><td><span style="color:${String(p.color)}">●</span> ${p.series.name}:</td><td> ${formatted}</td>${capCell}<td style="padding-left:10px">${percentageStr}</td></tr>`
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
          const capHeader = isAggregate ? '' : '<th style="padding-left:10px">Capacity</th>'
          return `<table><tr><th>${time}</th><th>Generation</th>${capHeader}<th>% of total gen</th></tr>${rows}</table><br/>Total: <b>${formatValue(total)}</b>${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [data, generators, fuels, fuelToIndices, fuelToCapacity, effectiveFuels, isAggregate, aggregatePeriod])

  return (
    <div style={{ ...PANEL_STYLE, display: visible ? 'flex' : 'none', width: expanded ? '100vw' : panelWidth }}>
      <Suspense fallback={null}>
        {pickerOpen && (
          <NodePickerModal
            generators={generators}
            substations={substations}
            onSelect={(node) => { onNodeSelect(node); setPickerOpen(false) }}
            onClose={() => setPickerOpen(false)}
          />
        )}
        {pipelineOpen && <PipelineModal onClose={() => setPipelineOpen(false)} />}
      </Suspense>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* The pipeline button wraps under the title when there isn't room beside it */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}>NZ Grid Generation</span>
            <button
              onClick={() => setPickerOpen(true)}
              style={{ fontWeight: 400, fontSize: 13, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: '#999', lineHeight: 1, flexShrink: 0 }}
            >
              ▾
            </button>
          </div>
          <button
            onClick={() => setPipelineOpen(true)}
            style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, color: '#555', padding: '4px 8px', borderRadius: 4, flexShrink: 0, fontWeight: 500 }}
          >
            Generation Pipeline ↗
          </button>
        </div>
        {isMobile ? (
          <button
            onClick={onClose}
            style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#666', padding: '6px 10px', flexShrink: 0, borderRadius: 4 }}
            aria-label="Show map"
          >
            Show map
          </button>
        ) : (
          <>
            <button
              onClick={() => onExpandedChange(!expanded)}
              style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#666', padding: '4px 6px', flexShrink: 0, borderRadius: 4 }}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? 'Show map' : 'Expand'}
            </button>
            {!expanded && (
              <button
                onClick={onClose}
                style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#666', padding: '4px 6px', flexShrink: 0, borderRadius: 4 }}
                aria-label="Close"
              >
                Close
              </button>
            )}
          </>
        )}
      </div>

      {/* Island + date picker toolbar. When it's too narrow for one line, the
          toggles become dropdowns and the rest wraps. */}
      <div ref={toolbarRef} style={{ padding: '6px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8, flexWrap: compactToolbar ? 'wrap' : 'nowrap' }}>
        <ToggleGroup compact={compactToolbar} ariaLabel="Island" options={(['all', 'NI', 'SI'] as const).map(opt => ({
          key: opt,
          label: opt === 'all' ? 'All' : opt === 'NI' ? 'North Island' : 'South Island',
          menuLabel: opt === 'all' ? 'All islands' : undefined,
          active: island === opt,
          onClick: () => setIsland(opt),
        }))} />
        {!compactToolbar && <div style={{ width: 1, height: 16, background: '#ddd', flexShrink: 0 }} />}
        <PeriodToggle dateMode={dateMode} onSelect={handlePeriodClick} compact={compactToolbar} customDates={customDates} onCustom={handleCustomClick} />
        {!compactToolbar && <div style={{ width: 1, height: 16, background: '#ddd', flexShrink: 0 }} />}
        {showDateInputs && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <input
            ref={fromInputRef}
            type="date"
            value={fromDate}
            min="2020-09-11"
            max={yesterdayNZ()}
            onChange={e => handleFromChange(e.target.value)}
            style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', color: '#333', background: 'white' }}
          />
          <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>–</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            max={toMax}
            disabled={!fromDate}
            onChange={e => handleToChange(e.target.value)}
            style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', color: '#333', background: fromDate ? 'white' : '#f5f5f5' }}
          />
          {rangeError && (
            <span style={{ fontSize: 10, color: '#b91c1c', marginLeft: 4 }}>{rangeError}</span>
          )}
        </div>}
        {lastUpdated && !dataLoading && (
          <>{!compactToolbar && <div style={{ width: 1, height: 16, background: '#ddd', flexShrink: 0 }} />}<span style={{ fontSize: 11, color: '#888', marginLeft: compactToolbar ? 0 : 4, flexShrink: 0 }}>{lastUpdated}</span></>
        )}
        {dataLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888', flexShrink: 0 }}>
            Loading…
          </div>
        )}
        {dataError && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#c00', flexShrink: 0 }}>
            Failed to load data
          </div>
        )}
      </div>

      {/* Fuel pills */}
      {fuels.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee' }}>
          <SeriesButtonRow
            items={fuels.map(fuel => (
              <button key={fuel} onClick={() => toggleFuel(fuel)} style={seriesButtonStyle(fuelCodeColour(fuel), effectiveFuels.has(fuel))}>
                {fuelCodeLabel(fuel)}
              </button>
            ))}
            trail={[
              <ClearButton
                key="clear"
                cleared={activeFuels !== null && activeFuels.size === 0}
                onClick={() => setActiveFuels(activeFuels !== null && activeFuels.size === 0 ? null : new Set())}
              />,
            ]}
          />
        </div>
      )}

      {/* Chart area */}
      <div style={{ padding: '8px 0 0', flex: 1, minHeight: 0, height: '100%' }}>
        {dataLoading && !data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: '#888' }}>
            Loading…
          </div>
        )}
        {dataError && !data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: '#c00' }}>
            Failed to load data
          </div>
        )}
        {chartOptions && (
          <HighchartsReact ref={chartRef} key={`${String(expanded)}-${aggregatePeriod ?? 'live'}`} highcharts={Highcharts} options={chartOptions} containerProps={CHART_CONTAINER_PROPS} />
        )}
      </div>
      {!expanded && !isMobile && (
        <div
          onMouseDown={onResizeHandleMouseDown}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 20 }}
        />
      )}
    </div>
  )
}
