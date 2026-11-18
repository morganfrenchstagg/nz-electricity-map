import { describe, expect, it } from 'vitest'
import { buildGridNetwork } from './gridNetwork'
import type { GridNetwork } from './gridNetwork'
import { estimateLineFlows, flowArrowsToGeoJson, siteInjections } from './lineFlows'
import type { RecentData, Substation } from '../types'

const site = (siteId: string, long: number, lat: number, island: Substation['island'] = 'north'): Substation =>
  ({ siteId, description: siteId, long, lat, type: 'ACSTN', gridZone: 1, island })

let objectId = 0
const line = (code: string, from: Substation, to: Substation): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[from.long, from.lat], [to.long, to.lat]] },
  properties: { OBJECTID: ++objectId, MXLOCATION: code, designvolt: '220', type: code.endsWith('CBL') ? 'CABLE' : 'TRANSLINE', description: code },
})

const network = (substations: Substation[], ...features: GeoJSON.Feature[]) =>
  buildGridNetwork({ type: 'FeatureCollection', features }, substations)

const TIME = '2026-11-05T20:00:00'

// One interval of dispatch, each node's MW: positive for generation, negative for load
const dispatch = (mw: Record<string, number>, hvdcNorth?: number): RecentData => ({
  series: Object.keys(mw),
  data: [[TIME, ...Object.values(mw)]],
  pricing: [],
  ...(hvdcNorth !== undefined && {
    hvdc: { series: ['northFlow', 'southFlow', 'northLimit', 'southLimit'], data: [[TIME, Math.max(hvdcNorth, 0), Math.max(-hvdcNorth, 0), 1200, -600]] },
  }),
})

// The MW flowing from one substation to the other along a line
const flowBetween = (net: GridNetwork, flows: number[], code: string, from: string, to: string) => {
  const i = net.sections.findIndex((s) => s.line.code === code && [s.from, s.to].sort().join() === [from, to].sort().join())
  return net.sections[i].from === from ? flows[i] : -flows[i]
}

const AAA = site('AAA', 175.0, -41.0)
const BBB = site('BBB', 175.1, -41.0)
const CCC = site('CCC', 175.2, -41.0)

describe('siteInjections', () => {
  it("adds up each substation's generation and load, and counts one off the network with the one it's attached to", () => {
    const EEE = site('EEE', 175.0, -41.2)
    const net = network([AAA, BBB, EEE], line('AAA-BBB-A', AAA, BBB))
    const injections = siteInjections(dispatch({ 'AAA2201 GEN0': 80, AAA0331: -30, BBB2201: -20, EEE0111: -10 }), net)
    expect(Object.fromEntries(injections)).toEqual({ AAA: 40, BBB: -20 })
  })
})

describe('estimateLineFlows', () => {
  it('carries what a substation makes to where it is used', () => {
    const net = network([AAA, BBB, CCC], line('AAA-BBB-A', AAA, BBB), line('BBB-CCC-A', BBB, CCC))
    const { sections: flows } = estimateLineFlows(net, dispatch({ 'AAA2201 GEN0': 100, BBB2201: -40, CCC2201: -60 }))
    expect(flowBetween(net, flows, 'AAA-BBB-A', 'AAA', 'BBB')).toBeCloseTo(100)
    expect(flowBetween(net, flows, 'BBB-CCC-A', 'BBB', 'CCC')).toBeCloseTo(60)
  })

  it('shares a flow between parallel lines by their reactance, more of it through a cable', () => {
    const net = network([AAA, BBB], line('AAA-BBB-A', AAA, BBB), line('AAA-BBB-B-CBL', AAA, BBB))
    const { sections: flows } = estimateLineFlows(net, dispatch({ 'AAA2201 GEN0': 110, BBB2201: -110 }))
    // Inversely to their reactance per km, 0.4 Ω overhead and 0.15 Ω in a cable
    expect(flowBetween(net, flows, 'AAA-BBB-A', 'AAA', 'BBB')).toBeCloseTo(30)
    expect(flowBetween(net, flows, 'AAA-BBB-B-CBL', 'AAA', 'BBB')).toBeCloseTo(80)
  })

  it('takes the losses as more load, shared between the loads', () => {
    const net = network([AAA, BBB, CCC], line('AAA-BBB-A', AAA, BBB), line('BBB-CCC-A', BBB, CCC))
    const { sections: flows } = estimateLineFlows(net, dispatch({ 'AAA2201 GEN0': 110, BBB2201: -60, CCC2201: -40 }))
    expect(flowBetween(net, flows, 'AAA-BBB-A', 'AAA', 'BBB')).toBeCloseTo(110)
    expect(flowBetween(net, flows, 'BBB-CCC-A', 'BBB', 'CCC')).toBeCloseTo(44)
  })

  describe('across the HVDC', () => {
    const BEN = site('BEN', 170.2, -44.5, 'south')
    const XXX = site('XXX', 170.3, -44.5, 'south')
    const HAY = site('HAY', 174.9, -41.2)
    const YYY = site('YYY', 175.0, -41.2)
    const net = network([BEN, XXX, HAY, YYY], line('BEN-XXX-A', BEN, XXX), line('HAY-YYY-A', HAY, YYY))

    it('takes its flow out of the South Island at Benmore, and into the North Island at Haywards', () => {
      const { sections: flows, hvdcNorth } = estimateLineFlows(net, dispatch({ 'XXX2201 GEN0': 500, YYY2201: -380 }, 400))
      expect(hvdcNorth).toBe(400)
      // Each island's losses are taken up by its load
      expect(flowBetween(net, flows, 'BEN-XXX-A', 'XXX', 'BEN')).toBeCloseTo(500)
      expect(flowBetween(net, flows, 'HAY-YYY-A', 'HAY', 'YYY')).toBeCloseTo(400)
    })

    it("has it balance the islands when there's no flow for it", () => {
      const { sections: flows, hvdcNorth } = estimateLineFlows(net, dispatch({ 'XXX2201 GEN0': 500, YYY2201: -460 }))
      expect(hvdcNorth).toBe(480)
      expect(flowBetween(net, flows, 'BEN-XXX-A', 'XXX', 'BEN')).toBeCloseTo(500)
      expect(flowBetween(net, flows, 'HAY-YYY-A', 'HAY', 'YYY')).toBeCloseTo(480)
    })
  })
})

describe('flowArrowsToGeoJson', () => {
  it('points each arrow the way its section flows, and leaves out those with nothing to the MW', () => {
    const net = network([AAA, BBB, CCC], line('AAA-BBB-A', AAA, BBB), line('BBB-CCC-A', BBB, CCC))
    // AAA-BBB-A flows west, from BBB to AAA, and BBB-CCC-A has under half a MW
    const flows = net.sections.map((s) => s.line.code === 'AAA-BBB-A' ? (s.from === 'BBB' ? 50 : -50) : 0.2)
    const arrows = flowArrowsToGeoJson(net, flows).features
    expect(arrows).toHaveLength(1)
    expect(arrows[0].properties).toEqual({ mw: 50, bearing: expect.closeTo(270) })
  })
})
