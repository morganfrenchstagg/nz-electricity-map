import type { Substation } from '../types'
import { HVDC_DESIGN_KV } from './hvdc'

// The transmission network, pieced together from Transpower's transmission lines
// and the substations, to estimate the flow along each line (see lineFlows). The
// lines are drawn for a map rather than modelled, so which substations each one
// connects, and where they join one another, is read from where they run:
//
// - A line connects each substation one of its parts ends near. Its parts run
//   into the substations at its ends, and in and out of any it's looped through.
// - A tee, or a substation no line ends at, is tapped off the lines passing it.
// - A free end of a line (one no other part of it carries on from) that's on
//   another line of the same voltage joins it there, as a deviation does.
// - Between the places it connects, a line runs from each to the nearest.
//
// A substation is one node whatever its voltages, as though its transformers
// had no impedance.

export type LngLat = [number, number]

export interface GridLine {
  id: number
  // Its circuit, e.g. ARI-EDG-A, the A circuit between Arapuni and Edgecumbe
  code: string
  description: string
  // As designed, and as run: Brownhill to Whakamaru North is built for 400 kV
  // but run at 220 kV
  designKv: number
  kv: number
  cable: boolean
  parts: LngLat[][]
  bbox: [number, number, number, number]
}

// A stretch of a line between two of the places it connects: substations (by
// siteId) or junctions with other lines
export interface LineSection {
  line: GridLine
  from: string
  to: string
  // Per unit, on a 100 MVA base
  reactance: number
  // Its stretch of the line
  parts: LngLat[][]
  // Where its flow's arrow goes, and which way from → to runs there, in degrees
  // clockwise of north
  arrow: { at: LngLat; bearing: number }
}

export interface GridNetwork {
  sections: LineSection[]
  // Each node's sections, by their index in `sections`, split into the networks
  // that aren't joined to one another, e.g. each island's
  components: { nodes: string[]; sections: number[] }[]
  nodes: Map<string, LngLat>
  substations: Map<string, Substation>
  // The substations off the network, by the one on it nearest, on their island,
  // whose load and generation they're counted with, e.g. those on a distributor's lines
  attachedTo: Map<string, string>
}

// A part ending this near a substation runs into it. Substations are mapped
// at a point within their site, which a line can end a few hundred metres from.
const END_RADIUS_M = 1000
// A line ending this near a substation it's named for runs into it
const NAMED_END_RADIUS_M = 3000
// A tee, or a substation no line ends at, is tapped off the lines this near it
const TEE_RADIUS_M = 250
// A part's end with no other part of its line this near is free
const FREE_END_RADIUS_M = 50
// A line's free end this near another line joins it, or further for a line
// that otherwise reaches fewer than two substations, e.g. a deviation
const JOIN_RADIUS_M = 150
const LONE_JOIN_RADIUS_M = 2000
// Joins this near one another are one junction
const JUNCTION_RADIUS_M = 300
// A few substations still apart from their island's network join the nearest
// of its lines this near
const ISLAND_JOIN_RADIUS_M = 2500
// A substation off the network is counted with the nearest on it this near
const ATTACH_RADIUS_M = 50_000
// Reactance per km, overhead and in cables, and the shortest a section is taken as
const OHMS_PER_KM = { overhead: 0.4, cable: 0.15 }
const MIN_SECTION_KM = 0.5
const BASE_MVA = 100

const M_PER_DEGREE = 111_320

function metresBetween(a: LngLat, b: LngLat): number {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot((a[0] - b[0]) * cos, a[1] - b[1]) * M_PER_DEGREE
}

// From p to the nearest point of the segment from a to b
function metresToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const cos = Math.cos((p[1] * Math.PI) / 180)
  const ax = (a[0] - p[0]) * cos
  const ay = a[1] - p[1]
  const dx = (b[0] - p[0]) * cos - ax
  const dy = b[1] - p[1] - ay
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2))
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEGREE
}

function metresToPart(p: LngLat, part: LngLat[]): number {
  if (part.length === 1) return metresBetween(p, part[0])
  let min = Infinity
  for (let i = 1; i < part.length; i++) min = Math.min(min, metresToSegment(p, part[i - 1], part[i]))
  return min
}

