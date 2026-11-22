import type { Plugin } from 'vite'
import type { Generator, Substation, Unit, UnderConstructionNode } from '../src/types'
import { underConstruction } from '../src/data/underConstruction'
import { isCharging, isCommissioning, isDecommissioned, isRetired } from '../src/utils/generators'
import {
  capacityUnits, generatorCapacity, generatorPath, generatorTitle, HOME_TITLE, HVDC_PATH, HVDC_TITLE,
  PIPELINE_TITLE, SITE_NAME, stationKind, substationPath, substationTitle,
} from '../src/utils/stationPaths'

// The pages the build writes from index.html, each with its own title,
// description, canonical link and structured data, and its content as plain
// HTML inside #root, for search engines and AI agents, which mostly don't run
// the app. The app replaces that content when it starts, and opens the page's
// station (see useUrlState).

export const ORIGIN = 'https://electricitymap.frenchsta.gg'
const API_URL = 'https://api.electricitymap.frenchsta.gg/v1'
const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/'
const FUEL_ORDER = ['Hydro', 'Geothermal', 'Wind', 'Solar', 'Battery', 'Gas', 'Coal and gas', 'Diesel']

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
}

export function esc(text: string | number): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mw(n: number): string {
  return `${n.toLocaleString('en-NZ', { maximumFractionDigits: 1 })} MW`
}

// "an 84 MW", "a 953 MW"
function article(n: number): string {
  const s = String(Math.round(n))
  return s.startsWith('8') || s === '11' || s === '18' || /^1[18]\d{3}$/.test(s) ? 'an' : 'a'
}

function nzDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric' })
}

function year(iso: string): number {
  return Number(new Date(iso).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric' }))
}

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function unitFuel(u: Unit): string {
  return u.fuel.startsWith('Battery') ? 'Battery' : u.fuel
}

// Its fuels, lowercase: "coal and gas", "hydro". A battery beside a power
// station's other units isn't one of its fuels.
function fuelsText(g: Generator): string {
  const capacity = capacityUnits(g)
  const units = capacity.length ? capacity : g.units
  const fuelled = units.filter((u) => unitFuel(u) !== 'Battery')
  const fuels = new Set((fuelled.length ? fuelled : units).flatMap((u) => unitFuel(u).toLowerCase().split('/')))
  return list([...fuels])
}

// The fuel it's listed under: its largest unit's
function primaryFuel(g: Generator): string {
  const units = capacityUnits(g)
  const largest = [...(units.length ? units : g.units)].sort((a, b) => b.capacity - a.capacity)[0]
  const fuel = largest ? unitFuel(largest) : 'Other'
  return fuel === 'Coal/Gas' ? 'Coal and gas' : fuel
}

function island(code: string): string {
  return code === 'NI' || code === 'north' ? 'North Island' : 'South Island'
}

// "hydro power station", "wind farm", "battery"
function kindPhrase(g: Generator): string {
  const kind = stationKind(g)
  return kind === 'Power Station' ? `${fuelsText(g)} power station` : kind.toLowerCase()
}

function sortByName<T>(items: T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => name(a).localeCompare(name(b), 'en-NZ'))
}

function linkList(links: { href: string; text: string }[]): string {
  return `<ul class="prerender__links">${links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.text)}</a></li>`).join('')}</ul>`
}

function breadcrumbs(trail: { name: string; path: string }[]): { html: string; jsonLd: object } {
  return {
    html: `<nav class="prerender__crumbs">${trail.map((t, i) => i < trail.length - 1 ? `<a href="${esc(t.path)}">${esc(t.name)}</a> › ` : esc(t.name)).join('')}</nav>`,
    jsonLd: {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: ORIGIN + t.path })),
    },
  }
}

function webPage(path: string, name: string, description: string, extra: object = {}): object {
  return {
    '@type': 'WebPage', '@id': ORIGIN + path, url: ORIGIN + path, name, description,
    isPartOf: { '@id': `${ORIGIN}/#website` }, inLanguage: 'en-NZ', ...extra,
  }
}

function graph(...items: object[]): object {
  return { '@context': 'https://schema.org', '@graph': items }
}

const SOURCES = `<p>Data from the Electricity Authority's <a href="https://www.emi.ea.govt.nz">Electricity Market Information (EMI)</a>
and <a href="https://www.transpower.co.nz">Transpower New Zealand</a>, licensed under <a href="${CC_BY}">CC BY 4.0</a>,
and <a href="https://www.em6.co.nz">em6</a>. This site is independent and isn't endorsed by them.</p>`

