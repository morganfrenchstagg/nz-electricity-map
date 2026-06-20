import { useState, useMemo, useEffect, useCallback } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { SelectedNode } from '../types'
import { useRecentData } from '../hooks/useRecentData'
import { useDefinitions } from '../hooks/useDefinitions'
import { extractChartData } from '../utils/chart'
import { createGeneratorAdapter, createSubstationAdapter } from '../utils/nodeAdapter'

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

  const adapter = useMemo(
    () =>
      node.kind === 'generator'
        ? createGeneratorAdapter(node.generator)
        : createSubstationAdapter(node.substation, allGenerators),
    [node, allGenerators],
  )

  const allCodes = useMemo(
    () => (recentData ? adapter.getCodes(recentData) : []),
    [recentData, adapter],
  )

  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const [showGenerators, setShowGenerators] = useState(true)

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
      data: chartData.rows.map((row) => [
        new Date((row.time as string) + 'Z').getTime(),
        adapter.transformValue(row[code] as number),
      ]),
      marker: { enabled: false },
      animation: false,
    }))

    if (showGenerators) series.push(...adapter.extraSeries(chartData.rows, chartData.codes))

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
      chart: { type: adapter.chartType, height: '90%', margin: [8, 16, 40, 56], animation: false, darkMode: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: adapter.showLegend(chartData.codes.length), itemStyle: { fontSize: '11px', fontWeight: 'normal' } },
      xAxis: {
        type: 'datetime',
        labels: { style: { fontSize: '10px' } },
        dateTimeLabelFormats: { day: '%e %b', hour: '%I:%M %p', minute: '%I:%M %p' },
        plotLines: midnightPlotLines,
      },
      yAxis: adapter.yAxisOptions(effectiveCodes),
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
          stacking: adapter.stacking(chartData.codes.length),
        },
      },
      series,
    }
  }, [chartData, effectiveCodes, adapter, recentData, showGenerators])

  return (
    <div style={PANEL_STYLE}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{subtitle}</div>
        </div>
        {capacity !== null && currentGeneration !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignSelf: 'center', gap: 5, minWidth: 130, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#666', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {currentGeneration.toFixed(0)} / {capacity} MW ({capacity > 0 ? Math.round((currentGeneration / capacity) * 100) : 0}%)
            </div>
            <div style={{ height: 6, background: '#e8e8e8', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              {allCodes.map((code, i) => {
                if (!effectiveCodes.has(code)) return null
                const lastRow = chartData?.rows[chartData.rows.length - 1]
                const val = lastRow ? ((lastRow[code] as number) ?? 0) : 0
                const pct = capacity > 0 ? (val / capacity) * 100 : 0
                return (
                  <div key={code} style={{ height: '100%', width: `${pct}%`, flexShrink: 0, background: adapter.colourFor(code, i) }} />
                )
              })}
            </div>
          </div>
        )}
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#666', padding: '2px 4px', flexShrink: 0 }}
          aria-label="Close"
        >
          ×
        </button>
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
          <HighchartsReact key={nodeKey} highcharts={Highcharts} options={chartOptions} />
        )}
      </div>
    </div>
  )
}
