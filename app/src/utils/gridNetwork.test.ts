import { describe, expect, it } from 'vitest'
import { buildGridNetwork, sectionEndName } from './gridNetwork'
import type { GridNetwork, LngLat } from './gridNetwork'
import type { Substation } from '../types'

const site = (siteId: string, long: number, lat: number, extra: Partial<Substation> = {}): Substation =>
  ({ siteId, description: siteId.charAt(0) + siteId.slice(1).toLowerCase(), long, lat, type: 'ACSTN', gridZone: 1, island: 'north', ...extra })

let objectId = 0
const line = (code: string, kv: number, ...parts: LngLat[][]): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: parts },
  properties: { OBJECTID: ++objectId, MXLOCATION: code, designvolt: String(kv), type: code.endsWith('CBL') ? 'CABLE' : 'TRANSLINE', description: code },
})

const lines = (...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })

// About 8.4 km apart, east to west
const AAA = site('AAA', 175.0, -41.0)
const MMM = site('MMM', 175.1, -41.0)
const BBB = site('BBB', 175.2, -41.0)
const CCC = site('CCC', 175.3, -41.0)
// About 11 km south of MMM
const DDD = site('DDD', 175.1, -41.1)
const straight = (from: Substation, to: Substation): LngLat[] =>
  [[from.long, from.lat], [(from.long + to.long) / 2, (from.lat + to.lat) / 2], [to.long, to.lat]]

// Each section as its two ends, in order
const sectionsOf = (network: GridNetwork) =>
  network.sections.map((s) => `${s.line.code} ${[s.from, s.to].sort().join('-')}`).sort()