function generatorPage(g: Generator, defs: Definitions): Page {
  const path = generatorPath(g, defs.generators)
  const retired = isRetired(g)
  const capacity = generatorCapacity(g)
  const operator = g.secondaryOperator ? `${g.operator} and ${g.secondaryOperator}` : g.operator
  const commissioned = g.units.map((u) => u.commissioned).filter((d): d is string => !!d).sort()[0]
  const decommissioned = g.units.map((u) => u.decomissioned).filter((d): d is string => !!d).sort().pop()
  const kind = stationKind(g)
  const heading = `${g.name} ${kind}`
  // Some, such as an aggregated fleet of home batteries, have no capacity of their own
  const sized = capacity > 0 ? `${article(capacity)} ${mw(capacity)} ${kindPhrase(g)}` : `a ${kindPhrase(g)}`
  const description = retired
    ? `${g.name} was ${sized} in the ${island(g.island)}, operated by ${operator}${decommissioned ? ` until ${year(decommissioned)}` : ''}. See its historical generation.`
    : `${g.name} is ${sized} in the ${island(g.island)}, operated by ${operator}. See its live and historical generation, offers and prices.`
  const fuel = primaryFuel(g)
  const others = sortByName(defs.generators.filter((o) => o !== g && primaryFuel(o) === fuel), (o) => o.name)
  const substation = defs.substations.find((s) => g.units.some((u) => u.node.slice(0, 3) === s.siteId))
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])

  const facts: [string, string][] = [
    ['Operator', operator],
    ['Fuel', fuelsText(g).replace(/^./, (c) => c.toUpperCase())],
    ...(capacity > 0 ? [[retired ? 'Capacity (when retired)' : 'Capacity', mw(capacity)] as [string, string]] : []),
    ['Island', island(g.island)],
    ...(g.scheme ? [['Scheme', g.scheme] as [string, string]] : []),
    ...(commissioned ? [['First commissioned', nzDate(commissioned)] as [string, string]] : []),
    ...(retired && decommissioned ? [['Retired', nzDate(decommissioned)] as [string, string]] : []),
    ['Site code', g.site],
  ]
  // Not a battery's charging unit, nor one standing in for units only metered together
  const unitRows = g.units.filter((u) => !isCharging(u) && !u.combines).map((u) => {
    const status = isDecommissioned(u) ? 'Retired' : isCommissioning(u) ? 'Commissioning' : 'In service'
    return `<tr><td>${esc(u.name)} (${esc(u.unitCode)})</td><td>${esc(u.fuel)}</td><td>${u.capacity ? esc(mw(u.capacity)) : '–'}</td><td>${u.commissioned ? esc(nzDate(u.commissioned)) : '–'}</td><td>${status}</td></tr>`
  }).join('')

  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(description)} ${retired ? '' : 'The live map shows its output every five minutes, as dispatched on the national grid, with the price at its node and its offers for each trading period.'}</p>
<dl class="prerender__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<h2>Units</h2>
<table><thead><tr><th>Unit</th><th>Fuel</th><th>Capacity</th><th>Commissioned</th><th>Status</th></tr></thead><tbody>${unitRows}</tbody></table>
${substation ? `<p>Connected to the grid at <a href="${esc(substationPath(substation, defs.substations))}">${esc(substation.description)} substation</a>.</p>` : ''}
${others.length ? `<h2>Other ${esc(fuel.toLowerCase())} stations</h2>${linkList(others.map((o) => ({ href: generatorPath(o, defs.generators), text: o.name })))}` : ''}
${SOURCES}`

  const place = {
    '@type': 'Place', '@id': `${ORIGIN}${path}#station`, name: heading,
    geo: { '@type': 'GeoCoordinates', latitude: g.location.lat, longitude: g.location.long },
    address: { '@type': 'PostalAddress', addressCountry: 'NZ' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Capacity', value: capacity, unitText: 'MW' },
      { '@type': 'PropertyValue', name: 'Fuel', value: fuelsText(g) },
      { '@type': 'PropertyValue', name: 'Operator', value: operator },
    ],
  }
  return {
    path, title: generatorTitle(g), description, body,
    jsonLd: graph(webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }), place),
  }
}

