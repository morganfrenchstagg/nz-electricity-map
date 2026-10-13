import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react'
import type Highcharts from 'highcharts'
import type { GeneratorNode } from '../types'
import { isAggregateMode } from '../hooks/useDispatchData'
import { yesterdayNZ } from '../hooks/useAggregates'
import { useOutages } from '../hooks/useOutages'
import type { OutageRecord } from '../api'
import { useCodeSelection, useNodeData } from '../hooks/useNodeData'
import { tooltipTime } from '../utils/chart'
import { nodeChartOptions, pricesByTime, tooltipRow, tooltipTotalRow } from '../utils/nodeChart'
import { createGeneratorAdapter, createMultiGeneratorAdapter } from '../utils/generatorAdapter'
import { formatMW, formatMWh } from '../utils/format'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { ToggleGroup } from './ToggleGroup'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import { useOffers, tradingPeriodLabel } from '../hooks/useOffers'
import Panel, { PanelToolbar } from './Panel'
import DateControls from './DateControls'
import { ChartMessage, NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

const OutageModal = lazy(() => import('./OutageModal'))
const loadOfferChart = () => import('./OfferChart')
const OfferChart = lazy(loadOfferChart)

function outageMs(iso: string): number {
  return new Date(iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '') + 'Z').getTime()
}

// Collapses overlapping outage records for a single unit into a timeline of
// distinct MW-loss segments (e.g. two overlapping 3MW outages become one 6MW
// segment for the overlap, then a 3MW segment for the tail). Segments that have
// already fully ended are dropped, but a segment's start is its real record
// start — never clipped to "now" — so an ongoing outage still shows when it
// actually began.
function mergeOutageSegments(records: OutageRecord[], nowMs: number): { start: number; end: number; mw: number }[] {
  const events = new Set<number>()
  for (const r of records) {
    events.add(outageMs(r.timeStart))
    events.add(outageMs(r.timeEnd))
  }
  const sorted = [...events].sort((a, b) => a - b)
  const segments: { start: number; end: number; mw: number }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]
    const segEnd = sorted[i + 1]
    if (segEnd <= nowMs) continue
    const mw = records.reduce((sum, r) => {
      const s = outageMs(r.timeStart)
      const e = outageMs(r.timeEnd)
      return s <= segStart && e >= segEnd ? sum + r.mwattLost : sum
    }, 0)
    if (mw <= 0) continue
    const last = segments[segments.length - 1]
    if (last && Math.abs(last.mw - mw) < 0.001 && last.end === segStart) last.end = segEnd
    else segments.push({ start: segStart, end: segEnd, mw })
  }
  return segments
}

