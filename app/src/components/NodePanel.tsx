import { useState, useMemo } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { SelectedNode } from '../types'
import { useRecentData } from '../hooks/useRecentData'
import { extractChartData, substationCodes } from '../utils/chart'
import { fuelColour } from '../utils/colours'

const SUBSTATION_COLOURS = [
  '#e15759', '#4e79a7', '#f28e2b', '#76b7b2',
  '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
]

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

interface Props {
  node: NonNullable<SelectedNode>
  onClose: () => void
}

export default function NodePanel({ node, onClose }: Props) {
  const { recentData, loading, error } = useRecentData()

  const allCodes = useMemo(() => {
    if (!recentData) return []
    if (node.kind === 'generator') {
      return node.generator.units
        .filter((u) => u.active !== false)
        .map((u) => u.node)
        .filter((c) => recentData.series.includes(c))
    }
    return substationCodes(recentData, node.substation.siteId)
  }, [recentData, node])

  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const effectiveCodes = activeCodes ?? new Set(allCodes)

  const chartData = useMemo(() => {
    if (!recentData || allCodes.length === 0) return null
    return extractChartData(recentData, allCodes)
  }, [recentData, allCodes])

  const title = node.kind === 'generator' ? node.generator.name : node.substation.description
  const subtitle = node.kind === 'generator' ? node.generator.operator : node.substation.siteId

  function toggleCode(code: string) {
    const next = new Set(effectiveCodes)
    if (next.has(code)) {
      if (next.size > 1) next.delete(code)
    } else {
      next.add(code)
    }
    setActiveCodes(next)
  }

  function labelFor(code: string): string {
    if (node.kind === 'generator') {
      const unit = node.generator.units.find((u) => u.node === code)
      if (unit) return unit.name
    }
    return code.includes(' ') ? code.split(' ')[1] : code
  }

  function colourFor(code: string, index: number): string {
    if (node.kind === 'generator') {
      const unit = node.generator.units.find((u) => u.node === code)
      return unit ? fuelColour(unit.fuel) : SUBSTATION_COLOURS[index % SUBSTATION_COLOURS.length]
    }
    return SUBSTATION_COLOURS[index % SUBSTATION_COLOURS.length]
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    const series: Highcharts.SeriesLineOptions[] = chartData.codes.map((code, i) => ({
      type: 'area',
      name: labelFor(code),
      color: colourFor(code, i),
      visible: effectiveCodes.has(code),
      data: chartData.rows.map((row) => [
        new Date(row.time as string).getTime(),
        row[code] as number,
      ]),
      marker: { enabled: false },
      animation: false,
    }))

    return {
      chart: { type: 'area', height: 360, margin: [8, 16, 40, 56], animation: false, darkMode: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: chartData.codes.length > 1, itemStyle: { fontSize: '11px', fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: { day: '%e %b', hour: '%H:%M' },
      },
      yAxis: {
        title: { text: 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
      },
      tooltip: {
        shared: true,
        xDateFormat: '%e %b %H:%M',
        valueSuffix: ' MW',
        valueDecimals: 1,
      },
      plotOptions: { area: { lineWidth: 1.5, fillOpacity: 0.2 } },
      series,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, effectiveCodes])

  return (
    <div style={PANEL_STYLE}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{subtitle}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#666', padding: '2px 4px', flexShrink: 0 }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Unit selector (generators with multiple units) */}
      {node.kind === 'generator' && allCodes.length > 1 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allCodes.map((code, i) => {
            const active = effectiveCodes.has(code)
            const colour = colourFor(code, i)
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
                {code.includes(' ') ? code.split(' ')[1] : code}
              </button>
            )
          })}
        </div>
      )}

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
        {!loading && !error && allCodes.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#888' }}>
            No data available
          </div>
        )}
        {chartOptions && (
          <HighchartsReact highcharts={Highcharts} options={chartOptions} />
        )}
      </div>
    </div>
  )
}
