import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { datesBetween, MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import type { RecentData } from '../types'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel } from '../utils/colours'
import { withGaps } from '../utils/chart'
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

const FUEL_ORDER = ['BESS', 'DIE', 'HYD', 'SOL', 'WIN', 'GAS', 'CLG', 'GEO', 'BESS-C']

interface Props {
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  onClose: () => void
  visible: boolean
  recentData: RecentData | null
  loading: boolean
  error: string | null
  panelWidth: number
  onResizeHandleMouseDown: (e: React.MouseEvent) => void
}

export default function GridOverviewPanel({ dateMode, onDateModeChange, onClose, visible, recentData, loading, error, panelWidth, onResizeHandleMouseDown }: Props) {
  const { generators, substations } = useDefinitions()
  const [island, setIsland] = useState<'all' | 'NI' | 'SI'>('all')
  const [expanded, setExpanded] = useState(false)
  const chartRef = useRef<HighchartsReact.RefObject>(null)

  useEffect(() => { chartRef.current?.chart.reflow() }, [panelWidth])

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

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!recentData || generators.length === 0) return null

    // Build fuel → column-index map (col 0 is timestamp, so series idx + 1)
    const fuelToIndices = new Map<string, number[]>()
    for (const gen of generators) {
      if (island !== 'all' && gen.island !== island) continue
      for (const unit of gen.units) {
        if (unit.active === false) continue
        const idx = recentData.series.indexOf(unit.node)
        if (idx === -1) continue
        const existing = fuelToIndices.get(unit.fuelCode) ?? []
        fuelToIndices.set(unit.fuelCode, [...existing, idx + 1])
      }
    }

    const fuels = [
      ...FUEL_ORDER.filter(f => fuelToIndices.has(f)),
      ...[...fuelToIndices.keys()].filter(f => !FUEL_ORDER.includes(f)),
    ]

    const series: Highcharts.SeriesOptionsType[] = fuels.map(fuel => ({
      type: 'area',
      name: fuelCodeLabel(fuel),
      color: fuelCodeColour(fuel),
      stacking: 'normal',
      stack: (fuel === "BESS-C") ? "positive" : "negative",
      fillOpacity: 0.8,
      lineWidth: 1,
      data: withGaps(recentData.data.map(row => [
        new Date((row[0] as string) + 'Z').getTime(),
        (fuelToIndices.get(fuel)!).reduce((sum, i) => sum + (((row[i] as number) || 0)), 0),
      ])),
      marker: { enabled: false },
      animation: false,
    }))

    /*
    if (island !== 'all') {
      const allGenIndices = [...fuelToIndices.values()].flat()
      const islandSubstations = substations.filter(s =>
        island === 'NI' ? s.island === 'north' : s.island === 'south'
      )
      const subIndices: number[] = []
      for (const sub of islandSubstations) {
        for (const code of substationCodes(recentData, sub.siteId)) {
          const idx = recentData.series.indexOf(code)
          if (idx !== -1) subIndices.push(idx + 1)
        }
      }
      // Pre-compute per-row gen and load so tooltip can show both legs
      const hvdcData = recentData.data.map(row => {
        const genMW = allGenIndices.reduce((s, i) => s + ((row[i] as number) || 0), 0)
        const loadMW = subIndices.reduce((s, i) => s - ((row[i] as number) || 0), 0)
        const hvdc = loadMW - genMW
        return { ts: new Date((row[0] as string) + 'Z').getTime(), genMW, loadMW, hvdc }
      })
      series.push({
        type: 'area',
        name: 'HVDC export',
        color: '#6366f1',
        stack: 'positive',
        data: hvdcData.map(d => ({ x: d.ts, y: (d.loadMW < 0 ? d.loadMW : 0), custom: { genMW: d.genMW, loadMW: d.loadMW } })),
        marker: { enabled: false },
        animation: false,
      } as Highcharts.SeriesLineOptions)

      series.push({
        type: 'area',
        name: 'HVDC import',
        color: '#6366f1',
        stack: 'negative',
        data: hvdcData.map(d => ({ x: d.ts, y: (d.loadMW > 0 ? d.loadMW : 0), custom: { genMW: d.genMW, loadMW: d.loadMW } })),
        marker: { enabled: false },
        animation: false,
      } as Highcharts.SeriesLineOptions)
    }
      */


    // Build per-timestamp renewable percentage
    const RENEWABLE_FUEL_CODES = new Set(['HYD', 'GEO', 'WIN', 'SOL', 'BESS'])
    const renewableIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => RENEWABLE_FUEL_CODES.has(fuel))
      .flatMap(([, indices]) => indices)
    const dispatchIndices = [...fuelToIndices.entries()]
      .filter(([fuel]) => fuel !== 'BESS-C')
      .flatMap(([, indices]) => indices)
    const renewablePctByMs = new Map<number, number>()
    for (const row of recentData.data) {
      const ms = new Date((row[0] as string) + 'Z').getTime()
      const totalMW = dispatchIndices.reduce((s, i) => s + ((row[i] as number) || 0), 0)
      const renewableMW = renewableIndices.reduce((s, i) => s + ((row[i] as number) || 0), 0)
      renewablePctByMs.set(ms, totalMW > 0 ? (renewableMW / totalMW) * 100 : 0)
    }

    // Build per-timestamp pricing lookup for Otahuhu (NI reference) and Benmore (SI reference)
    const otaIdx = recentData.series.findIndex(s => s.startsWith('OTA'))
    const benIdx = recentData.series.findIndex(s => s.startsWith('BEN'))
    const refPricingByMs = new Map<number, { ota: number | null; ben: number | null }>()
    for (const row of (recentData.pricing ?? [])) {
      const ms = new Date((row[0] as string) + 'Z').getTime()
      refPricingByMs.set(ms, {
        ota: otaIdx >= 0 ? (row[otaIdx + 1] as number ?? null) : null,
        ben: benIdx >= 0 ? (row[benIdx + 1] as number ?? null) : null,
      })
    }

    const midnightPlotLines: Highcharts.XAxisPlotLinesOptions[] = recentData.data
      .filter((row, i) => {
        if (i === 0) return false
        return (row[0] as string).slice(0, 10) !== (recentData.data[i - 1][0] as string).slice(0, 10)
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

    return {
      chart: { type: 'area', height: null, animation: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { fontSize: '11px', fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: { day: '%e %b', hour: '%I:%M %p', minute: '%I:%M %p' },
        plotLines: midnightPlotLines,
      },
      yAxis: {
        title: { text: 'MW', style: { fontSize: '11px' } },
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
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function () {
          const points = this.points ?? []
          const time = Highcharts.dateFormat('%e %b %I:%M %p', this.x as number)
          //const isHvdc = (p: { series: { name: string } }) => p.series.name.startsWith('HVDC')
          //const hvdcPoint = points.find(p => isHvdc(p) && (p.y ?? 0) !== 0)
          //const fuelPoints = points.filter(p => !isHvdc(p))
          const rows = points
            .slice()
            .map(p => {
              const val = formatMW(p.y ?? 0)
              const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
              return `<span style="color:${String(p.color)}">●</span> ${p.series.name}: ${formatted}`
            })
            .join('<br/>')
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)
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
          return `<b>${time}</b><br/>${rows}<br/><br/>Total: <b>${formatMW(total)}</b>${renewableRow}${priceRow}`
        },
      },
      series,
    }
  }, [recentData, generators, substations, island])

  return (
    <div style={{ ...PANEL_STYLE, display: visible ? 'flex' : 'none', width: expanded ? '100vw' : panelWidth }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>NZ Grid Generation</div>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#666', padding: '4px 6px', flexShrink: 0, borderRadius: 4 }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? 'Show map' : 'Expand'}
        </button>
        <button
          onClick={onClose}
          style={{ backgroundColor: '#e7e7e7', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#666', padding: '4px 6px', flexShrink: 0, borderRadius: 4 }}
          aria-label="Close"
        >
          Close
        </button>
      </div>

      {/* Island + date picker toolbar */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
        {(['all', 'NI', 'SI'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setIsland(opt)}
            style={{
              padding: '2px 10px',
              borderRadius: 10,
              border: '1px solid #ccc',
              background: island === opt ? '#f0f0f0' : 'white',
              color: '#444',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: island === opt ? 600 : 400,
              flexShrink: 0,
            }}
          >
            {opt === 'all' ? 'All' : opt === 'NI' ? 'North Island' : 'South Island'}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: '#ddd', flexShrink: 0 }} />
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#c00' }}>
            Failed to load data
          </div>
        )}
      </div>

      {/* Chart area */}
      <div style={{ padding: '8px 0 0', flex: 1, minHeight: 0, height: '100%' }}>
        {loading && !recentData && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: '#888' }}>
            Loading…
          </div>
        )}
        {error && !recentData && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, color: '#c00' }}>
            Failed to load data
          </div>
        )}
        {chartOptions && (
          <HighchartsReact ref={chartRef} key={String(expanded)} highcharts={Highcharts} options={chartOptions} containerProps={{ style: { height: '100%' } }} />
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