// `date` is built from outage timestamps via the "local time as UTC" convention
// (see outageMs), so it must be read back out with timeZone: 'UTC' to get the
// raw values the API sent — reading with 'Pacific/Auckland' would shift them again.
function formatOutageEnd(date: Date): string {
  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const endNZ = date.toLocaleDateString('en-CA', { timeZone: 'UTC' })
  if (endNZ === todayNZ) {
    return date.toLocaleTimeString('en-NZ', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}

interface Props extends NodePanelProps {
  node: GeneratorNode
}

// A generator's units, or several generators', against their capacity and
// outages, with an Offers view of what they bid into the market
export default function GeneratorPanel({ node, onClear, dateMode, onDateModeChange, recentData, loading, error, onNodeChange, ...panel }: Props) {
  const outages = useOutages()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  // The header hides its capacity readout, and the toolbar collapses to dropdowns, when too narrow
  const [headerRef, compactHeader] = useCompactWhenOverflowing<HTMLDivElement>()
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  const adapter = useMemo(
    () => node.kind === 'generator'
      ? createGeneratorAdapter(node.generator, outages)
      : createMultiGeneratorAdapter(node.generators, outages),
    [node, outages],
  )

  const { aggregatePeriod, isAggregate, allCodes, chartData, loading: dataLoading, error: dataError } = useNodeData({
    dateMode, recentData, loading, error,
    queryNodes: adapter.queryNodes, movedNodes: adapter.movedNodes, getCodes: adapter.getCodes,
  })
  const { effectiveCodes, setActiveCodes, toggleCode } = useCodeSelection(allCodes, node)
  const [outageModalOpen, setOutageModalOpen] = useState(false)

  const [viewMode, setViewMode] = useState<'generation' | 'offers'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'offers' ? 'offers' : 'generation'
  )
  const [tradingPeriod, setTradingPeriod] = useState<number>(() => {
    const tp = parseInt(new URLSearchParams(window.location.search).get('tp') ?? '', 10)
    return isNaN(tp) ? 1 : tp
  })

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (viewMode === 'offers') {
      p.set('view', 'offers')
      setTradingPeriod(1)
    } else {
      p.delete('view')
      p.delete('tp')
    }
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'offers') return
    const p = new URLSearchParams(window.location.search)
    p.set('tp', String(tradingPeriod))
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [tradingPeriod, viewMode])

  // The view's params go with the panel, e.g. when a substation replaces it
  useEffect(() => () => {
    const p = new URLSearchParams(window.location.search)
    p.delete('view')
    p.delete('tp')
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`)
  }, [])

  const offerDate = viewMode === 'offers'
    ? (dateMode.kind === 'today' || dateMode.kind === 'recent' || isAggregateMode(dateMode) ? 'latest'
      : dateMode.kind === 'date' ? dateMode.date
        : dateMode.from)
    : null
  const { offersData, loading: offersLoading, error: offersError } = useOffers(offerDate)
  // Fetch the chart code alongside the offers data rather than after it arrives
  useEffect(() => { if (viewMode === 'offers') loadOfferChart() }, [viewMode])

  // When the latest offers load, reflect their actual date in the date picker
  useEffect(() => {
    if (offersData && offerDate === 'latest') {
      const iso = offersData.date.length === 8
        ? `${offersData.date.slice(0, 4)}-${offersData.date.slice(4, 6)}-${offersData.date.slice(6, 8)}`
        : offersData.date
      setFromDate(iso)
    }
  }, [offersData, offerDate])
  const maxTradingPeriod = offersData
    ? Math.max(...Object.keys(offersData.data).map(Number))
    : 48

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)
  const {
    fromDate, setFromDate, setCustomRequested, customDates, showDateInputs, fromInputRef,
    handleFromChange, handlePeriodClick, handleCustomClick,
  } = datePicker

  const handleViewModeChange = useCallback((mode: 'generation' | 'offers') => {
    setViewMode(mode)
    // A custom date asked for but not yet picked doesn't carry over to the other view
    setCustomRequested(false)
    // Nor does the latest offers' date, which Offers shows in the date input
    if (mode === 'generation' && offerDate === 'latest') setFromDate('')
  }, [offerDate])

  const nodeKey = node.kind === 'generator' ? node.generator.site : node.generators.map(g => g.site).join(',')

  const capacity = adapter.capacityMW(effectiveCodes)
  const normalCapacity = adapter.normalCapacityMW(effectiveCodes)
  const totalOutageMW = useMemo(
    () => [...effectiveCodes].reduce((sum, code) => sum + adapter.unitOutageMW(code), 0),
    [effectiveCodes, adapter],
  )

  const soonestOutageEnd = useMemo(() => {
    if (!outages || totalOutageMW <= 0) return null
    const nowMs = Date.now()
    let soonest: Date | null = null
    for (const code of effectiveCodes) {
      for (const rec of (outages[code] ?? [])) {
        const endMs = new Date(rec.timeEnd.replace(/([+-]\d{2}:\d{2}|Z)$/, '') + 'Z').getTime()
        if (endMs <= nowMs) continue
        if (soonest === null || endMs < soonest.getTime()) soonest = new Date(endMs)
      }
    }
    return soonest
  }, [outages, effectiveCodes, totalOutageMW])
  const findUnit = useCallback((code: string) => {
    const generators = node.kind === 'generator' ? [node.generator] : node.generators
    for (const g of generators) {
      const unit = g.units.find((u) => u.node === code)
      if (unit) return unit
    }
    return null
  }, [node])

  const outageDetails = useMemo(() => {
    if (!outages) return []
    const nowMs = Date.now()
    const details: { code: string; label: string; record: OutageRecord; capacityRemaining: number | null }[] = []
    for (const code of effectiveCodes) {
      const records = outages[code] ?? []
      if (records.length === 0) continue
      const unit = findUnit(code)
      const segments = mergeOutageSegments(records, nowMs)
      segments.forEach((seg, i) => {
        const capacityRemaining = unit ? Math.max(0, (unit.installedCapacity ?? unit.capacity) - seg.mw) : null
        const rec: OutageRecord = {
          outageBlock: `merged-${code}-${i}`,
          timeStart: new Date(seg.start).toISOString(),
          timeEnd: new Date(seg.end).toISOString(),
          mwattLost: seg.mw,
        }
        details.push({ code, label: adapter.labelFor(code), record: rec, capacityRemaining })
      })
    }
    return details
  }, [outages, effectiveCodes, adapter, findUnit])

  // First segment of each outageBlock (e.g. "RUK_STN" -> "RUK") identifies the
  // plant in Transpower's POCP outage portal, used to build the "view in POCP" link.
  const outageBlockPrefixes = useMemo(() => {
    if (!outages) return []
    const nowMs = Date.now()
    const prefixes = new Set<string>()
    for (const code of effectiveCodes) {
      for (const rec of (outages[code] ?? [])) {
        if (outageMs(rec.timeEnd) <= nowMs) continue
        prefixes.add(rec.outageBlock.split('_')[0])
      }
    }
    return [...prefixes]
  }, [outages, effectiveCodes])

  const currentGeneration = useMemo(() => {
    if (!chartData || chartData.rows.length === 0) return null
    const lastRow = chartData.rows[chartData.rows.length - 1]
    return [...effectiveCodes]
      .filter(code => chartData.codes.includes(code))
      .reduce((sum, code) => sum + ((lastRow[code] as number) ?? 0), 0)
  }, [chartData, effectiveCodes])

  // Trapezoidal integral of the charted MW series over time -> MWh for the
  // currently displayed period. Gaps larger than withGaps' threshold are
  // skipped rather than bridged, so missing data doesn't inflate the total.
  // Aggregate rows are already MWh, so those are just summed.
  const totalGenerationMWh = useMemo(() => {
    if (!chartData || chartData.rows.length < (isAggregate ? 1 : 2)) return null
    const codes = [...effectiveCodes].filter(code => chartData.codes.includes(code))
    if (codes.length === 0) return null
    if (isAggregate) {
      return chartData.rows.reduce((total, row) =>
        total + codes.reduce((sum, code) => sum + ((row[code] as number) ?? 0), 0), 0)
    }
    const maxGapMs = 20 * 60 * 1000
    let total = 0
    for (let i = 1; i < chartData.rows.length; i++) {
      const prev = chartData.rows[i - 1]
      const curr = chartData.rows[i]
      const t0 = new Date((prev.time as string) + 'Z').getTime()
      const t1 = new Date((curr.time as string) + 'Z').getTime()
      const dtMs = t1 - t0
      if (dtMs <= 0 || dtMs > maxGapMs) continue
      const v0 = codes.reduce((sum, code) => sum + ((prev[code] as number) ?? 0), 0)
      const v1 = codes.reduce((sum, code) => sum + ((curr[code] as number) ?? 0), 0)
      total += ((v0 + v1) / 2) * (dtMs / 3600000)
    }
    return total
  }, [chartData, effectiveCodes, isAggregate])

  // Clear deselects every unit, and once none are selected becomes Select all
  const nothingSelected = effectiveCodes.size === 0
  function clearOrSelectAll() {
    setActiveCodes(nothingSelected ? null : new Set())
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    const capSeries = isAggregate ? null : adapter.capacitySeries(chartData.rows, effectiveCodes)

    // Step-left lookup: capacity at a given timestamp from the step-line data
    const capPoints = capSeries
      ? ((capSeries as Highcharts.SeriesLineOptions).data as { x: number; y: number }[])
      : null
    function capacityAt(ms: number): number | null {
      if (!capPoints) return null
      let val: number | null = null
      for (const p of capPoints) {
        if (p.x <= ms) val = p.y
        else break
      }
      return val
    }

    const prices = pricesByTime(isAggregate ? null : recentData, chartData.codes)

    return nodeChartOptions({
      chartData,
      aggregatePeriod,
      effectiveCodes,
      type: 'area',
      stacking: chartData.codes.length > 1 ? 'normal' : undefined,
      labelFor: adapter.labelFor,
      colourFor: adapter.colourFor,
      extraSeries: capSeries ? [capSeries] : [],
      legend: adapter.showLegend,
      yAxis: isAggregate
        ? { title: { text: 'MWh' }, softMin: 0, gridLineDashStyle: 'Dash' }
        : adapter.yAxisOptions(effectiveCodes, chartData.rows),
      tooltipFormatter: function () {
        const points = this.points ?? []
        const formatValue = isAggregate ? formatMWh : formatMW
        const context = { codes: chartData.codes, prices: prices.get(this.x as number), formatValue, showName: points.length > 1 }
        // No capacity comparison for aggregate totals
        const cap = isAggregate ? null : capacityAt(this.x as number)

        let rows = points.map((p) => tooltipRow(p, context,
          points.length === 1 && cap !== null ? ` / <b>${formatValue(cap)}</b> (${(cap > 0 ? ((p.y ?? 0) / cap) * 100 : 0).toFixed(1)}%)` : '',
        )).join('')
        if (points.length > 1) {
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)
          rows += tooltipTotalRow(total, formatValue, cap !== null ? ` / ${formatValue(cap)} (${cap > 0 ? Math.round(total / cap * 100) : 0}%)` : '')
        }
        return `<b>${tooltipTime(this.x as number, aggregatePeriod)}</b><br/><table>${rows}</table>`
      },
    })
  }, [chartData, effectiveCodes, adapter, recentData, isAggregate, aggregatePeriod])

  // A button per unit, when there's more than one
  const unitButtons = allCodes.length < 2 ? [] : allCodes.map((code) => (
    <SeriesButton key={code} colour={adapter.colourFor(code)} active={effectiveCodes.has(code)} onClick={() => toggleCode(code)}>
      {adapter.labelFor(code)}
    </SeriesButton>
  ))

  const header = (
    <>
      <NodeTitle node={node} title={adapter.title} compact={compactHeader} onNodeChange={onNodeChange} onClear={onClear}>
        <span>{adapter.subtitle}</span>
        {adapter.subtitleFuels.map((f) => (
          <span key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ marginRight: 3 }}>|</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.colour, flexShrink: 0 }} />
            <span>{f.label}</span>
          </span>
        ))}
      </NodeTitle>
      {/* The aggregate views have no current reading to compare with capacity, so they only show the total */}
      {!compactHeader && isAggregate && totalGenerationMWh !== null && (
        <div style={{ alignSelf: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Total: {formatMWh(totalGenerationMWh)}
        </div>
      )}
      {!compactHeader && !isAggregate && currentGeneration !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignSelf: 'center', gap: 5, minWidth: 140, flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            {totalOutageMW > 0 ? (
              <>
                <span>{formatMW(currentGeneration)} /</span>
                <s style={{ color: 'var(--color-text-faint)' }}>{normalCapacity.toFixed(0)} MW</s>
                <span>{formatMW(capacity)} ({capacity > 0 ? Math.round((currentGeneration / capacity) * 100) : 0}%)</span>
                <button
                  onClick={() => setOutageModalOpen(true)}
                  title="View outage details"
                  style={{
                    background: 'var(--color-danger-subtle)',
                    color: 'var(--color-danger)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '0 var(--space-sm)',
                    fontSize: 'var(--font-size-2xs)',
                    fontWeight: 600,
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {formatMW(totalOutageMW)} Outage{soonestOutageEnd ? ` until ${formatOutageEnd(soonestOutageEnd)}` : ''}
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="8" cy="4.5" r="0.9" fill="currentColor" />
                    <path d="M8 7.5V11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </>
            ) : (
              <span>{formatMW(currentGeneration)} / {formatMW(capacity)} ({normalCapacity > 0 ? Math.round((Math.abs(currentGeneration) / normalCapacity) * 100) : 0}%)</span>
            )}
          </div>
          <div style={{ height: 6, background: 'var(--color-fill)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
            {allCodes.map((code) => {
              if (!effectiveCodes.has(code)) return null
              const lastRow = chartData?.rows[chartData.rows.length - 1]
              const val = lastRow ? ((lastRow[code] as number) ?? 0) : 0
              const colour = adapter.colourFor(code)
              const denom = (capacity > 0 ? capacity : 1) + totalOutageMW
              const genPct = (Math.abs(val) / denom) * 100
              return (
                <span key={code} style={{ display: 'contents' }}>
                  <div style={{ height: '100%', width: `${genPct}%`, flexShrink: 0, background: colour }} />
                </span>
              )
            })}
            {
              totalOutageMW > 0 && (
                <>
                  <div id="empty-bar" style={{ height: '100%', width: `${(normalCapacity - totalOutageMW - (currentGeneration ?? 0)) / (normalCapacity ?? 1) * 100}%`, flexShrink: 0, background: 'var(--color-fill)' }} />
                  <div id="outage-bar" style={{ height: '100%', width: `${(totalOutageMW / (normalCapacity ?? 1)) * 100}%`, flexShrink: 0, background: `repeating-linear-gradient(45deg, #aaa666 0, #aaa666 2px, transparent 2px, transparent 5px)` }} />
                </>
              )
            }
          </div>
          {totalGenerationMWh !== null && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', textAlign: 'right', whiteSpace: 'nowrap' }}>
              Total: {formatMWh(totalGenerationMWh)}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <Panel {...panel} header={header} headerRef={headerRef}>
      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <ToggleGroup compact={compactToolbar} ariaLabel="View" options={[
          { key: 'generation', label: 'Generation', active: viewMode === 'generation', onClick: () => handleViewModeChange('generation') },
          { key: 'offers', label: 'Offers', active: viewMode === 'offers', onClick: () => handleViewModeChange('offers') },
        ]} />
        {!compactToolbar && <div className="divider" />}
        {viewMode === 'offers' ? (
          <>
            <ToggleGroup compact={compactToolbar} ariaLabel="Offers date" options={[
              { key: 'latest', label: 'Latest', active: !customDates, onClick: () => handlePeriodClick('today') },
              // The compact toolbar hides the date input, so its dropdown has an option to show it
              ...(compactToolbar ? [{ key: 'custom', label: 'Custom date', active: customDates, onClick: handleCustomClick }] : []),
            ]} />
            {!compactToolbar && <div className="divider" />}
            {showDateInputs && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <input
                ref={fromInputRef}
                type="date"
                value={fromDate}
                min="2020-09-11"
                max={yesterdayNZ()}
                onChange={e => handleFromChange(e.target.value)}
                className="date-input"
              />
            </div>}

            {/* Trading period stepper */}
            {!compactToolbar && <div className="divider" />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => setTradingPeriod(p => Math.max(1, p - 1))}
                disabled={tradingPeriod <= 1}
                className="stepper-button"
              >
                ◀
              </button>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 500, whiteSpace: 'nowrap', minWidth: 190, textAlign: 'center', display: 'inline-block' }}>
                Period {tradingPeriod}
                {offerDate && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 5 }}>{tradingPeriodLabel(tradingPeriod, offersData?.date ?? offerDate)}</span>}
              </span>
              <button
                onClick={() => setTradingPeriod(p => Math.min(maxTradingPeriod, p + 1))}
                disabled={tradingPeriod >= maxTradingPeriod}
                className="stepper-button"
              >
                ▶
              </button>
            </div>
            {offersLoading && <span className="status-text">Loading…</span>}
            {offersError && <span className="status-text is-error">Failed to load offers</span>}
          </>
        ) : (
          <DateControls
            dateMode={dateMode}
            picker={datePicker}
            compact={compactToolbar}
            lastUpdated={lastUpdated}
            loading={dataLoading}
            error={dataError}
            empty={allCodes.length === 0}
          />
        )}
      </PanelToolbar>

      {unitButtons.length > 0 && (
        <div className="section">
          <SeriesButtonRow
            items={unitButtons}
            trail={[<ClearButton key="clear" cleared={nothingSelected} onClick={clearOrSelectAll} />]}
          />
        </div>
      )}

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        {viewMode === 'offers' ? (
          offersLoading && !offersData ? (
            <ChartMessage>Loading…</ChartMessage>
          ) : offersError && !offersData ? (
            <ChartMessage error>Failed to load offers</ChartMessage>
          ) : offersData ? (
            <Suspense fallback={<ChartMessage>Loading…</ChartMessage>}>
              <OfferChart offersData={offersData} tradingPeriod={tradingPeriod} node={node} />
            </Suspense>
          ) : null
        ) : (
          <NodeChart
            chartKey={`${nodeKey}-${String(panel.expanded)}-${aggregatePeriod ?? 'live'}`}
            options={chartOptions}
            loading={dataLoading}
            error={dataError}
            empty={allCodes.length === 0}
          />
        )}
      </div>
      <Suspense fallback={null}>
        {outageModalOpen && (
          <OutageModal
            outages={outageDetails}
            outageBlockPrefixes={outageBlockPrefixes}
            onClose={() => setOutageModalOpen(false)}
          />
        )}
      </Suspense>
    </Panel>
  )
}