// Infinity when it's further than `within`, without measuring to each part
function metresToLine(p: LngLat, line: GridLine, within: number): number {
  const [west, south, east, north] = line.bbox
  const lat = within / M_PER_DEGREE
  const lng = lat / Math.cos((p[1] * Math.PI) / 180)
  if (p[0] < west - lng || p[0] > east + lng || p[1] < south - lat || p[1] > north + lat) return Infinity
  return Math.min(...line.parts.map((part) => metresToPart(p, part)))
}

// Degrees clockwise of north from a to b
function bearing(a: LngLat, b: LngLat): number {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return ((Math.atan2((b[0] - a[0]) * cos, b[1] - a[1]) * 180) / Math.PI + 360) % 360
}

function minBy<T>(items: T[], value: (item: T) => number): T | undefined {
  let best: T | undefined
  let min = Infinity
  for (const item of items) {
    const v = value(item)
    if (v < min) { min = v; best = item }
  }
  return best
}

function readLines(collection: GeoJSON.FeatureCollection): GridLine[] {
  return collection.features.flatMap((feature) => {
    const p = feature.properties ?? {}
    const designKv = Number(p.designvolt)
    const g = feature.geometry
    // The HVDC links the islands' networks rather than being part of one (see lineFlows)
    if (!designKv || designKv === HVDC_DESIGN_KV) return []
    const parts = (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])
      .filter((part) => part.length > 0) as LngLat[][]
    if (parts.length === 0) return []
    const points = parts.flat()
    const bbox: GridLine['bbox'] = [
      Math.min(...points.map((pt) => pt[0])), Math.min(...points.map((pt) => pt[1])),
      Math.max(...points.map((pt) => pt[0])), Math.max(...points.map((pt) => pt[1])),
    ]
    return [{
      id: Number(p.OBJECTID),
      code: String(p.MXLOCATION ?? ''),
      description: String(p.description ?? p.MXLOCATION ?? ''),
      designKv,
      kv: designKv === 400 ? 220 : designKv,
      cable: p.type === 'CABLE',
      parts,
      bbox,
    }]
  })
}

// A line's code names the sites at its ends, and its circuit between them,
// e.g. HAM-MER-B1-Z-CBL is a cable on circuit B between Hamilton and Meremere
function routeOf(line: GridLine): { ends: string[]; route: string; circuit: string } {
  const [a = '', b = '', circuit = ''] = line.code.split('-')
  return { ends: [a, b], route: `${a}-${b}`, circuit: circuit.charAt(0) }
}

// Another circuit along the same route, often on the same towers, which only
// meets this one at the substations
function isOtherCircuit(a: GridLine, b: GridLine): boolean {
  const ra = routeOf(a)
  const rb = routeOf(b)
  return ra.route === rb.route && ra.circuit !== rb.circuit
}

// Where a line runs between the places it connects: from each to the nearest,
// building out from one (a minimum spanning tree). Each stretch of its parts
// goes to the section it's nearest, so a part running past one of the places
// is split there.
function sectionsOf(line: GridLine, stops: Set<string>, nodes: Map<string, LngLat>): LineSection[] {
  const ids = [...stops]
  if (ids.length < 2) return []
  const reached = [ids[0]]
  const left = new Set(ids.slice(1))
  const pairs: [string, string][] = []
  while (left.size > 0) {
    let best: [string, string] | undefined
    let min = Infinity
    for (const a of reached) {
      for (const b of left) {
        const m = metresBetween(nodes.get(a)!, nodes.get(b)!)
        if (m < min) { min = m; best = [a, b] }
      }
    }
    pairs.push(best!)
    reached.push(best![1])
    left.delete(best![1])
  }

  const partsOf: LngLat[][][] = pairs.map(() => [])
  const nearestPair = (p: LngLat) => minBy(pairs.map((_, i) => i), (i) => metresToSegment(p, nodes.get(pairs[i][0])!, nodes.get(pairs[i][1])!))!
  for (const part of line.parts) {
    if (part.length === 1) { partsOf[nearestPair(part[0])].push(part); continue }
    let stretch = [part[0]]
    let current = -1
    for (let k = 1; k < part.length; k++) {
      const pair = nearestPair([(part[k - 1][0] + part[k][0]) / 2, (part[k - 1][1] + part[k][1]) / 2])
      if (current !== -1 && pair !== current) {
        partsOf[current].push(stretch)
        stretch = [part[k - 1]]
      }
      current = pair
      stretch.push(part[k])
    }
    partsOf[current].push(stretch)
  }

  return pairs.map(([from, to], i) => {
    const km = Math.max(metresBetween(nodes.get(from)!, nodes.get(to)!) / 1000, MIN_SECTION_KM)
    const ohms = (line.cable ? OHMS_PER_KM.cable : OHMS_PER_KM.overhead) * km
    return {
      line, from, to,
      reactance: (ohms * BASE_MVA) / (line.kv * line.kv),
      parts: partsOf[i],
      arrow: arrowOf(partsOf[i], nodes.get(from)!, nodes.get(to)!),
    }
  })
}

