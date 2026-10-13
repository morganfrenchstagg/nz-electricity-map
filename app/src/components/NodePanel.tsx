import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { SelectedNode, RecentData } from '../types'
import { isAggregateMode } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { AGGREGATE_PERIODS, foldMovedNodes, useAggregates, yesterdayNZ } from '../hooks/useAggregates'
import { useDefinitions } from '../hooks/useDefinitions'
import { useOutages } from '../hooks/useOutages'
import type { OutageRecord } from '../hooks/useOutages'
import { CHART_CONTAINER_PROPS, DATETIME_LABEL_FORMATS, FIT_TO_CONTAINER, extractChartData, fillMonthColumns, isGeneratorCode, tooltipTime, withGaps } from '../utils/chart'
import { createGeneratorAdapter, createMultiGeneratorAdapter, createSubstationAdapter } from '../utils/nodeAdapter'
import { formatMW, formatMWh } from '../utils/format'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { PeriodToggle, ToggleGroup } from './ToggleGroup'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import { useOffers, tradingPeriodLabel } from '../hooks/useOffers'
import Panel, { PanelToolbar } from './Panel'
import type { PanelProps } from './Panel'

const NodePickerModal = lazy(() => import('./NodePickerModal'))
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

interface Props extends PanelProps {
  node: NonNullable<SelectedNode>
  onClear: () => void
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  recentData: RecentData | null
  loading: boolean
  error: string | null
  onNodeChange: (node: NonNullable<SelectedNode>) => void
}