describe('buildGridNetwork', () => {
  it('connects the substations a line runs into, from each to the next along it', () => {
    const network = buildGridNetwork(lines(line('AAA-BBB-A', 220, straight(AAA, MMM), straight(MMM, BBB))), [AAA, MMM, BBB])
    expect(sectionsOf(network)).toEqual(['AAA-BBB-A AAA-MMM', 'AAA-BBB-A BBB-MMM'])
  })

  it('splits a part that runs past a place the line connects between the sections either side', () => {
    const tee = site('MMM', 175.1, -41.0, { type: 'TEE' })
    const network = buildGridNetwork(lines(line('AAA-CCC-A', 220, [[175.0, -41.0], [175.05, -41.0], [175.1, -41.0], [175.2, -41.0], [175.3, -41.0]])), [AAA, tee, CCC])
    const partsTo = (node: string) => network.sections.find((s) => s.from === node || s.to === node)!.parts
    expect(partsTo('AAA')).toEqual([[[175.0, -41.0], [175.05, -41.0], [175.1, -41.0]]])
    expect(partsTo('CCC')).toEqual([[[175.1, -41.0], [175.2, -41.0], [175.3, -41.0]]])
  })

  it('taps a tee off the lines passing it', () => {
    const tee = site('MMM', 175.1, -41.0005, { type: 'TEE' })
    const network = buildGridNetwork(lines(line('AAA-BBB-A', 220, straight(AAA, BBB))), [AAA, tee, BBB])
    expect(sectionsOf(network)).toEqual(['AAA-BBB-A AAA-MMM', 'AAA-BBB-A BBB-MMM'])
  })

  it('joins a deviation to the line it ends on', () => {
    const network = buildGridNetwork(lines(line('AAA-BBB-A', 220, straight(AAA, BBB)), line('DDD-DEV-A', 220, [[175.1, -41.1], [175.1, -41.0]])), [AAA, BBB, DDD])
    expect(sectionsOf(network)).toEqual(['AAA-BBB-A AAA-J0', 'AAA-BBB-A BBB-J0', 'DDD-DEV-A DDD-J0'])
    expect(network.nodes.get('J0')).toEqual([175.1, -41.0])
  })

  it("doesn't join a line to another circuit along its route, or one at another voltage", () => {
    const network = buildGridNetwork(lines(
      line('AAA-BBB-A', 220, straight(AAA, BBB)),
      line('AAA-BBB-B', 220, [[175.2, -41.0], [175.1, -41.0]]),
      line('DDD-DEV-A', 110, [[175.1, -41.1], [175.1, -41.0]]),
    ), [AAA, BBB, DDD])
    expect(sectionsOf(network)).toEqual(['AAA-BBB-A AAA-BBB'])
  })

  it('joins a substation left apart from its network to the nearest of its lines', () => {
    // QQQ is 190 m off the line, joined to it only by a line to PPP
    const QQQ = site('QQQ', 175.1, -41.0017)
    const PPP = site('PPP', 175.1, -41.03)
    const network = buildGridNetwork(lines(
      line('AAA-BBB-A', 220, straight(AAA, BBB)),
      line('BBB-CCC-A', 220, straight(BBB, CCC)),
      line('PPP-QQQ-A', 220, straight(PPP, QQQ)),
    ), [AAA, BBB, CCC, PPP, QQQ])
    expect(sectionsOf(network)).toEqual(['AAA-BBB-A AAA-QQQ', 'AAA-BBB-A BBB-QQQ', 'BBB-CCC-A BBB-CCC', 'PPP-QQQ-A PPP-QQQ'])
    expect(network.components).toHaveLength(1)
  })

  it('counts a substation off the network with the nearest on it, on its island', () => {
    const EEE = site('EEE', 175.05, -41.3)
    const FFF = site('FFF', 175.05, -41.25, { island: 'south' })
    const network = buildGridNetwork(lines(line('AAA-BBB-A', 220, straight(AAA, BBB))), [AAA, BBB, EEE, FFF])
    expect([...network.attachedTo]).toEqual([['EEE', 'AAA']])
  })

  it('leaves out the HVDC', () => {
    expect(buildGridNetwork(lines(line('AAA-BBB-A', 350, straight(AAA, BBB))), [AAA, BBB]).sections).toEqual([])
  })

  it('points each section from → to the way its line runs partway along it, whichever way it is drawn', () => {
    // Due south from AAA where it's nearest the middle, then south-east to DDD
    const route: LngLat[] = [[175.0, -41.0], [175.0, -41.04], [175.0, -41.05], [175.0, -41.06], [175.1, -41.1]]
    for (const drawn of [route, [...route].reverse()]) {
      const { from, arrow } = buildGridNetwork(lines(line('AAA-DDD-A', 220, drawn)), [AAA, DDD]).sections[0]
      expect(arrow.at).toEqual([175.0, -41.05])
      expect(arrow.bearing).toBeCloseTo(from === 'AAA' ? 180 : 0)
    }
  })
})

describe('sectionEndName', () => {
  const network = buildGridNetwork(lines(line('AAA-BBB-A', 220, straight(AAA, BBB)), line('DDD-DEV-A', 220, [[175.1, -41.1], [175.1, -41.0]])), [AAA, BBB, DDD])
  const index = (code: string, node: string) => network.sections.findIndex((s) => s.line.code === code && (s.from === node || s.to === node))
  const endAt = (i: number, node: string) => network.sections[i].from === node ? 'from' : 'to'

  it('names the substation at the end', () => {
    const i = index('AAA-BBB-A', 'AAA')
    expect(sectionEndName(network, i, endAt(i, 'AAA'))).toBe('Aaa')
  })

  it('names the next substation along the line beyond a junction', () => {
    const i = index('AAA-BBB-A', 'AAA')
    expect(sectionEndName(network, i, endAt(i, 'J0'))).toBe('Bbb')
  })

  it('names the line a junction joins, with no substation beyond it', () => {
    const i = index('DDD-DEV-A', 'DDD')
    expect(sectionEndName(network, i, endAt(i, 'J0'))).toBe('AAA-BBB-A')
  })
})