function substationPage(s: Substation, defs: Definitions): Page {
  const path = substationPath(s, defs.substations)
  const heading = `${s.description} Substation`
  const description = `Live electricity demand and nodal prices at ${s.description} substation (${s.siteId}) on New Zealand's national grid, in the ${island(s.island)}. Updated every five minutes, with history.`
  const generators = sortByName(defs.generators.filter((g) => g.units.some((u) => u.node.slice(0, 3) === s.siteId)), (g) => g.name)
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])
  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(description)} The live map charts the power drawn from the grid at ${esc(s.description)}, the generation connected there and the price at its nodes.</p>
<dl class="prerender__facts"><dt>Site code</dt><dd>${esc(s.siteId)}</dd><dt>Island</dt><dd>${island(s.island)}</dd><dt>Type</dt><dd>${s.type === 'TEE' ? 'Tee point' : 'Substation'}</dd></dl>
${generators.length ? `<h2>Generation connected here</h2>${linkList(generators.map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}` : ''}
${SOURCES}`
  const place = {
    '@type': 'Place', '@id': `${ORIGIN}${path}#substation`, name: heading,
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.long },
    address: { '@type': 'PostalAddress', addressCountry: 'NZ' },
  }
  return {
    path, title: substationTitle(s), description, body,
    jsonLd: graph(webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }), place),
  }
}

function hvdcPage(): Page {
  const heading = 'HVDC Inter-Island Link'
  const description = `Live power flows north and south across New Zealand's HVDC Inter-Island link between Benmore and Haywards, with its transfer limits and history.`
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path: HVDC_PATH }])
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)}</p>
<p>The high-voltage direct current (HVDC) link joins the South Island's grid at Benmore to the North Island's at Haywards, crossing Cook Strait by submarine cable. The live map charts the power it sends each way every half hour, and how much it could send.</p>
<p>Flows from EMI's metered HVDC data, and from <a href="https://www.em6.co.nz">em6</a> for the days since EMI's latest month. Transfer limits from em6.</p>`
  return { path: HVDC_PATH, title: HVDC_TITLE, description, body, jsonLd: graph(webPage(HVDC_PATH, heading, description, { breadcrumb: crumbs.jsonLd })) }
}

function projectCapacity(n: UnderConstructionNode): number {
  return n.capacityMW ?? n.capacityMWp ?? 0
}

function pipelinePage(projects: UnderConstructionNode[]): Page {
  const path = '/pipeline'
  const heading = 'New Zealand Generation Pipeline'
  const total = projects.reduce((sum, n) => sum + projectCapacity(n), 0)
  const description = `${projects.length} new electricity generation projects being built or committed in New Zealand, ${mw(Math.round(total))} in all: their fuel, capacity, operator, status and when they're due to open.`
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])
  const rows = sortByName(projects, (n) => n.name).map((n) => `<tr><td>${esc(n.name)}${n.locationDescription ? ` (${esc(n.locationDescription)})` : ''}</td><td>${esc(n.fuel)}</td><td>${projectCapacity(n) ? esc(n.capacityMW ? mw(n.capacityMW) : `${mw(projectCapacity(n))}p`) : '–'}</td><td>${esc(n.operator)}</td><td>${esc(n.status)}</td><td>${n.openBy ? esc(n.openBy.slice(0, 7)) : '–'}</td></tr>`).join('')
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)} Compiled for this site from public sources, such as the developers' announcements.</p>
<table><thead><tr><th>Project</th><th>Fuel</th><th>Capacity</th><th>Operator</th><th>Status</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>`
  return { path, title: PIPELINE_TITLE, description, body, jsonLd: graph(webPage(path, heading, description, { breadcrumb: crumbs.jsonLd })) }
}

function homePage(defs: Definitions): Page {
  const description = 'Live map of New Zealand\'s electricity grid: every power station\'s generation, the generation mix, nodal prices, offers, HVDC flows and outages, every five minutes.'
  const byFuel = new Map<string, Generator[]>()
  for (const g of defs.generators) byFuel.set(primaryFuel(g), [...(byFuel.get(primaryFuel(g)) ?? []), g])
  const fuels = [...byFuel.keys()].sort((a, b) => (FUEL_ORDER.indexOf(a) + 1 || 99) - (FUEL_ORDER.indexOf(b) + 1 || 99))
  const substationLinks = (code: string) => linkList(sortByName(defs.substations.filter((s) => s.island === code), (s) => s.description)
    .map((s) => ({ href: substationPath(s, defs.substations), text: s.description })))
  const body = `<h1>${SITE_NAME}</h1>
