import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { SelectedNode, RecentData } from '../types'
import { datesBetween, MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { useDefinitions } from '../hooks/useDefinitions'
import { useOutages } from '../hooks/useOutages'
import { extractChartData, withGaps } from '../utils/chart'
import { createGeneratorAdapter, createSubstationAdapter } from '../utils/nodeAdapter'
import { formatMW } from '../utils/format'

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
  node: NonNullable<SelectedNode>
  onClose: () => void
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  recentData: RecentData | null
  loading: boolean
  error: string | null
  panelWidth: number
  onResizeHandleMouseDown: (e: React.MouseEvent) => void
}

export default function NodePanel({ node, onClose, dateMode, onDateModeChange, recentData, loading, error, panelWidth, onResizeHandleMouseDown }: Props) {
  const { generators: allGenerators } = useDefinitions()
  const outages = useOutages()

  const adapter = useMemo(
    () =>
      node.kind === 'generator'
        ? createGeneratorAdapter(node.generator, outages)
        : createSubstationAdapter(node.substation, allGenerators),
    [node, allGenerators, outages],
  )

  const allCodes = useMemo(
    () => (recentData ? adapter.getCodes(recentData) : []),
    [recentData, adapter],
  )

  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const [showGenerators, setShowGenerators] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const chartRef = useRef<HighchartsReact.RefObject>(null)
  useEffect(() => { chartRef.current?.chart.reflow() }, [panelWidth])

  // Date picker local state — initialized from dateMode prop (which may come from URL)
  const [fromDate, setFromDate] = useState(
    dateMode.kind === 'date' ? dateMode.date
      : dateMode.kind === 'range' ? dateMode.from
        : ''
  )
  const [toDate, setToDate] = useState(dateMode.kind === 'range' ? dateMode.to : '')

  const rangeError = useMemo(() => {
    if (!fromDate || !toDate) return null
    if (toDate < fromDate) return 'End date must be after start date'
    const days = datesBetween(fromDate, toDate).length
    if (days > MAX_RANGE_DAYS) return `Range exceeds ${MAX_RANGE_DAYS} days (${days} selected)`
    return null
  }, [fromDate, toDate])

  const handleFromChange = useCallback((val: string) => {
    setFromDate(val)
    if (!val) {
      setToDate('')
      onDateModeChange({ kind: 'recent' })
    } else if (toDate && toDate >= val) {
      const days = datesBetween(val, toDate).length
      if (days <= MAX_RANGE_DAYS) onDateModeChange({ kind: 'range', from: val, to: toDate })
    } else {
      setToDate('')
      onDateModeChange({ kind: 'date', date: val })
    }
  }, [toDate, onDateModeChange])

  const handleToChange = useCallback((val: string) => {
    setToDate(val)
    if (!val) {
      if (fromDate) onDateModeChange({ kind: 'date', date: fromDate })
    } else if (fromDate && val >= fromDate) {
      const days = datesBetween(fromDate, val).length
      if (days <= MAX_RANGE_DAYS) onDateModeChange({ kind: 'range', from: fromDate, to: val })
    }
  }, [fromDate, onDateModeChange])

  const handleRecentClick = useCallback(() => {
    setFromDate('')
    setToDate('')
    onDateModeChange({ kind: 'recent' })
  }, [onDateModeChange])

  const handleTodayClick = useCallback(() => {
    setFromDate('')
    setToDate('')
    onDateModeChange({ kind: 'today' })
  }, [onDateModeChange])

  const hasGeneratorCodes = node.kind === 'substation' && allCodes.some(c => c.includes(' '))

  const effectiveCodes = useMemo(() => {
    const base = activeCodes ?? new Set(allCodes)
    if (!showGenerators) return new Set([...base].filter(c => !c.includes(' ')))
    return base
  }, [activeCodes, allCodes, showGenerators])

  useEffect(() => { setActiveCodes(null); setShowGenerators(true) }, [node])

  const chartData = useMemo(() => {
    if (!recentData || allCodes.length === 0) return null
    return extractChartData(recentData, allCodes)
  }, [recentData, allCodes])

  const { title, subtitle } = adapter
  const nodeKey = node.kind === 'generator' ? node.generator.site : node.substation.siteId

  const capacity = adapter.capacityMW(effectiveCodes)
  const normalCapacity = adapter.normalCapacityMW(effectiveCodes)
  const totalOutageMW = useMemo(
    () => [...effectiveCodes].reduce((sum, code) => sum + adapter.unitOutageMW(code), 0),
    [effectiveCodes, adapter],
  )
  const currentGeneration = useMemo(() => {
    if (!chartData || chartData.rows.length === 0) return null
    const lastRow = chartData.rows[chartData.rows.length - 1]
    return [...effectiveCodes]
      .filter(code => chartData.codes.includes(code))
      .reduce((sum, code) => sum + ((lastRow[code] as number) ?? 0), 0)
  }, [chartData, effectiveCodes])

  function toggleCode(code: string) {
    const next = new Set(effectiveCodes)
    if (next.has(code)) {
      if (next.size > 1) next.delete(code)
    } else {
      next.add(code)
    }
    setActiveCodes(next)
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    const series: Highcharts.SeriesOptionsType[] = chartData.codes.map((code, i) => ({
      type: adapter.chartType,
      name: adapter.labelFor(code),
      color: adapter.colourFor(code, i),
      visible: effectiveCodes.has(code),
      data: withGaps(chartData.rows.map((row) => [
        new Date((row.time as string) + 'Z').getTime(),
        adapter.transformValue(row[code] as number),
      ])),
      marker: { enabled: false },
      animation: false,
    }))

    if (showGenerators) series.push(...adapter.extraSeries(chartData.rows, chartData.codes))
    const capSeries = adapter.capacitySeries(chartData.rows, effectiveCodes)
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

    const midnightPlotLines: Highcharts.XAxisPlotLinesOptions[] = chartData.rows
      .filter((row, i) => {
        if (i === 0) return false
        return (row.time as string).slice(0, 10) !== (chartData.rows[i - 1].time as string).slice(0, 10)
      })
      .map((row) => ({
        value: new Date((row.time as string) + 'Z').getTime(),
        color: '#aaaaaa',
        width: 1,
        dashStyle: 'Solid',
        label: {
          text: Highcharts.dateFormat('%e %b', new Date((row.time as string) + 'Z').getTime()),
          style: { color: '#888888', fontSize: '10px' },
          y: 14,
        },
        zIndex: 3,
      }))

    return {
      chart: { type: adapter.chartType, height: null, animation: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: adapter.showLegend(chartData.codes.length), itemStyle: { fontSize: '11px', fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: { day: '%e %b', hour: '%I:%M %p', minute: '%I:%M %p' },
        plotLines: midnightPlotLines,
      },
      yAxis: adapter.yAxisOptions(effectiveCodes, chartData.rows),
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function () {
          const points = (this.points ?? []).filter((p) => p.series.name !== 'Net')
          const time = Highcharts.dateFormat('%e %b %I:%M %p', this.x as number)

          const pricingByMs = new Map<number, Record<string, number>>()
          if (recentData?.pricing) {
            const indices = chartData.codes.map((c) => recentData.series.indexOf(c) + 1)
            for (const row of recentData.pricing) {
              const ms = new Date((row[0] as string) + 'Z').getTime()
              const entry: Record<string, number> = {}
              chartData.codes.forEach((code, i) => { entry[code] = row[indices[i]] as number })
              pricingByMs.set(ms, entry)
            }
          }

          const priceAtTime = pricingByMs.get(this.x as number)

          const capMW = capacityAt(this.x as number)
          const capRow = capMW !== null ? `<br/><br/>Capacity: <b>${formatMW(capMW)}</b>` : ''

          let rows = "";

          if (points.length > 1) {
            rows = points
              .map((p) => {
                const val = formatMW(p.y ?? 0)
                const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
                const code = chartData.codes[p.series.index]
                const price = code !== undefined && priceAtTime ? priceAtTime[code] : undefined
                const priceStr = price !== undefined ? ` <span style="color:#888">$${price.toFixed(2)}/MWh</span>` : ''
                return `<span style="color:${String(p.color)}">●</span> ${p.series.name}: ${formatted}${priceStr}`
              })
              .join('<br/>');
          } else if (points.length === 1) {
            const p = points[0];
            const val = formatMW(p.y ?? 0)
            const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
            const code = chartData.codes[p.series.index]
            const price = code !== undefined && priceAtTime ? priceAtTime[code] : undefined
            const priceStr = price !== undefined ? ` <span style="color:#888">$${price.toFixed(2)}/MWh</span>` : ''
            const capacityRow = capMW !== null ? ` / <b>${formatMW(capMW)}</b>` : '';
            rows += `<span style="color:${String(p.color)}">●</span> ${formatted}${capacityRow}${priceStr}`
          }
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)
          const totalRow = points.length > 1 ? `<br/><br/>Total: <b>${formatMW(total)}</b>` : ''

          let resultHtml = `<b>${time}</b><br/>${rows}${totalRow}`;

          if (points.length > 1) {
            resultHtml += capRow;
          }

          return resultHtml;
        },
      },
      plotOptions: {
        area: {
          lineWidth: 1.5,
          fillOpacity: 0.8,
          stacking: adapter.stacking(chartData.codes.length),
        },
      },
      series,
    }
  }, [chartData, effectiveCodes, adapter, recentData, showGenerators])

  return (
    <div style={{ ...PANEL_STYLE, width: expanded ? '100vw' : panelWidth }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 6px' }}>
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
        {capacity !== null && normalCapacity !== null && currentGeneration !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignSelf: 'center', gap: 5, minWidth: 140, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#666', textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              {totalOutageMW > 0 ? (
                <>
                  <span>{currentGeneration.toFixed(0)} /</span>
                  <s style={{ color: '#aaa' }}>{normalCapacity.toFixed(0)} MW</s>
                  <span>{capacity.toFixed(0)} MW</span>
                  <span style={{
                    background: '#fee2e2',
                    color: '#b91c1c',
                    borderRadius: 4,
                    padding: '0 5px',
                    fontSize: 10,
                    fontWeight: 600,
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                  }}>
                    {totalOutageMW.toFixed(1)} MW Outage
                  </span>
                </>
              ) : (
                <span>{currentGeneration.toFixed(0)} / {capacity.toFixed(0)} MW ({capacity > 0 ? Math.round((currentGeneration / capacity) * 100) : 0}%)</span>
              )}
            </div>
            <div style={{ height: 6, background: '#e8e8e8', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              {allCodes.map((code, i) => {
                if (!effectiveCodes.has(code)) return null
                const lastRow = chartData?.rows[chartData.rows.length - 1]
                const val = lastRow ? ((lastRow[code] as number) ?? 0) : 0
                const outageMW = adapter.unitOutageMW(code)
                const colour = adapter.colourFor(code, i)
                const denom = normalCapacity > 0 ? normalCapacity : 1
                const genPct = (Math.abs(val) / denom) * 100
                const outagePct = (outageMW / denom) * 100
                return (
                  <span key={code} style={{ display: 'contents' }}>
                    <div style={{ height: '100%', width: `${genPct}%`, flexShrink: 0, background: colour }} />
                    {outagePct > 0 && (
                      <div style={{
                        height: '100%',
                        width: `${outagePct}%`,
                        flexShrink: 0,
                        background: `repeating-linear-gradient(45deg, ${colour}66 0, ${colour}66 2px, transparent 2px, transparent 5px)`,
                      }} />
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: '#666', padding: '2px 4px', flexShrink: 0 }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '⊠' : '⊞'}
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#666', padding: '2px 4px', flexShrink: 0 }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Date picker toolbar */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleTodayClick}
          style={{
            padding: '2px 10px',
            borderRadius: 10,
            border: '1px solid #ccc',
            background: dateMode.kind === 'today' ? '#f0f0f0' : 'white',
            color: '#444',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: dateMode.kind === 'today' ? 600 : 400,
            flexShrink: 0,
          }}
        >
          Today
        </button>
        <button
          onClick={handleRecentClick}
          style={{
            padding: '2px 10px',
            borderRadius: 10,
            border: '1px solid #ccc',
            background: dateMode.kind === 'recent' ? '#f0f0f0' : 'white',
            color: '#444',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: dateMode.kind === 'recent' ? 600 : 400,
            flexShrink: 0,
          }}
        >
          Last 3 days
        </button>
        <div style={{ width: 1, height: 16, background: '#ddd', flexShrink: 0 }} />
        <input
          type="date"
          value={fromDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => handleFromChange(e.target.value)}
          style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', color: '#333', background: 'white' }}
        />
        <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>–</span>
        <input
          type="date"
          value={toDate}
          min={fromDate || undefined}
          max={new Date().toISOString().slice(0, 10)}
          disabled={!fromDate}
          onChange={e => handleToChange(e.target.value)}
          style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', color: '#333', background: fromDate ? 'white' : '#f5f5f5' }}
        />
        {rangeError && (
          <span style={{ fontSize: 10, color: '#b91c1c', marginLeft: 4 }}>{rangeError}</span>
        )}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: '#888', flexShrink: 0 }}>
            Loading…
          </div>
        )}
        {error && allCodes.length !== 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: '#c00', flexShrink: 0 }}>
            Failed to load data
          </div>
        )}
      </div>

      {hasGeneratorCodes && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            onClick={() => setShowGenerators(v => !v)}
            style={{
              marginTop: 6,
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid #ccc',
              background: showGenerators ? '#f0f0f0' : 'white',
              color: '#444',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {showGenerators ? 'Hide generators' : 'Show generators'}
          </button>
        </div>
      )}

      {/* Unit selector (generators with multiple units) */}
      {adapter.showUnitSelector(allCodes.length) && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allCodes.map((code, i) => {
            const active = effectiveCodes.has(code)
            const colour = adapter.colourFor(code, i)
            return (
              <button
                key={code}
                onClick={() => toggleCode(code)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: `1.5px solid ${colour}`,
                  background: active ? colour : 'transparent',
                  color: active ? 'white' : colour,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {adapter.labelFor(code)}
              </button>
            )
          })}
        </div>
      )}

      {/* Chart area */}
      <div style={{ padding: '8px 0 0', flex: 1, minHeight: 0, height: '100%' }}>
        {loading && allCodes.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#888' }}>
            Loading…
          </div>
        )}
        {error && allCodes.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#c00' }}>
            Failed to load data
          </div>
        )}
        {!loading && !error && allCodes.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#888' }}>
            No data available
          </div>
        )}
        {chartOptions && (
          <HighchartsReact ref={chartRef} key={`${nodeKey}-${String(expanded)}`} highcharts={Highcharts} options={chartOptions} containerProps={{ style: { height: '100%' } }} />
        )}
      </div>
      {!expanded && (
        <div
          onMouseDown={onResizeHandleMouseDown}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 20 }}
        />
      )}
    </div>
  )
}
