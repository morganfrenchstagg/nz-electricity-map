import { useState, useMemo, useCallback } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import { useDispatchData, datesBetween, MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { useDefinitions } from '../hooks/useDefinitions'
import { fuelCodeColour, fuelCodeLabel } from '../utils/colours'

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: 24,
  width: '50vw',
  maxHeight: 'calc(100vh - 48px)',
  background: 'white',
  borderRadius: 8,
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
}

export default function GridOverviewPanel({ dateMode, onDateModeChange, onClose }: Props) {
  const { recentData, loading, error } = useDispatchData(dateMode)
  const { generators } = useDefinitions()

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

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!recentData || generators.length === 0) return null

    // Build fuel → column-index map (col 0 is timestamp, so series idx + 1)
    const fuelToIndices = new Map<string, number[]>()
    for (const gen of generators) {
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
      fillOpacity: 0.8,
      lineWidth: 1,
      data: recentData.data.map(row => [
        new Date((row[0] as string) + 'Z').getTime(),
        (fuelToIndices.get(fuel)!).reduce((sum, i) => sum + (((row[i] as number) || 0)), 0),
      ]),
      marker: { enabled: false },
      animation: false,
    }))

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
      chart: { type: 'area', height: '90%', margin: [8, 16, 40, 56], animation: false, darkMode: false, backgroundColor: '#ffffff' },
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
          const rows = points
            .slice()
            .reverse()
            .map(p => {
              const val = `${(p.y ?? 0).toFixed(1)} MW`
              const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
              return `<span style="color:${String(p.color)}">●</span> ${p.series.name}: ${formatted}`
            })
            .join('<br/>')
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)
          return `<b>${time}</b><br/>${rows}<br/><b>Total: ${total.toFixed(1)} MW</b>`
        },
      },
      series,
    }
  }, [recentData, generators])

  return (
    <div style={PANEL_STYLE}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>NZ Grid Generation</div>
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
          Recent
        </button>
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
      </div>

      {/* Chart area */}
      <div style={{ padding: '8px 0 0' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#888' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#c00' }}>
            Failed to load data
          </div>
        )}
        {chartOptions && (
          <HighchartsReact highcharts={Highcharts} options={chartOptions} />
        )}
      </div>
    </div>
  )
}
