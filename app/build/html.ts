import type { Generator, Substation, Unit } from '../src/types'
import { capacityUnits, SITE_NAME, stationKind } from '../src/utils/stationPaths'

// What every built page shares: its type, the site's constants, and helpers for
// writing its text, HTML and structured data (see pages.ts and topics.ts)

export const ORIGIN = 'https://electricitymap.frenchsta.gg'
export const API_URL = 'https://api.electricitymap.frenchsta.gg/v1'
export const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
export const CC_BY = 'https://creativecommons.org/licenses/by/4.0/'
const LINKEDIN = 'https://www.linkedin.com/in/morganfrenchstagg'
export const CREATOR = { '@type': 'Person', '@id': `${ORIGIN}/#creator`, name: 'Morgan French-Stagg', url: LINKEDIN, sameAs: [LINKEDIN] }
// Who made the site, at the foot of every page
export const CREDIT = `<footer class="prerender__credit"><p>${SITE_NAME} is an independent project created by
<a href="${LINKEDIN}" rel="author">Morgan French-Stagg</a>. Questions or feedback?
Get in touch with Morgan on <a href="${LINKEDIN}">LinkedIn</a>.</p></footer>`
export const SOURCES = `<p>Data from the Electricity Authority's <a href="https://www.emi.ea.govt.nz">Electricity Market Information (EMI)</a>
and <a href="https://www.transpower.co.nz">Transpower New Zealand</a>, licensed under <a href="${CC_BY}">CC BY 4.0</a>,
and <a href="https://www.em6.co.nz">em6</a>. This site is independent and isn't endorsed by them.</p>`

export interface Definitions {
  generators: Generator[]
  substations: Substation[]
}

export interface Page {
  path: string
  title: string
  description: string
  jsonLd: object
  body: string
  // A page of its own, without the app, which would replace its content (see renderPage)
  standalone?: boolean
}

// A page's description: Bing flags one over 160 characters, and search engines
// cut it short there, so the second sentence goes in only when it fits
export function fitDescription(about: string, more: string): string {
  const both = `${about} ${more}`
  return both.length <= 160 ? both : about
}

export function esc(text: string | number): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function mw(n: number): string {
  return `${n.toLocaleString('en-NZ', { maximumFractionDigits: 1 })} MW`
}

// Whole GWh from 100 up, and to a decimal place below
export function gwh(n: number): string {
  return `${n.toLocaleString('en-NZ', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 })} GWh`
}

// To a decimal place, so a share too small to show one says so
export function pct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0005) return 'under 0.1%'
  return `${(fraction * 100).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}%`
}

export function ordinal(n: number): string {
  const tens = n % 100, ones = n % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// "an 84 MW", "a 953 MW"
export function article(n: number): string {
  const s = String(Math.round(n))
  return s.startsWith('8') || s === '11' || s === '18' || /^1[18]\d{3}$/.test(s) ? 'an' : 'a'
}

export function nzDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric' })
}

export function nzYear(date: string | Date): number {
  return Number(new Date(date).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric' }))
}

export function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function capitalise(text: string): string {
  return text.replace(/^./, (c) => c.toUpperCase())
}

// A unit's fuel, its battery's discharging named only Battery
export function unitFuel(u: Unit): string {
  return u.fuel.startsWith('Battery') ? 'Battery' : u.fuel
}

// Its fuels, lowercase: "coal and gas", "hydro". A battery beside a power
// station's other units isn't one of its fuels.
export function fuelsText(g: Generator): string {
  const capacity = capacityUnits(g)
  const units = capacity.length ? capacity : g.units
  const fuelled = units.filter((u) => unitFuel(u) !== 'Battery')
  const fuels = new Set((fuelled.length ? fuelled : units).flatMap((u) => unitFuel(u).toLowerCase().split('/')))
  return list([...fuels])
}

// The fuel it's listed under: its largest unit's, as a unit names it ("Coal/Gas")
export function primaryFuel(g: Generator): string {
  const units = capacityUnits(g)
  const largest = [...(units.length ? units : g.units)].sort((a, b) => b.capacity - a.capacity)[0]
  return largest ? unitFuel(largest) : 'Other'
}

export function island(code: string): string {
  return code === 'NI' || code === 'north' ? 'North Island' : 'South Island'
}

// "hydro power station", "wind farm", "battery"
export function kindPhrase(g: Generator): string {
  const kind = stationKind(g)
  return kind === 'Power Station' ? `${fuelsText(g)} power station` : kind.toLowerCase()
}

export function sortByName<T>(items: T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => name(a).localeCompare(name(b), 'en-NZ'))
}

export function link(href: string, text: string): string {
  return `<a href="${esc(href)}">${esc(text)}</a>`
}

export function linkList(links: { href: string; text: string }[]): string {
  return `<ul class="prerender__links">${links.map((l) => `<li>${link(l.href, l.text)}</li>`).join('')}</ul>`
}

// A table of rows of HTML (already escaped), its header text escaped here
export function table(head: string[], rows: string[][]): string {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

export function breadcrumbs(trail: { name: string; path: string }[]): { html: string; jsonLd: object } {
  return {
    html: `<nav class="prerender__crumbs">${trail.map((t, i) => i < trail.length - 1 ? `${link(t.path, t.name)} › ` : esc(t.name)).join('')}</nav>`,
    jsonLd: {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: ORIGIN + t.path })),
    },
  }
}

export function webPage(path: string, name: string, description: string, extra: object = {}): object {
  return {
    '@type': 'WebPage', '@id': ORIGIN + path, url: ORIGIN + path, name, description,
    isPartOf: { '@id': `${ORIGIN}/#website` }, inLanguage: 'en-NZ', author: { '@id': CREATOR['@id'] }, ...extra,
  }
}

// Every page's structured data names its creator in full, as an @id isn't
// followed from one page to another
export function graph(...items: object[]): object {
  return { '@context': 'https://schema.org', '@graph': [...items, CREATOR] }
}