// Partway along a section, on its line where it can be, pointing from → to the
// way the line runs there
function arrowOf(parts: LngLat[][], from: LngLat, to: LngLat): LineSection['arrow'] {
  const middle: LngLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  const way = bearing(from, to)
  const vertices = parts.flatMap((part) => part.map((_, i) => ({ part, i })))
  const nearest = minBy(vertices, ({ part, i }) => metresBetween(part[i], middle))
  if (!nearest) return { at: middle, bearing: way }
  const { part, i } = nearest
  const a = part[Math.max(i - 1, 0)]
  const b = part[Math.min(i + 1, part.length - 1)]
  if (a === b) return { at: part[i], bearing: way }
  const along = bearing(a, b)
  // The line may be drawn either way along it
  const turn = Math.abs(((along - way + 540) % 360) - 180)
  return { at: part[i], bearing: turn <= 90 ? along : (along + 180) % 360 }
}

function componentsOf(sections: LineSection[]): GridNetwork['components'] {
  const neighbours = new Map<string, number[]>()
  sections.forEach((s, i) => {
    for (const node of [s.from, s.to]) neighbours.set(node, [...(neighbours.get(node) ?? []), i])
  })
  const seen = new Set<string>()
  const components: GridNetwork['components'] = []
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue
    const nodes = [start]
    const found = new Set<number>()
    seen.add(start)
    for (let k = 0; k < nodes.length; k++) {
      for (const i of neighbours.get(nodes[k])!) {
        found.add(i)
        for (const next of [sections[i].from, sections[i].to]) {
          if (!seen.has(next)) { seen.add(next); nodes.push(next) }
        }
      }
    }
    components.push({ nodes, sections: [...found] })
  }
  return components
}

