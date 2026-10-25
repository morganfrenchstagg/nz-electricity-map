import { useMemo } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { OffersData } from '../api'
import type { GeneratorNode, RecentData } from '../types'
import { tradingPeriodDispatch } from '../hooks/useOffers'
import { fuelColour } from '../utils/colours'
import { formatMW } from '../utils/format'
import { CHART_CONTAINER_PROPS, FIT_TO_CONTAINER, chartAccessibility } from '../utils/chart'

// The lines marking where the offers were dispatched, labelled with a white
// outline so they read over the offers
const DISPATCH_COLOUR = '#333333'
const DISPATCH_LABEL_STYLE = { color: DISPATCH_COLOUR, fontSize: 'var(--font-size-2xs)', fontWeight: '600', textOutline: '3px #ffffff', whiteSpace: 'nowrap' }

interface Props {
  offersData: OffersData
  // The dispatch the day of the offers, to mark where they were dispatched
  dispatch: RecentData | null
  tradingPeriod: number
  node: GeneratorNode
  // The generator or generators, as the panel's header names them
  title: string
}

// A tranche's snap point carries what its tooltip and screen reader description say
interface Tranche {
  mw: number
  label: string
  tranche: number
  price: number
}

// e.g. "1 unit", "2 units"
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// log10(price + 0.01) + 2 maps $0→0, $0.01→0.30, $1→2.0, $100→4.0, $6000→5.78
// The +0.01 offset and +2 shift give $0 vs $0.01 meaningful visual separation
function priceY(price: number): number {
  return Math.log10(price + 0.01) + 2
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}/MWh`
}

function trancheOf(point: Highcharts.Point): Tranche | undefined {
  return (point as unknown as { custom?: Tranche }).custom
}

// A tranche's unit, size and price, for its tooltip row and, without the HTML,
// its screen reader description
function trancheText(custom: Tranche): string {
  const trancheStr = custom.tranche != null ? ` (tranche ${custom.tranche})` : ''
  return `${custom.label}${trancheStr}: <b>${formatMW(custom.mw)}</b> at <b>${formatPrice(custom.price)}</b>`
}

function getUnitNodes(node: GeneratorNode): { node: string; fuel: string; label: string }[] {
  if (node.kind === 'generator') {
    return node.generator.units.map(u => ({ node: u.node, fuel: u.fuel, label: u.name }))
  }
  return node.generators.flatMap(g => g.units.map(u => ({ node: u.node, fuel: u.fuel, label: `${g.name} — ${u.name}` })))
}

export default function OfferChart({ offersData, dispatch, tradingPeriod, node, title }: Props) {
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
        const custom: Tranche = { mw: seg.mw, label: unit.label, tranche: seg.tranche, price: seg.price }
        const displayY = priceY(seg.price)
        if (i > 0) { visualPoints.push(null); snapPoints.push(null) }
        visualPoints.push({ x: seg.start, y: displayY })
        visualPoints.push({ x: seg.end, y: displayY })
        snapPoints.push({ x: seg.start + seg.mw / 2, y: displayY, custom })
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
        // Screen readers get the snap series' tranches instead
        accessibility: { enabled: false },
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
        accessibility: {
          point: { descriptionFormatter: (point) => { const custom = trancheOf(point); return custom ? trancheText(custom) : '' } },
        },
      })
    }

    if (series.length === 0) return null

    // allTranches is sorted by price
    const minPrice = `$${allTranches[0].price.toFixed(2)}`
    const maxPrice = `$${allTranches[allTranches.length - 1].price.toFixed(2)}`

    // Where the units offering were dispatched, if the dispatch has the period
    const dispatched = dispatch && tradingPeriodDispatch(dispatch, [...segsByUnit.keys()], offersData.date, tradingPeriod)
    const dispatchedPrice = dispatched?.price ?? null
    // Past halfway across, the MW line's label goes on its left, and the price's
    // label on the chart's left, clear of the MW line
    const dispatchedRight = dispatched !== null && dispatched.mw > Math.max(cumMW, dispatched.mw) / 2

    return {
      chart: { ...FIT_TO_CONTAINER, type: 'area', height: null, animation: false, backgroundColor: '#ffffff' },
      title: { text: undefined },
      ...chartAccessibility(`${title} offers, trading period ${tradingPeriod}`, {
        // Rather than counting the drawn series, which screen readers don't get
        typeDescription: `Offers from ${plural(segsByUnit.size, 'unit')}.`,
        description: 'Each unit\'s offer tranches from cheapest to dearest, by the MW offered and its price in $/MWh, on a log scale.'
          + (dispatched
            ? ` Averaged over the period, they were dispatched ${formatMW(dispatched.mw)}${dispatchedPrice !== null ? ` at ${formatPrice(dispatchedPrice)}` : ''}.`
            : ''),
        // Rather than counting the nulls between its tranches as points
        series: { descriptionFormatter: (s) => `${s.name}, ${plural(s.points.filter(trancheOf).length, 'tranche')}.` },
      }),
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        title: { text: 'MW' },
        labels: { formatter: function () { return formatMW(this.value as number) } },
        min: 0,
        // So the dispatch line shows even past the offers
        softMax: dispatched?.mw,
        plotLines: dispatched ? [{
          value: dispatched.mw,
          width: 2,
          color: DISPATCH_COLOUR,
          dashStyle: 'Dash',
          zIndex: 5,
          label: {
            text: `Dispatched ${formatMW(dispatched.mw)}`,
            rotation: 0,
            align: dispatchedRight ? 'right' : 'left',
            x: dispatchedRight ? -5 : 5,
            y: 14,
            style: DISPATCH_LABEL_STYLE,
          },
        }] : [],
        accessibility: {
          description: 'MW offered, cumulatively',
          rangeDescription: `Offers total ${formatMW(cumMW)}.`,
        },
      },
      yAxis: {
        type: 'linear',
        title: { text: '$/MWh' },
        min: 0,
        // Tick positions use the same transform: log10(price + 0.01) + 2
        tickPositions: [0, 0.01, 0.1, 1, 10, 50, 100, 500, 1000, 3000, 6000, 10000].map(priceY),
        labels: {
          formatter: function () {
            // Inverse: price = 10^(value - 2) - 0.01
            const price = Math.pow(10, (this.value as number) - 2) - 0.01
            if (price < 0.005) return '$0'
            if (price < 1) return `$${price.toFixed(2)}`
            if (price < 10) return `$${price.toFixed(1)}`
            return `$${Math.round(price)}`
          },
        },
        gridLineDashStyle: 'Dash',
        plotLines: [{
          value: 0,
          width: 1,
          color: '#999',
          zIndex: 3,
        }, ...(dispatchedPrice !== null ? [{
          // A negative price is drawn at $0, the axis' foot
          value: priceY(Math.max(0, dispatchedPrice)),
          width: 2,
          color: DISPATCH_COLOUR,
          dashStyle: 'Dash' as const,
          zIndex: 5,
          label: {
            text: formatPrice(dispatchedPrice),
            align: dispatchedRight ? 'left' as const : 'right' as const,
            x: dispatchedRight ? 4 : -4,
            y: -6,
            style: DISPATCH_LABEL_STYLE,
          },
        }] : [])],
        // The axis' values are the log-scaled prices, so describe the prices themselves
        accessibility: {
          description: 'Price in $/MWh',
          rangeDescription: minPrice === maxPrice
            ? `All offered at ${minPrice}/MWh.`
            : `Prices range from ${minPrice} to ${maxPrice}/MWh.`,
        },
      },
      tooltip: {
        useHTML: true,
        formatter: function () {
          const pts = this.points ?? [this]
          const rows = pts.map(p => {
            const custom = trancheOf(p)
            if (!custom) return null
            return `<span style="color:${String(p.color)}">●</span> ${trancheText(custom)}`
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
  }, [offersData, dispatch, tradingPeriod, node, title])

  if (!chartOptions) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)' }}>
        No offers found for this trading period
      </div>
    )
  }

  return (
    <HighchartsReact
      key={`offers-${tradingPeriod}`}
      highcharts={Highcharts}
      options={chartOptions}
      containerProps={CHART_CONTAINER_PROPS}
    />
  )
}
