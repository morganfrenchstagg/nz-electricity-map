import { useState, useMemo } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { SelectedNode } from '../types'
import { useRecentData } from '../hooks/useRecentData'
import { useDefinitions } from '../hooks/useDefinitions'
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
  const { generators: allGenerators } = useDefinitions()

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

  const title = node.kind === 'generator' ? node.generator.name : `${node.substation.description} Substation`
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
    if (node.kind === 'substation') {
      // Generator node connected to this substation (code contains a space)
      if (code.includes(' ')) {
        for (const gen of allGenerators) {
          const unit = gen.units.find((u) => u.node === code)
          if (unit) return `${unit.name}`
        }
      }
      // Regular busbar: decode VVVu suffix → e.g. "0331" → "33kV - 1"
      if (code.length >= 4) {
        const suffix = code.slice(-4)
        const voltage = parseInt(suffix.slice(0, 3), 10)
        const unit = parseInt(suffix.slice(3), 10)
        return `${voltage}kV - ${unit}`
      }
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
      type: node.kind === 'substation' ? 'line' : 'area',
      name: labelFor(code),
      color: colourFor(code, i),
      visible: effectiveCodes.has(code),
      data: chartData.rows.map((row) => [
        new Date((row.time as string) + 'Z').getTime(),
        node.kind === 'substation' ? -(row[code] as number) : (row[code] as number),
      ]),
      marker: { enabled: false },
      animation: false,
    }))

    if (node.kind === 'substation' && chartData.codes.some((c) => c.includes(' '))) {
      series.push({
        type: 'line',
        name: 'Net',
        color: '#222222',
        lineWidth: 2,
        zIndex: 5,
        data: chartData.rows.map((row) => [
          new Date((row.time as string) + 'Z').getTime(),
          chartData.codes.reduce((sum, code) => sum + (-(row[code] as number)), 0),
        ]),
        marker: { enabled: false },
        animation: false,
      })
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
        dashStyle: 'Dash',
        label: {
          text: Highcharts.dateFormat('%e %b', new Date((row.time as string) + 'Z').getTime()),
          style: { color: '#888888', fontSize: '10px' },
          y: 14,
        },
        zIndex: 3,
      }))

    return {
      chart: { type: node.kind === 'substation' ? 'line' : 'area', height: '90%', margin: [8, 16, 40, 56], animation: false, darkMode: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: chartData.codes.length > 1, itemStyle: { fontSize: '11px', fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: { day: '%e %b', hour: '%I:%M %p', minute: '%I:%M %p' },
        plotLines: midnightPlotLines,
      },
      yAxis: {
        title: { text: node.kind === 'substation' ? 'Load (MW)' : 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
        ...(node.kind === 'generator' ? (() => {
          const totalCapacity = node.generator.units
            .filter((u) => u.active !== false)
            .reduce((sum, u) => sum + u.capacity, 0)
          return {
            softMax: totalCapacity + 1,
            plotLines: [{
              value: totalCapacity,
              color: '#999999',
              width: 1,
              dashStyle: 'Dash',
              label: {
                text: `Capacity: ${totalCapacity} MW`,
                style: { color: '#999999', fontSize: '10px' },
                align: 'right',
                x: -4,
              },
              zIndex: 3,
            }],
          }
        })() : {}),
      },
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function () {
          const points = (this.points ?? []).filter((p) => p.series.name !== 'Net')
          const time = Highcharts.dateFormat('%e %b %I:%M %p', this.x as number)

          // Build pricing lookup keyed by ms timestamp for the relevant codes
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

          const rows = points
            .map((p) => {
              const val = `${(p.y ?? 0).toFixed(1)} MW`
              const formatted = (p.y ?? 0) === 0 ? val : `<b>${val}</b>`
              const code = chartData.codes[p.series.index]
              const price = code !== undefined && priceAtTime ? priceAtTime[code] : undefined
              const priceStr = price !== undefined ? ` <span style="color:#888">$${price.toFixed(2)}/MWh</span>` : ''
              return `<span style="color:${String(p.color)}">●</span> ${p.series.name}: ${formatted}${priceStr}`
            })
            .join('<br/>')
          const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0)
          const totalRow = points.length > 1 ? `<br/><b>Total: ${total.toFixed(1)} MW</b>` : ''
          return `<b>${time}</b><br/>${rows}${totalRow}`
        },
      },
      plotOptions: {
        area: {
          lineWidth: 1.5,
          fillOpacity: 0.35,
          stacking: node.kind === 'generator' && chartData.codes.length > 1 ? 'normal' : undefined,
        },
      },
      series,
    }
  }, [chartData, effectiveCodes, node, recentData, allGenerators])

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
