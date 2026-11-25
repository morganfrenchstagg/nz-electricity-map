import type { Generator, SelectedNode, Substation, Unit } from '../types'
import { isCharging, isDecommissioned, isRetired } from './generators'

// A single station's own page: /generator/huntly, /substation/otahuhu or /hvdc,
// and a generator's history, /generator/huntly/historic. The build writes each as
// a static page for search engines (see build/pages.ts), and the app opens that
// station's panel there, its history at All. Several stations picked together
// have no page, so stay in ?node= (see useUrlState).

export const SITE_NAME = 'NZ Electricity Map'
export const HOME_TITLE = `${SITE_NAME} – Live NZ Power Generation, Prices & Grid`
export const HVDC_PATH = '/hvdc'
// The pages about the grid's years by fuel, operator and island, and its
// renewable share, each under this one (see build/topics.ts)
export const ANALYSIS_PATH = '/analysis'
export const HVDC_TITLE = `HVDC Inter-Island Link – Live Flows | ${SITE_NAME}`
export const PIPELINE_TITLE = `NZ Generation Pipeline – New Power Stations Being Built | ${SITE_NAME}`

// Lowercase ASCII words joined by hyphens, macrons dropped: Ngā Awa Pūrua → nga-awa-purua
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Two stations whose names slugify alike both take their site code too, so
// neither's path depends on the order they come in
function uniqueSlug(name: string, code: string, names: string[]): string {
  const slug = slugify(name)
  return names.filter((n) => slugify(n) === slug).length > 1 ? `${slug}-${code.toLowerCase()}` : slug
}

export function generatorSlug(g: Generator, generators: Generator[]): string {
  return uniqueSlug(g.name, g.site, generators.map((o) => o.name))
}

export function substationSlug(s: Substation, substations: Substation[]): string {
  return uniqueSlug(s.description, s.siteId, substations.map((o) => o.description))
}

export function generatorPath(g: Generator, generators: Generator[]): string {
  return `/generator/${generatorSlug(g, generators)}`
}

const HISTORIC = '/historic'

export function generatorHistoricPath(g: Generator, generators: Generator[]): string {
  return generatorPath(g, generators) + HISTORIC
}

// /generator/huntly/historic, which opens at All
export function isHistoricPath(pathname: string): boolean {
  return /^\/generator\/[^/]+\/historic$/.test(pathname.replace(/\/+$/, ''))
}

export function substationPath(s: Substation, substations: Substation[]): string {
  return `/substation/${substationSlug(s, substations)}`
}

// The page of the station a node is, or null for several stations. A generator
// shown at All (`historic`) is on its history's page.
export function stationPath(node: NonNullable<SelectedNode>, generators: Generator[], substations: Substation[], historic = false): string | null {
  if (node.kind === 'generator') return historic ? generatorHistoricPath(node.generator, generators) : generatorPath(node.generator, generators)
  if (node.kind === 'substation') return substationPath(node.substation, substations)
  if (node.kind === 'hvdc') return HVDC_PATH
  return null
}

// The ?node= a station page opens, matched by slug (or site code) once the
// definitions load (see resolveNode in useUrlState)
export function nodeParamOfPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '')
  if (path === HVDC_PATH) return 'hvdc'
  const match = /^\/(generator|substation)\/([^/]+)$/.exec(isHistoricPath(path) ? path.slice(0, -HISTORIC.length) : path)
  if (!match) return null
  let slug: string
  try { slug = decodeURIComponent(match[2]).toLowerCase() } catch { return null }
  return `${match[1]}:${slug}`
}

// The units that make up a generator's capacity: not a battery's charging unit,
// which duplicates its discharging one, and only those in service, unless it's
// retired, when it's what it had
export function capacityUnits(g: Generator, atMs?: number): Unit[] {
  const retired = isRetired(g, atMs)
  return g.units.filter((u) => !isCharging(u) && u.capacity > 0 && (retired || !isDecommissioned(u, atMs)))
}

export function generatorCapacity(g: Generator, atMs?: number): number {
  return capacityUnits(g, atMs).reduce((sum, u) => sum + u.capacity, 0)
}

// What kind of station it is, from its largest unit's fuel
export function stationKind(g: Generator, atMs?: number): string {
  const units = capacityUnits(g, atMs)
  const largest = [...(units.length ? units : g.units)].sort((a, b) => b.capacity - a.capacity)[0]
  const fuel = largest?.fuel ?? ''
  if (fuel === 'Wind') return 'Wind Farm'
  if (fuel === 'Solar') return 'Solar Farm'
  if (fuel.startsWith('Battery')) return 'Battery'
  return 'Power Station'
}

export function generatorTitle(g: Generator, atMs?: number): string {
  return `${g.name} ${stationKind(g, atMs)} – Live Generation | ${SITE_NAME}`
}

export function generatorHistoricTitle(g: Generator, atMs?: number): string {
  return `${g.name} ${stationKind(g, atMs)} – Historical Generation & Records | ${SITE_NAME}`
}

export function substationTitle(s: Substation): string {
  return `${s.description} Substation – Live Demand & Prices | ${SITE_NAME}`
}
