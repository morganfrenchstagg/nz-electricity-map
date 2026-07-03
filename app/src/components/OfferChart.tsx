import { useMemo, useRef, useEffect } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { OffersData } from '../hooks/useOffers'
import type { SelectedNode, Generator } from '../types'
import { fuelColour } from '../utils/colours'
import { formatMW } from '../utils/format'

interface Props {
  offersData: OffersData
  tradingPeriod: number
  node: NonNullable<SelectedNode>
  generators: Generator[]
  panelWidth: number
}

function getUnitNodes(node: NonNullable<SelectedNode>): { node: string; fuel: string; label: string }[] {
  if (node.kind === 'generator') {
    return node.generator.units.map(u => ({ node: u.node, fuel: u.fuel, label: u.name }))
  }
  if (node.kind === 'generators') {
    return node.generators.flatMap(g => g.units.map(u => ({ node: u.node, fuel: u.fuel, label: `${g.name} — ${u.name}` })))
  }
  return []
}

export default function OfferChart({ offersData, tradingPeriod, node, panelWidth }: Props) {
  const chartRef = useRef<HighchartsReact.RefObject>(null)
  useEffect(() => { chartRef.current?.chart.reflow() }, [panelWidth])

  const chartOptions = useMemo((): Highcharts.Options | null => {
    const periodData = offersData.data[String(tradingPeriod)]
    if (!periodData) return null

    const unitNodes = getUnitNodes(node)
    if (unitNodes.length === 0) return null

    // Collect all tranches across all units
    const allTranches: { unit: typeof unitNodes[0]; price: number; mw: number; tranche: number }[] = []
    for (const unit of unitNodes) {
      const raw = periodData[unit.node]
      if (!raw) continue
      for (const offer of raw) {
        allTranches.push({ unit, price: offer.price, mw: offer.megawatts, tranche: offer.tranche })
      }
    }
    if (allTranches.length === 0) return null

    // Sort by price ascending (ties: stable by unit order)
    allTranches.sort((a, b) => a.price - b.price)

    // Assign cumulative x positions across the merged curve
    let cumMW = 0
    const positioned = allTranches.map(t => {
      const start = cumMW
      cumMW += t.mw
      return { ...t, start, end: cumMW }
    })

    // Group segments by unit, preserving merged-curve order
    const segsByUnit = new Map<string, { start: number; end: number; price: number; mw: number; tranche: number }[]>()
    for (const p of positioned) {
      const key = p.unit.node
      if (!segsByUnit.has(key)) segsByUnit.set(key, [])
      segsByUnit.get(key)!.push({ start: p.start, end: p.end, price: p.price, mw: p.mw, tranche: p.tranche })
    }

    const series: Highcharts.SeriesOptionsType[] = []
    for (const unit of unitNodes) {
      const segs = segsByUnit.get(unit.node)
      if (!segs || segs.length === 0) continue

      // Visual series: start/end pairs draw the shape; no mouse tracking so
      // the hover dot never snaps to start or end.
      const visualPoints: (Highcharts.PointOptionsObject | null)[] = []
      // Snap series: single midpoint per tranche; invisible but tracked so
      // the tooltip dot lands exactly in the centre of each tranche.
      const snapPoints: (Highcharts.PointOptionsObject | null)[] = []

      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        const custom = { mw: seg.mw, label: unit.label, tranche: seg.tranche }
        if (i > 0) { visualPoints.push(null); snapPoints.push(null) }
        visualPoints.push({ x: seg.start, y: seg.price })
        visualPoints.push({ x: seg.end, y: seg.price })
        snapPoints.push({ x: seg.start + seg.mw / 2, y: seg.price, custom })
      }

      series.push({
        type: 'area',
        name: unit.label,
        color: fuelColour(unit.fuel),
        fillOpacity: 0.8,
        data: visualPoints,
        marker: { enabled: false },
        connectNulls: false,
        enableMouseTracking: false,
        animation: false,
        lineWidth: 2,
      })

      // linkedTo: ':prev' shares the legend entry with the visual series above
      series.push({
        type: 'area',
        name: unit.label,
        color: fuelColour(unit.fuel),
        fillOpacity: 0,
        data: snapPoints,
        marker: { enabled: false },
        connectNulls: false,
        animation: false,
        lineWidth: 0,
        linkedTo: ':prev',
      })
    }

    if (series.length === 0) return null

    return {
      chart: { type: 'area', height: null, animation: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        title: { text: 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' }, formatter: function () { return formatMW(this.value as number) } },
        min: 0,
      },
      yAxis: {
        title: { text: '$/MWh', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' }, formatter: function () { return `$${(this.value as number).toFixed(0)}` } },
        min: 0,
        gridLineDashStyle: 'Dash',
      },
      tooltip: {
        useHTML: true,
        formatter: function () {
          const pts = (this.points ?? [this]) as Highcharts.TooltipFormatterContextObject[]
          const rows = pts.map(p => {
            const price = p.y as number
            const custom = (p.point as unknown as { custom?: { mw: number; label: string; tranche: number } }).custom
            if (!custom) return null
            const trancheStr = custom.tranche != null ? ` (tranche ${custom.tranche})` : ''
            return `<span style="color:${String(p.color)}">●</span> ${custom.label}${trancheStr}: <b>${formatMW(custom.mw)}</b> at <b>$${price.toFixed(2)}/MWh</b>`
          }).filter(Boolean)
          return rows.length ? rows.join('<br/>') : false
        },
        shared: true,
      },
      plotOptions: {
        area: { step: 'left' },
        series: { states: { inactive: { enabled: false } } },
      },
      series,
    }
  }, [offersData, tradingPeriod, node])

  if (!chartOptions) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 13 }}>
        No offers found for this trading period
      </div>
    )
  }

  return (
    <HighchartsReact
      ref={chartRef}
      key={`offers-${tradingPeriod}`}
      highcharts={Highcharts}
      options={chartOptions}
      containerProps={{ style: { height: '100%' } }}
    />
  )
}
