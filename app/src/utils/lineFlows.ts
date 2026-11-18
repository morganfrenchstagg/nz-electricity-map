import type { RecentData } from '../types'
import type { GridNetwork } from './gridNetwork'
import { HVDC_SITES, latestHvdcNorth } from './hvdc'

// An estimate of the power flowing along each section of the transmission
// network (see gridNetwork) at the newest of the dispatch's intervals, from
// what each substation puts into it or takes out of it: a DC power flow. Power
// shares itself between the ways it can go by their reactance, as it does
// through a meshed AC network. It leaves out losses, voltages, and the lines
// run open to steer it, so it's only an estimate.

// A node's code starts with its site's, e.g. ATI2201 ATI0 is at ATI
const siteOf = (code: string) => code.slice(0, 3)

// The MW each substation puts into the network at the newest interval: its
// generators' output less its buses' load, which they give as negative. Those
// off the network are counted at the one they're attached to.
export function siteInjections(data: RecentData, network: GridNetwork): Map<string, number> {
  const injections = new Map<string, number>()
  const row = data.data[data.data.length - 1]
  if (!row) return injections
  data.series.forEach((code, i) => {
    const site = network.attachedTo.get(siteOf(code)) ?? siteOf(code)
    injections.set(site, (injections.get(site) ?? 0) + (Number(row[i + 1]) || 0))
  })
  return injections
}

// The transfer north that leaves each island as short as the other of what
// it makes, for an interval without the HVDC's flow, e.g. a day em6 and EMI
// have none for. Each island's injections fall short of nothing by its losses.
function balancingTransfer(injections: Map<string, number>, network: GridNetwork): number {
  let south = 0
  let north = 0
  for (const [site, mw] of injections) {
    const island = network.substations.get(site)?.island
    if (island === 'south') south += mw
    else if (island === 'north') north += mw
  }
  return (south - north) / 2
}

// Solves a·x = b by Gaussian elimination, for a small dense system
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    if (m[col][col] === 0) continue
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    if (m[r][r] === 0) continue
    let sum = m[r][n]
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c]
    x[r] = sum / m[r][r]
  }
  return x
}

export interface LineFlows {
  // The MW flowing along each of the network's sections, from → to, or negative
  // where it flows to → from
  sections: number[]
  // The HVDC's transfer north they're estimated with (MW), negative for south
  hvdcNorth: number
}

// The HVDC takes its flow out of one island's network at its converter station
// and puts it into the other's. Each network's injections don't quite add up to
// nothing, for its losses, so its loads are taken as that much more, in proportion.
export function estimateLineFlows(network: GridNetwork, data: RecentData): LineFlows {
  const injections = siteInjections(data, network)
  const north = latestHvdcNorth(data)?.mw ?? balancingTransfer(injections, network)
  injections.set(HVDC_SITES.south, (injections.get(HVDC_SITES.south) ?? 0) - north)
  injections.set(HVDC_SITES.north, (injections.get(HVDC_SITES.north) ?? 0) + north)

  const flows = network.sections.map(() => 0)
  for (const component of network.components) {
    const index = new Map(component.nodes.map((node, i) => [node, i]))
    const p = component.nodes.map((node) => injections.get(node) ?? 0)
    const mismatch = p.reduce((sum, mw) => sum + mw, 0)
    const load = -p.reduce((sum, mw) => sum + Math.min(mw, 0), 0)
    const balanced = p.map((mw) => load > 0 ? mw + Math.min(mw, 0) * (mismatch / load) : mw - mismatch / p.length)

    // The susceptance matrix, with the first node's angle held at zero
    const n = component.nodes.length
    const b = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    for (const i of component.sections) {
      const s = network.sections[i]
      const [f, t] = [index.get(s.from)!, index.get(s.to)!]
      const y = 1 / s.reactance
      b[f][f] += y
      b[t][t] += y
      b[f][t] -= y
      b[t][f] -= y
    }
    const angles = [0, ...solve(b.slice(1).map((row) => row.slice(1)), balanced.slice(1))]
    for (const i of component.sections) {
      const s = network.sections[i]
      flows[i] = (angles[index.get(s.from)!] - angles[index.get(s.to)!]) / s.reactance
    }
  }
  return { sections: flows, hvdcNorth: north }
}

// The network's sections for the map, each with its index in network.sections
// as its id, so its flow can be set on it as feature state (see Map)
export function lineSectionsToGeoJson(network: GridNetwork): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: network.sections.flatMap((section, i) => section.parts.length === 0 ? [] : [{
      type: 'Feature',
      id: i,
      geometry: { type: 'MultiLineString', coordinates: section.parts },
      properties: { designvolt: section.line.designKv },
    }]),
  }
}

// An arrow partway along each section with a flow to the MW, pointing the way
// it flows, and its MW
export function flowArrowsToGeoJson(network: GridNetwork, flows: number[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: network.sections.flatMap((section, i) => {
      const mw = Math.abs(flows[i])
      if (Math.round(mw) === 0) return []
      const { at, bearing } = section.arrow
      return [{
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: at },
        properties: { mw, bearing: flows[i] > 0 ? bearing : (bearing + 180) % 360 },
      }]
    }),
  }
}
