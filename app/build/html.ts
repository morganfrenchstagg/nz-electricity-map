import type { Generator, Substation, Unit } from '../src/types'
import { ANALYSIS_PATH, capacityUnits, SITE_NAME, stationKind } from '../src/utils/stationPaths'

// What every built page shares: its type, the site's constants, and helpers for
// writing its text, HTML and structured data (see pages.ts and topics.ts)

export const ORIGIN = 'https://electricitymap.frenchsta.gg'
export const API_URL = 'https://api.electricitymap.frenchsta.gg/v1'
export const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
const API_DOCS_URL = 'https://api.electricitymap.frenchsta.gg/docs'
const OPENAPI_URL = 'https://api.electricitymap.frenchsta.gg/openapi.json'
export const CC_BY = 'https://creativecommons.org/licenses/by/4.0/'
const LINKEDIN = 'https://www.linkedin.com/in/morganfrenchstagg'
export const CREATOR = {
  '@type': 'Person',
  '@id': `${ORIGIN}/#creator`,
  name: 'Morgan French-Stagg',
  url: LINKEDIN,
  sameAs: [LINKEDIN],
}
// The data's sources and who made the site, at the foot of every page
export const FOOTER = `<footer class="prerender__footer">
<p>Data from the Electricity Authority's <a href="https://www.emi.ea.govt.nz">Electricity Market Information (EMI)</a>
and <a href="https://www.transpower.co.nz">Transpower New Zealand</a>, licensed under <a href="${CC_BY}">CC BY 4.0</a>,
and <a href="https://www.em6.co.nz">em6</a>. This site is independent and isn't endorsed by them.</p>
<p>${SITE_NAME} is an independent project created by
<a href="${LINKEDIN}" rel="author">Morgan French-Stagg</a>. Questions or feedback?
Get in touch with Morgan on <a href="${LINKEDIN}">LinkedIn</a>.</p>
</footer>`

// Where agents can get the data, with the MCP server's and the API's docs: on
// the home page, and near the foot of every page's Markdown (see markdown.ts).
// The API's docs are its routes'. The server card and llms.txt describe the MCP
// server and its tools.
export const AGENT_DATA = `<h2>For developers and AI agents</h2>
<ul>
<li>MCP server: ${MCP_URL} (Streamable HTTP, no sign-in), described by its <a href="/.well-known/mcp/server-card.json">server card</a>, with its tools listed in <a href="/llms.txt">llms.txt</a></li>
<li>JSON API: ${API_URL}, with <a href="${API_DOCS_URL}">docs</a> and an <a href="${OPENAPI_URL}">OpenAPI description</a></li>
</ul>`

// The site's icon, as public/favicon.svg draws it
const ICON =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1d4ed8"/><path d="M36 6 14 36h15l-3 22 24-32H35z" fill="#fff"/></svg>'

// Atop every page: the site's name, the Analysis section, marked when the page
// at `path` is in it, and a button into the live map at `live`
export function header(live: string, path: string): string {
  const current =
    path === ANALYSIS_PATH ? ' aria-current="page"' : path.startsWith(`${ANALYSIS_PATH}/`) ? ' aria-current="true"' : ''
  return `<header class="prerender__header"><div class="prerender__bar">
<a class="prerender__brand" href="/" aria-label="${SITE_NAME}">${ICON}<span>${SITE_NAME}</span></a>
<nav class="prerender__nav" aria-label="Sections"><a href="${ANALYSIS_PATH}"${current}>Analysis</a></nav>
<a class="prerender__cta" href="${esc(live)}">Open live map</a>
</div></header>`
}

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
  // Where its header's Open live map button goes, if not the map as it opens
  live?: string
  // HTML for its Markdown only, after its content: for agents, where its data is
  agentData?: string
  // Its Markdown's Today section, where to get its generation so far today,
  // which edge/today.ts fills in as it's served (see todayPlaceholder)
  today?: string
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
  const tens = n % 100,
    ones = n % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// "an 84 MW", "a 953 MW"
export function article(n: number): string {
  const s = String(Math.round(n))
  return s.startsWith('8') || s === '11' || s === '18' || /^1[18]\d{3}$/.test(s) ? 'an' : 'a'
}

export function nzDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
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

function row(cells: string[], numericFrom: number): string {
  return `<tr>${cells.map((c, i) => (i >= numericFrom ? `<td class="num">${c}</td>` : `<td>${c}</td>`)).join('')}</tr>`
}

// A table of rows of HTML (already escaped), its header text escaped here. The
// columns from `numericFrom` on are figures, right-aligned. Rows in `more` are
// shown only once its toggle, labelled `more.label`, is opened (see .prerender__more).
export function table(
  head: string[],
  rows: string[][],
  numericFrom = head.length,
  more?: { label: string; rows: string[][] },
): string {
  const thead = `<thead><tr>${head.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>`
  const body = (rs: string[][], cls = '') => `<tbody${cls}>${rs.map((r) => row(r, numericFrom)).join('')}</tbody>`
  const html = `<div class="prerender__table"><table>${thead}${body(rows)}${more ? body(more.rows, ' class="prerender__more-rows"') : ''}</table></div>`
  return more
    ? `<div class="prerender__more">${html}<details><summary>${esc(more.label)}</summary></details></div>`
    : html
}

// A column of figures to one precision, a decimal place when they're all under
// 100 and none otherwise, with none at all as "–"
export function figures(values: number[]): string[] {
  const digits = Math.max(0, ...values.filter((v) => !Number.isNaN(v)).map(Math.abs)) < 100 ? 1 : 0
  const smallest = 0.5 * 10 ** -digits
  return values.map((v) => {
    if (Number.isNaN(v) || Math.abs(v) < 0.05) return '–'
    if (Math.abs(v) < smallest) return `&lt;${(2 * smallest).toLocaleString('en-NZ')}`
    return v.toLocaleString('en-NZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  })
}

// A share in a table or a chart's tooltip, always to a decimal place, with none as "–"
export function shareText(fraction: number): string {
  if (Number.isNaN(fraction) || fraction === 0) return '–'
  if (fraction > 0 && fraction < 0.0005) return '<0.1%'
  return `${(fraction * 100).toLocaleString('en-NZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function shareCell(fraction: number): string {
  return esc(shareText(fraction))
}

export function breadcrumbs(trail: { name: string; path: string }[]): { html: string; jsonLd: object } {
  return {
    html: `<nav class="prerender__crumbs">${trail.map((t, i) => (i < trail.length - 1 ? `${link(t.path, t.name)} › ` : esc(t.name))).join('')}</nav>`,
    jsonLd: {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t.name,
        item: ORIGIN + t.path,
      })),
    },
  }
}

export function webPage(path: string, name: string, description: string, extra: object = {}): object {
  return {
    '@type': 'WebPage',
    '@id': ORIGIN + path,
    url: ORIGIN + path,
    name,
    description,
    isPartOf: { '@id': `${ORIGIN}/#website` },
    inLanguage: 'en-NZ',
    author: { '@id': CREATOR['@id'] },
    ...extra,
  }
}

// Every page's structured data names its creator in full, as an @id isn't
// followed from one page to another
export function graph(...items: object[]): object {
  return { '@context': 'https://schema.org', '@graph': [...items, CREATOR] }
}