export function buildGridNetwork(collection: GeoJSON.FeatureCollection, substationList: Substation[]): GridNetwork {
  const lines = readLines(collection)
  const substations = new Map(substationList.map((s) => [s.siteId, s]))
  const nodes = new Map<string, LngLat>(substationList.map((s) => [s.siteId, [s.long, s.lat]]))
  const stops = new Map<GridLine, Set<string>>(lines.map((line) => [line, new Set()]))
  const nearestSubstation = (p: LngLat) => minBy(substationList, (s) => metresBetween(p, nodes.get(s.siteId)!))

  // The substations each line's parts end near, and its free ends elsewhere
  const looseEnds = new Map<GridLine, LngLat[]>()
  for (const line of lines) {
    const loose: LngLat[] = []
    line.parts.forEach((part, i) => {
      for (const end of [part[0], part[part.length - 1]]) {
        const nearest = nearestSubstation(end)
        if (nearest && metresBetween(end, nodes.get(nearest.siteId)!) <= END_RADIUS_M) stops.get(line)!.add(nearest.siteId)
        else if (line.parts.every((other, j) => j === i || metresToPart(end, other) > FREE_END_RADIUS_M)) loose.push(end)
      }
    })
    const ends = line.parts.flatMap((part) => [part[0], part[part.length - 1]])
    for (const siteId of routeOf(line).ends) {
      const at = substations.has(siteId) && nodes.get(siteId)
      if (at && Math.min(...ends.map((end) => metresBetween(end, at))) <= NAMED_END_RADIUS_M) stops.get(line)!.add(siteId)
    }
    looseEnds.set(line, loose)
  }

  // Tees, and substations no line ends at, on the lines passing them at the
  // voltage of the nearest
  const ended = new Set([...stops.values()].flatMap((s) => [...s]))
  for (const s of substationList) {
    if (s.type !== 'TEE' && ended.has(s.siteId)) continue
    const at = nodes.get(s.siteId)!
    const passing = lines.map((line) => ({ line, m: metresToLine(at, line, TEE_RADIUS_M) })).filter(({ m }) => m <= TEE_RADIUS_M)
    const kv = minBy(passing, ({ m }) => m)?.line.kv
    for (const { line } of passing) if (line.kv === kv) stops.get(line)!.add(s.siteId)
  }

  // Free ends on other lines of the same voltage join them
  const junctions: { at: LngLat; lines: GridLine[] }[] = []
  for (const [line, ends] of looseEnds) {
    const radius = stops.get(line)!.size >= 2 ? JOIN_RADIUS_M : LONE_JOIN_RADIUS_M
    const others = lines.filter((other) => other !== line && other.kv === line.kv && !isOtherCircuit(line, other))
    for (const end of ends) {
      const nearest = minBy(others.map((other) => ({ other, m: metresToLine(end, other, radius) })), ({ m }) => m)
      if (!nearest || nearest.m > radius) continue
      const junction = junctions.find((j) => metresBetween(j.at, end) <= JUNCTION_RADIUS_M)
      if (junction) junction.lines.push(line, nearest.other)
      else junctions.push({ at: end, lines: [line, nearest.other] })
    }
  }
  junctions.forEach((junction, i) => {
    const id = `J${i}`
    nodes.set(id, junction.at)
    for (const line of junction.lines) stops.get(line)!.add(id)
  })

  // Substations left apart from the rest of their island's network join the
  // nearest of its lines, e.g. one joined by a deviation only within its site
  let sections = lines.flatMap((line) => sectionsOf(line, stops.get(line)!, nodes))
  let components = componentsOf(sections)
  for (let pass = 0; pass < 5; pass++) {
    const islandOf = (component: GridNetwork['components'][number]) =>
      component.nodes.map((n) => substations.get(n)?.island).find((island) => island)
    const main = new Map<string, GridNetwork['components'][number]>()
    for (const component of components) {
      const island = islandOf(component)
      if (island && component.nodes.length > (main.get(island)?.nodes.length ?? 0)) main.set(island, component)
    }
    let joined = false
    for (const component of components) {
      const island = islandOf(component)
      const mainland = island && main.get(island)
      if (!mainland || mainland === component) continue
      const mainLines = [...new Set(mainland.sections.map((i) => sections[i].line))]
      const candidates = component.nodes.filter((n) => substations.has(n)).flatMap((siteId) =>
        mainLines.map((line) => ({ siteId, line, m: metresToLine(nodes.get(siteId)!, line, ISLAND_JOIN_RADIUS_M) })))
      const nearest = minBy(candidates, ({ m }) => m)
      if (!nearest || nearest.m > ISLAND_JOIN_RADIUS_M) continue
      stops.get(nearest.line)!.add(nearest.siteId)
      joined = true
    }
    if (!joined) break
    sections = lines.flatMap((line) => sectionsOf(line, stops.get(line)!, nodes))
    components = componentsOf(sections)
  }

  const onNetwork = new Set(sections.flatMap((s) => [s.from, s.to]))
  const attachedTo = new Map<string, string>()
  for (const s of substationList) {
    if (onNetwork.has(s.siteId)) continue
    const at = nodes.get(s.siteId)!
    const candidates = substationList.filter((other) => other.island === s.island && onNetwork.has(other.siteId))
    const nearest = minBy(candidates, (other) => metresBetween(at, nodes.get(other.siteId)!))
    if (nearest && metresBetween(at, nodes.get(nearest.siteId)!) <= ATTACH_RADIUS_M) attachedTo.set(s.siteId, nearest.siteId)
  }

  return { sections, components, nodes, substations, attachedTo }
}

// What's at one end of a section, by name: the substation there, or else the
// first along its line beyond the junction there, or else the line it joins
export function sectionEndName(network: GridNetwork, index: number, end: 'from' | 'to'): string | null {
  const section = network.sections[index]
  const start = section[end]
  const substation = network.substations.get(start)
  if (substation) return substation.description
  const onLine = network.sections.map((_, i) => i).filter((i) => i !== index && network.sections[i].line === section.line)
  const seen = new Set([start, section[end === 'from' ? 'to' : 'from']])
  const queue = [start]
  for (let k = 0; k < queue.length; k++) {
    for (const i of onLine) {
      const s = network.sections[i]
      const next = s.from === queue[k] ? s.to : s.to === queue[k] ? s.from : null
      if (!next || seen.has(next)) continue
      const found = network.substations.get(next)
      if (found) return found.description
      seen.add(next)
      queue.push(next)
    }
  }
  return network.sections.find((s) => s.line !== section.line && (s.from === start || s.to === start))?.line.description ?? null
}