<p>${esc(description)}</p>
<ul>
<li>The generation mix across New Zealand: hydro, geothermal, wind, solar, gas, coal, diesel and batteries, with an estimate of rooftop and other embedded solar.</li>
<li>Every grid-connected power station and substation on a map, with each one's output or demand, the price at its node and, for generators, their offers.</li>
<li>Flows across the <a href="${HVDC_PATH}">HVDC Inter-Island link</a>, planned outages, and the <a href="/pipeline">pipeline of new generation</a> being built.</li>
<li>Today, the last few days, or any day or range back to 2009, and totals over 90 days to all years.</li>
</ul>
<h2>Data</h2>
${SOURCES}
<h2>For developers and AI agents</h2>
<p>The data behind the map is available as JSON from <a href="${API_URL}/definitions">${API_URL}</a>, and to AI agents through an MCP server at ${MCP_URL}. See <a href="/llms.txt">llms.txt</a>.</p>
<h2>Power stations</h2>
${fuels.map((f) => `<h3>${esc(f)}</h3>${linkList(sortByName(byFuel.get(f) ?? [], (g) => g.name).map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}`).join('\n')}
<h2>Substations</h2>
<h3>North Island</h3>${substationLinks('north')}
<h3>South Island</h3>${substationLinks('south')}`
  const creator = { '@type': 'Person', name: 'Morgan French-Stagg', url: 'https://www.linkedin.com/in/morganfrenchstagg' }
  return {
    path: '/', title: HOME_TITLE, description, body,
    jsonLd: graph(
      { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: SITE_NAME, description, inLanguage: 'en-NZ' },
      {
        '@type': 'WebApplication', '@id': `${ORIGIN}/#app`, url: `${ORIGIN}/`, name: SITE_NAME, description,
        applicationCategory: 'ReferenceApplication', operatingSystem: 'Any', isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'NZD' }, creator,
      },
      {
        '@type': 'Dataset', '@id': `${ORIGIN}/#dataset`, url: `${ORIGIN}/`,
        name: 'New Zealand electricity generation, prices and offers',
        description: 'Five-minute generation by power station and fuel, nodal prices, offers, substation demand, HVDC flows and planned outages for New Zealand\'s national grid, reshaped from the Electricity Authority\'s EMI data and Transpower\'s.',
        keywords: ['New Zealand', 'electricity', 'generation', 'renewable energy', 'wholesale prices', 'national grid'],
        creator, license: CC_BY, isAccessibleForFree: true,
        isBasedOn: ['https://www.emi.ea.govt.nz', 'https://www.transpower.co.nz'],
        spatialCoverage: { '@type': 'Place', name: 'New Zealand' },
        distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${API_URL}/definitions` }],
      },
    ),
  }
}

export function buildPages(defs: Definitions, projects: UnderConstructionNode[] = underConstruction): Page[] {
  return [
    homePage(defs),
    hvdcPage(),
    pipelinePage(projects),
    ...defs.generators.map((g) => generatorPage(g, defs)),
    ...defs.substations.map((s) => substationPage(s, defs)),
  ]
}

// The file a page is written to, which Cloudflare Pages serves at its path without .html
export function pageFile(path: string): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}.html`
}

function fillBlock(html: string, marker: string, content: string): string {
  const block = new RegExp(`<!--${marker}-->[\\s\\S]*?<!--/${marker}-->`)
  if (!block.test(html)) throw new Error(`index.html has no <!--${marker}--> block`)
  return html.replace(block, () => content)
}

export function renderPage(template: string, page: Page): string {
  const url = ORIGIN + page.path
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
  const body = `<main class="prerender">\n${page.body}\n</main>`
  return fillBlock(fillBlock(template, 'page-head', head), 'page-body', body)
}

export function sitemap(pages: Page[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(ORIGIN + p.path)}</loc></url>`).join('\n')}
</urlset>
`
}

// Writes every page, and the sitemap, from the built index.html and the API's
// definitions. The build fails if they can't be fetched, rather than deploy
// without the station pages.
export function stationPages(apiBase: string): Plugin {
  return {
    name: 'station-pages',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('station-pages: no index.html in the bundle')
      const url = `${apiBase.replace(/\/$/, '')}/definitions`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`station-pages: ${url} answered ${response.status}`)
      const defs = await response.json() as Definitions
      if (!defs.generators?.length || !defs.substations?.length) throw new Error(`station-pages: ${url} has no generators or substations`)

      const template = String(index.source)
      const pages = buildPages(defs)
      for (const page of pages) {
        const html = renderPage(template, page)
        if (page.path === '/') index.source = html
        else this.emitFile({ type: 'asset', fileName: pageFile(page.path), source: html })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(pages) })
    },
  }
}