export default function NodePanel({ node, onClear, dateMode, onDateModeChange, recentData, loading, error, onNodeChange, ...panel }: Props) {
  const { generators: allGenerators, substations: allSubstations } = useDefinitions()
  const outages = useOutages()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  // The header hides its capacity readout, and the toolbar collapses to dropdowns, when too narrow
  const [headerRef, compactHeader] = useCompactWhenOverflowing<HTMLDivElement>()
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  const adapter = useMemo(() => {
    if (node.kind === 'generator') return createGeneratorAdapter(node.generator, outages)
    if (node.kind === 'generators') return createMultiGeneratorAdapter(node.generators, outages)
    return createSubstationAdapter(node.substation, allGenerators)
  }, [node, allGenerators, outages])

  const aggregatePeriod = AGGREGATE_PERIODS[dateMode.kind] ?? null
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates(isAggregate ? adapter.queryNodes : null, aggregatePeriod)
  const aggregateData = useMemo(
    () => aggregates.aggregateData && foldMovedNodes(aggregates.aggregateData, adapter.movedNodes),
    [aggregates.aggregateData, adapter],
  )
  const data = isAggregate ? aggregateData : recentData
  const dataLoading = isAggregate ? aggregates.loading : loading
  const dataError = isAggregate ? aggregates.error : error

  const allCodes = useMemo(
    () => (data ? adapter.getCodes(data, isAggregate) : []),
    [data, adapter, isAggregate],
  )

  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  // Extra series the user has toggled, by name; the rest follow the adapter's default
  const [extraSeriesShown, setExtraSeriesShown] = useState<Record<string, boolean>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [outageModalOpen, setOutageModalOpen] = useState(false)

  const isGenerator = node.kind !== 'substation'
  const [viewMode, setViewMode] = useState<'generation' | 'offers'>(() =>
    isGenerator && new URLSearchParams(window.location.search).get('view') === 'offers' ? 'offers' : 'generation'
  )
  const [tradingPeriod, setTradingPeriod] = useState<number>(() => {
    const tp = parseInt(new URLSearchParams(window.location.search).get('tp') ?? '', 10)
    return isNaN(tp) ? 1 : tp
  })
  useEffect(() => { if (node.kind === 'substation') setViewMode('generation') }, [node])

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

  const {
    fromDate, setFromDate, toDate, setCustomRequested, customDates, showDateInputs, fromInputRef, toMax, rangeError,
    handleFromChange, handleToChange, handlePeriodClick, handleCustomClick,
  } = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  const handleViewModeChange = useCallback((mode: 'generation' | 'offers') => {
    setViewMode(mode)
    // A custom date asked for but not yet picked doesn't carry over to the other view
    setCustomRequested(false)
    // Nor does the latest offers' date, which Offers shows in the date input
    if (mode === 'generation' && offerDate === 'latest') setFromDate('')
  }, [offerDate])

  const hasGeneratorCodes = node.kind === 'substation' && allCodes.some(isGeneratorCode)

  const effectiveCodes = useMemo(() => activeCodes ?? new Set(allCodes), [activeCodes, allCodes])
  const generatorsShown = hasGeneratorCodes && [...effectiveCodes].some(isGeneratorCode)

  useEffect(() => { setActiveCodes(null); setExtraSeriesShown({}) }, [node])

  const showUnitSelector = adapter.showUnitSelector(allCodes.length)

  const chartData = useMemo(() => {
    if (!data || allCodes.length === 0) return null
    return extractChartData(data, allCodes)
  }, [data, allCodes])

  // Series derived from the codes (a substation's Total line), each with its own toggle button
  const extraSeries = useMemo(
    () => (chartData ? adapter.extraSeries(chartData.rows, chartData.codes) : []),
    [chartData, adapter],
  )

  const { title, subtitle } = adapter
  const nodeKey = node.kind === 'generator' ? node.generator.site
    : node.kind === 'generators' ? node.generators.map(g => g.site).join(',')
      : node.substation.siteId

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
    const generators = node.kind === 'generator' ? [node.generator]
      : node.kind === 'generators' ? node.generators
        : []
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
        details.push({ code, label: adapter.labelFor(code, allCodes), record: rec, capacityRemaining })
      })
    }
    return details
  }, [outages, effectiveCodes, adapter, findUnit, allCodes])

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
        total + codes.reduce((sum, code) => sum + adapter.transformValue((row[code] as number) ?? 0), 0), 0)
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
      const v0 = codes.reduce((sum, code) => sum + adapter.transformValue((prev[code] as number) ?? 0), 0)
      const v1 = codes.reduce((sum, code) => sum + adapter.transformValue((curr[code] as number) ?? 0), 0)
      total += ((v0 + v1) / 2) * (dtMs / 3600000)
    }
    return total
  }, [chartData, effectiveCodes, adapter, isAggregate])

  function toggleCode(code: string) {
    const next = new Set(effectiveCodes)
    if (next.has(code)) {
      if (next.size > 1) next.delete(code)
    } else {
      next.add(code)
    }
    setActiveCodes(next)
  }

  // Deselects every generator, or selects them all again. If no buses are
  // selected either, hiding falls back to all buses so the chart isn't empty.
  // The Total line includes the generators, so it's switched with them.
  function toggleGenerators() {
    const buses = [...effectiveCodes].filter(c => !isGeneratorCode(c))
    if (!generatorsShown) {
      setActiveCodes(new Set([...buses, ...allCodes.filter(isGeneratorCode)]))
    } else {
      const remaining = buses.length > 0 ? buses : allCodes.filter(c => !isGeneratorCode(c))
      if (remaining.length === 0) return
      setActiveCodes(new Set(remaining))
    }
    setExtraSeriesShown(Object.fromEntries(extraSeries.map((s) => [s.name ?? '', !generatorsShown])))
  }

  function isExtraSeriesShown(s: Highcharts.SeriesOptionsType) {
    return extraSeriesShown[s.name ?? ''] ?? s.visible !== false
  }

  function toggleExtraSeries(s: Highcharts.SeriesOptionsType) {
    setExtraSeriesShown((prev) => ({ ...prev, [s.name ?? '']: !isExtraSeriesShown(s) }))
  }

  // As on the grid overview: Clear deselects every series, Total included, and
  // once nothing is selected it becomes Select all, which turns them all on.
  const nothingSelected = effectiveCodes.size === 0 && !extraSeries.some(isExtraSeriesShown)
  function clearOrSelectAll() {
    setActiveCodes(nothingSelected ? null : new Set())
    setExtraSeriesShown(Object.fromEntries(extraSeries.map((s) => [s.name ?? '', nothingSelected])))
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    // Aggregate totals: stacked areas become stacked columns (which already stack
    // negative values separately, so no 'neg' stack), and lines get markers.
    const series: Highcharts.SeriesOptionsType[] = chartData.codes.map((code, i) => {
      const points: [number, number][] = chartData.rows.map((row) => [
        new Date((row.time as string) + 'Z').getTime(),
        adapter.transformValue(row[code] as number),
      ])
      const colour = adapter.colourFor(code, i)
      return {
        type: isAggregate && adapter.chartType === 'area' ? 'column' : adapter.chartType,
        name: adapter.labelFor(code, chartData.codes),
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
        marker: { enabled: isAggregate && adapter.chartType === 'line', radius: 3 },
        // Not in Highcharts' types, but any function under `events` is
        // registered as a listener, and columns fire this after layout.
        events: aggregatePeriod === 'monthly'
          ? { afterColumnTranslate: fillMonthColumns } as Highcharts.SeriesEventsOptionsObject
          : undefined,
        animation: false,
      }
    })

    series.push(...extraSeries.map((s) => ({ ...s, visible: isExtraSeriesShown(s) })))
    const capSeries = isAggregate ? null : adapter.capacitySeries(chartData.rows, effectiveCodes)
    if (capSeries) series.push(capSeries)

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

    // Built once per chart rather than per tooltip, which fires on every mouse move
    // A node can have no price at some timestamps, so values may be null
    const pricingByMs = new Map<number, Record<string, number | null>>()
    if (recentData?.pricing && !isAggregate) {
      const indices = chartData.codes.map((c) => recentData.series.indexOf(c) + 1)
      for (const row of recentData.pricing) {
        const ms = new Date((row[0] as string) + 'Z').getTime()
        const entry: Record<string, number | null> = {}
        chartData.codes.forEach((code, i) => { entry[code] = row[indices[i]] as number | null })
        pricingByMs.set(ms, entry)
      }
    }

    const midnightPlotLines: Highcharts.XAxisPlotLinesOptions[] = chartData.rows
      .filter((row, i) => {
        if (i === 0 || isAggregate) return false
        return (row.time as string).slice(0, 10) !== (chartData.rows[i - 1].time as string).slice(0, 10)
      })
      .map((row) => ({
        value: new Date((row.time as string) + 'Z').getTime(),
        color: '#aaaaaa',
        width: 1,
        dashStyle: 'Solid',
        label: {
          text: Highcharts.dateFormat('%e %b', new Date((row.time as string) + 'Z').getTime()),
          style: { color: '#888888', fontSize: 'var(--font-size-2xs)' },
          y: 14,
        },
        zIndex: 3,
      }))

    return {
      chart: {
        ...FIT_TO_CONTAINER,
        type: adapter.chartType, height: null, animation: false, backgroundColor: '#ffffff',
        className: isAggregate && adapter.chartType === 'area' ? 'aggregate-columns' : undefined, // see index.css
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: adapter.showLegend(chartData.codes.length), itemStyle: { fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        dateTimeLabelFormats: DATETIME_LABEL_FORMATS,
        plotLines: midnightPlotLines,
      },
      yAxis: isAggregate
        ? {
          title: { text: isGenerator ? 'MWh' : 'Load (MWh)' },
          softMin: 0,
          gridLineDashStyle: 'Dash',
        }
        : adapter.yAxisOptions(effectiveCodes, chartData.rows),
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function () {
          const points = (this.points ?? []).filter((p) => p.series.name !== 'Total')
          const time = tooltipTime(this.x as number, aggregatePeriod)
          const formatValue = isAggregate ? formatMWh : formatMW
          const priceAtTime = pricingByMs.get(this.x as number)

          // No capacity comparison for aggregate totals
          const cap = isAggregate ? null : capacityAt(this.x as number);

          const renderRow = (p: Highcharts.Point) => {
            const val = formatValue(p.y ?? 0)
            const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
            const code = chartData.codes[p.series.index]
            const price = code !== undefined && priceAtTime ? priceAtTime[code] : undefined
            const priceStr = price != null ? `$${price.toFixed(2)}/MWh` : ''
            const nameStr = points.length > 1 ? p.series.name : '';
            const capacityRow = points.length === 1 && cap !== null ? ` / <b>${formatValue(cap)}</b> (${(cap > 0 ? ((p.y ?? 0) / cap) * 100 : 0).toFixed(1)}%)` : '';
            return `<tr><td><span style="color:${String(p.color)}">●</span> ${nameStr}</td><td>${formatted}${capacityRow}</td><td>${priceStr}</td></tr>`
          }

          // For substations, list bus values on top and generators below a header.
          let rows = "";
          if (hasGeneratorCodes) {
            const isGen = (p: Highcharts.Point) => isGeneratorCode(chartData.codes[p.series.index] ?? '')
            const busRows = points.filter((p) => !isGen(p)).map(renderRow).join('')
            const genPoints = points.filter(isGen)
            const genRows = genPoints.length > 0
              ? `<tr><td colspan="3" class="eyebrow" style="padding-top:var(--space-sm)">Generation</td></tr>` + genPoints.map(renderRow).join('')
              : ''
            rows = busRows + genRows
          } else {
            rows = points.map(renderRow).join('')
          }

          // TOTAL
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0);
          const capRow = cap !== null ? ` / ${formatValue(cap)} (${cap > 0 ? Math.round(total / cap * 100) : 0}%)` : ''
          const totalRow = points.length > 1 ? `<tr><td></td></tr><tr><td>Total: <b>${formatValue(total)}${capRow}</td></tr>` : ''
          rows += totalRow;
          return `<b>${time}</b><br/><table>${rows}</table>`;
        },
      },
      plotOptions: {
        area: {
          lineWidth: 1.5,
          fillOpacity: 0.8,
          stacking: adapter.stacking(chartData.codes.length),
        },
        column: {
          borderWidth: 1,
          borderRadius: 0,
          pointPadding: 0,
          groupPadding: 0,
          stacking: adapter.stacking(chartData.codes.length),
        },
      },
      series,
    }
  }, [chartData, effectiveCodes, adapter, recentData, extraSeries, extraSeriesShown, hasGeneratorCodes, isAggregate, aggregatePeriod, isGenerator])

  // Series buttons: the substation generator toggle and Total lead, then the unit selector
  const leadButtons = [
    ...(hasGeneratorCodes ? [
      <button
        key="generators"
        onClick={toggleGenerators}
        className={`series-button series-button--neutral${generatorsShown ? ' is-active' : ''}`}
      >
        {generatorsShown ? 'Hide generators' : 'Show generators'}
      </button>,
    ] : []),
    ...extraSeries.map((s) => {
      const name = s.name ?? ''
      return (
        <SeriesButton key={`extra-${name}`} colour={String((s as Highcharts.SeriesLineOptions).color)} active={isExtraSeriesShown(s)} onClick={() => toggleExtraSeries(s)}>
          {name}
        </SeriesButton>
      )
    }),
  ]
  if (leadButtons.length > 0 && showUnitSelector) leadButtons.push(<div key="divider" className="divider" />)

  // Unit selector (generators with multiple units, substations with multiple buses/generators)
  const unitButtons = !showUnitSelector ? [] : allCodes.map((code, i) => {
    const button = (
      <SeriesButton key={code} colour={adapter.colourFor(code, i)} active={effectiveCodes.has(code)} onClick={() => toggleCode(code)}>
        {adapter.labelFor(code, allCodes)}
      </SeriesButton>
    )
    // A substation's buses come first; a divider leads the first generator
    if (!(i > 0 && isGeneratorCode(code) && !isGeneratorCode(allCodes[i - 1]))) return button
    return (
      <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="divider" />
        {button}
      </div>
    )
  })

  const header = (
    <>
      {/* Kept at its full width while the readout shows, so a header too narrow
          for both hides the readout rather than squeezing the title */}
      <div style={compactHeader ? { flex: 1, minWidth: 0 } : { flex: '1 0 auto' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPickerOpen(true)}
            className="title"
            style={{ lineHeight: 1.3, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {title}
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', fontWeight: 400 }}>▾</span>
          </button>
          <button onClick={onClear} className="button-secondary" aria-label='Clear'>
            Clear
          </button>
        </div>
        {/* Wraps to the title row's width rather than widening the title block, so a long subtitle doesn't hide the readout */}
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 6px', contain: 'inline-size' }}>
          <span>{subtitle}</span>
          {adapter.subtitleFuels.map((f) => (
            <span key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ marginRight: 3 }}>|</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.colour, flexShrink: 0 }} />
              <span>{f.label}</span>
            </span>
          ))}
        </div>
      </div>
      {/* The aggregate views have no current reading to compare with capacity, so they only show the total */}
      {!compactHeader && isAggregate && isGenerator && totalGenerationMWh !== null && (
        <div style={{ alignSelf: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Total: {formatMWh(totalGenerationMWh)}
        </div>
      )}
      {!compactHeader && !isAggregate && capacity !== null && normalCapacity !== null && currentGeneration !== null && (
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
            {allCodes.map((code, i) => {
              if (!effectiveCodes.has(code)) return null
              const lastRow = chartData?.rows[chartData.rows.length - 1]
              const val = lastRow ? ((lastRow[code] as number) ?? 0) : 0
              const colour = adapter.colourFor(code, i)
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
        {isGenerator && (
          <>
            <ToggleGroup compact={compactToolbar} ariaLabel="View" options={[
              { key: 'generation', label: 'Generation', active: viewMode === 'generation', onClick: () => handleViewModeChange('generation') },
              { key: 'offers', label: 'Offers', active: viewMode === 'offers', onClick: () => handleViewModeChange('offers') },
            ]} />
            {!compactToolbar && <div className="divider" />}
          </>
        )}
        {viewMode === 'offers'
          ? <ToggleGroup compact={compactToolbar} ariaLabel="Offers date" options={[
              { key: 'latest', label: 'Latest', active: !customDates, onClick: () => handlePeriodClick('today') },
              // The compact toolbar hides the date input, so its dropdown has an option to show it
              ...(compactToolbar ? [{ key: 'custom', label: 'Custom date', active: customDates, onClick: handleCustomClick }] : []),
            ]} />
          : <PeriodToggle dateMode={dateMode} onSelect={handlePeriodClick} compact={compactToolbar} customDates={customDates} onCustom={handleCustomClick} />}
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
          {viewMode === 'generation' && (
            <>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>–</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                max={toMax}
                disabled={!fromDate}
                onChange={e => handleToChange(e.target.value)}
                className="date-input"
              />
            </>
          )}
          {rangeError && viewMode === 'generation' && (
            <span className="status-text is-error" style={{ marginLeft: 4 }}>{rangeError}</span>
          )}
        </div>}

        {/* Trading period stepper (offers mode) */}
        {viewMode === 'offers' && (
          <>
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
        )}

        {viewMode === 'generation' && lastUpdated && !dataLoading && (
          <>{!compactToolbar && <div className="divider" />}<span className="status-text" style={{ marginLeft: compactToolbar ? 0 : 4 }}>{lastUpdated}</span></>
        )}
        {viewMode === 'generation' && dataLoading && <span className="status-text">Loading…</span>}
        {viewMode === 'generation' && dataError && allCodes.length !== 0 && (
          <span className="status-text is-error">Failed to load data</span>
        )}
      </PanelToolbar>

      {(leadButtons.length > 0 || unitButtons.length > 0) && (
        <div className="section">
          <SeriesButtonRow
            lead={leadButtons}
            items={unitButtons}
            trail={unitButtons.length > 0 ? [<ClearButton key="clear" cleared={nothingSelected} onClick={clearOrSelectAll} />] : []}
          />
        </div>
      )}

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        {viewMode === 'offers' ? (
          offersLoading && !offersData ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-text-muted)' }}>Loading…</div>
          ) : offersError && !offersData ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-danger)' }}>Failed to load offers</div>
          ) : offersData ? (
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-text-muted)' }}>Loading…</div>}>
              <OfferChart offersData={offersData} tradingPeriod={tradingPeriod} node={node} generators={allGenerators} />
            </Suspense>
          ) : null
        ) : (
          <>
            {dataLoading && allCodes.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-text-muted)' }}>
                Loading…
              </div>
            )}
            {dataError && allCodes.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-danger)' }}>
                Failed to load data
              </div>
            )}
            {!dataLoading && !dataError && allCodes.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--color-text-muted)' }}>
                No data available
              </div>
            )}
            {chartOptions && (
              <HighchartsReact key={`${nodeKey}-${String(panel.expanded)}-${aggregatePeriod ?? 'live'}`} highcharts={Highcharts} options={chartOptions} containerProps={CHART_CONTAINER_PROPS} />
            )}
          </>
        )}
      </div>
      <Suspense fallback={null}>
        {pickerOpen && (
          <NodePickerModal
            generators={allGenerators}
            substations={allSubstations}
            currentNode={node}
            onSelect={onNodeChange}
            onClose={() => setPickerOpen(false)}
          />
        )}
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
