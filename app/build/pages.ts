import type { Plugin } from 'vite'
import type { Generator, Substation, UnderConstructionNode } from '../src/types'
import { underConstruction } from '../src/data/underConstruction'
import { fuelColour } from '../src/utils/colours'
import { isCharging, isCommissioning, isDecommissioned, isRetired } from '../src/utils/generators'
import {
  generatorCapacity, generatorHistoricPath, generatorHistoricTitle, generatorPath, generatorTitle, HOME_TITLE, HVDC_PATH, HVDC_TITLE,
  PIPELINE_TITLE, SITE_NAME, stationKind, substationPath, substationTitle,
} from '../src/utils/stationPaths'
import {
  API_URL, article, breadcrumbs, capitalise, CC_BY, CREATOR, esc, fitDescription, fuelsText, graph, gwh, island,
  FOOTER, header, kindPhrase, link, linkList, MCP_URL, mw, nzDate, nzYear, ordinal, ORIGIN, pct, primaryFuel, sortByName, webPage,
} from './html'
import type { Definitions, Page } from './html'
import { generationNodes, hoursIn, parseStats, RENEWABLE_FUELS, substationDemand, sumNodes } from './stats'
import type { AnnualAggregates, Stats } from './stats'
import { FUEL_TOPICS, fuelPath, fuelTopic, islandPath, operatorPath, operatorsWithPages, RENEWABLE_PATH, topicNav, topicPages } from './topics'
import { buildContext, firstYear, gridShare, yearlyChart, yearlyTable } from './yearly'
import type { Context } from './yearly'

// The pages the build writes from index.html, each with its own title,
// description, canonical link and structured data, and its content as plain
// HTML inside #root, for search engines and AI agents, which mostly don't run
// the app. On a station's page the app replaces that content when it starts,
// and opens the station (see useUrlState); the topic pages are pages of their
// own (see topics.ts).

export { esc, ORIGIN }
export type { Definitions, Page }

const ACCENT = 'var(--color-accent)'

// What a station's page works out once for every station: each one's yearly
// generation, and where it ranked in the latest full year
interface StationFigures {
  yearly: Map<Generator, number[]>
  rank: Map<Generator, number>
}

function stationFigures(ctx: Context): StationFigures {
  const yearly = new Map<Generator, number[]>()
  if (!ctx.stats) return { yearly, rank: new Map() }
  for (const g of ctx.defs.generators) yearly.set(g, sumNodes(ctx.stats, generationNodes(g.units)))
  const ranked = ctx.full < 0 ? [] : [...yearly].filter(([, v]) => v[ctx.full] > 0).sort((a, b) => b[1][ctx.full] - a[1][ctx.full])
  return { yearly, rank: new Map(ranked.map(([g], i) => [g, i + 1])) }
}

// Its generation over its capacity through a year, when that capacity didn't
// change during it, so the one figure fits the whole year
function capacityFactor(g: Generator, year: number, energy: number): number | null {
  if (stationKind(g) === 'Battery') return null
  const units = g.units.filter((u) => !isCharging(u) && u.capacity > 0)
  const changed = units.some((u) => (u.commissioned && nzYear(u.commissioned) >= year) || (u.decomissioned && nzYear(u.decomissioned) >= year))
  if (changed) return null
  const capacity = units.filter((u) => !u.decomissioned).reduce((sum, u) => sum + u.capacity, 0)
  const factor = capacity > 0 ? (energy * 1000) / (capacity * hoursIn(year)) : 0
  return factor > 0 && factor <= 1 ? factor : null
}

function generatorStats(g: Generator, ctx: Context, figures: StationFigures): string {
  const { stats, total, full, current } = ctx
  const values = figures.yearly.get(g)
  if (!stats || !values) return ''
  const from = firstYear(values)
  if (from >= values.length) return ''
  const retired = isRetired(g)
  const sentences: string[] = []
  if (!retired && full >= 0 && values[full] > 0) {
    const year = stats.years[full]
    const rank = figures.rank.get(g)
    const factor = capacityFactor(g, year, values[full])
    sentences.push(`In ${year}, ${g.name} generated ${gwh(values[full])}, ${pct(values[full] / total[full])} of New Zealand's grid generation`
      + (rank ? `, the ${rank === 1 ? '' : `${ordinal(rank)} `}most of any station` : '')
      + (factor ? `, at a capacity factor of ${pct(factor)}` : '') + '.')
  }
  const fullYears = stats.years.map((_, i) => i).filter((i) => i >= from && !stats.partial.has(stats.years[i]))
  if (fullYears.length > 1) {
    const best = fullYears.reduce((b, i) => values[i] > values[b] ? i : b, fullYears[0])
    sentences.push(`Its best year was ${stats.years[best]}, with ${gwh(values[best])}.`)
  }
  if (!retired && current >= 0 && values[current] > 0) sentences.push(`So far in ${stats.years[current]}, it's generated ${gwh(values[current])}.`)
  return `<h2>Generation by year</h2>
${sentences.length ? `<p>${esc(sentences.join(' '))}</p>` : ''}
${yearlyChart(stats, values, from, {
    colour: fuelColour(primaryFuel(g)), unit: 'GWh', label: `${g.name}'s generation each year, in GWh`, format: gwh, name: 'Generation', more: [gridShare(ctx, values)],
  })}
${yearlyTable(stats, [{ head: 'Generation', values }], from)}`
}

// Links to the pages about its fuel, operator and island
function seeAlso(ctx: Context, g: Generator): string {
  const topic = fuelTopic(primaryFuel(g))
  const links = [
    topic ? link(fuelPath(topic), topic.heading) : '',
    operatorsWithPages(ctx.defs.generators).includes(g.operator) ? link(operatorPath(g.operator), `${g.operator}'s power stations`) : '',
    link(islandPath(g.island), `Electricity in the ${island(g.island)}`),
  ].filter(Boolean)
  return `<p>See also: ${links.join(' · ')}</p>`
}

function generatorPage(g: Generator, ctx: Context, figures: StationFigures): Page {
  const { defs } = ctx
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
  const [about, more] = retired
    ? [`${g.name} was ${sized} in the ${island(g.island)}, operated by ${operator}${decommissioned ? ` until ${nzYear(decommissioned)}` : ''}.`, 'See its historical generation.']
    : [`${g.name} is ${sized} in the ${island(g.island)}, operated by ${operator}.`, 'See its live and historical generation, offers and prices.']
  const description = fitDescription(about, more)
  const fuel = primaryFuel(g)
  const topic = fuelTopic(fuel)
  const others = sortByName(defs.generators.filter((o) => o !== g && primaryFuel(o) === fuel), (o) => o.name)
  const substation = defs.substations.find((s) => g.units.some((u) => u.node.slice(0, 3) === s.siteId))
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])

  const facts: [string, string][] = [
    ['Operator', operator],
    ['Fuel', capitalise(fuelsText(g))],
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
<p>${esc(`${about} ${more}`)}</p>
<dl class="prerender__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${generatorStats(g, ctx, figures)}
<p>${link(generatorHistoricPath(g, defs.generators), `${g.name}'s historical generation and records`)}</p>
<h2>Units</h2>
<table><thead><tr><th>Unit</th><th>Fuel</th><th>Capacity</th><th>Commissioned</th><th>Status</th></tr></thead><tbody>${unitRows}</tbody></table>
${substation ? `<p>Connected to the grid at ${link(substationPath(substation, defs.substations), `${substation.description} substation`)}.</p>` : ''}
${seeAlso(ctx, g)}
${others.length ? `<h2>Other ${esc((topic?.name ?? fuel).toLowerCase())} stations</h2>${linkList(others.map((o) => ({ href: generatorPath(o, defs.generators), text: o.name })))}` : ''}`

  const place = generatorPlace(g, defs)
  return {
    path, title: generatorTitle(g), description, body,
    jsonLd: graph(webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }), place),
  }
}

// The station its page and its history's page are about
function generatorPlace(g: Generator, defs: Definitions) {
  return {
    '@type': 'Place', '@id': `${ORIGIN}${generatorPath(g, defs.generators)}#station`, name: `${g.name} ${stationKind(g)}`,
    geo: { '@type': 'GeoCoordinates', latitude: g.location.lat, longitude: g.location.long },
    address: { '@type': 'PostalAddress', addressCountry: 'NZ' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Capacity', value: generatorCapacity(g), unitText: 'MW' },
      { '@type': 'PropertyValue', name: 'Fuel', value: fuelsText(g) },
      { '@type': 'PropertyValue', name: 'Operator', value: g.secondaryOperator ? `${g.operator} and ${g.secondaryOperator}` : g.operator },
    ],
  }
}

// What a history's page says of the years: when it's on record from, its
// best full year, its total, and for a retired station the last year it generated
function historicRecords(g: Generator, ctx: Context, values: number[], from: number): [string, string][] {
  const { stats, total } = ctx
  if (!stats) return []
  const records: [string, string][] = []
  const first = stats.years[from]
  records.push(['On record since', from === 0 && stats.partial.has(first) ? `August ${first}, when the records begin` : String(first)])
  const fullYears = stats.years.map((_, i) => i).filter((i) => i >= from && !stats.partial.has(stats.years[i]))
  if (fullYears.length > 0) {
    const best = fullYears.reduce((b, i) => values[i] > values[b] ? i : b, fullYears[0])
    records.push(['Best year', `${stats.years[best]}, with ${gwh(values[best])} (${pct(values[best] / total[best])} of the grid's generation)`])
  }
  records.push(['Generated on record', gwh(values.slice(from).reduce((sum, v) => sum + v, 0))])
  const last = values.findLastIndex((v) => Math.abs(v) >= 0.05)
  if (isRetired(g) && last >= from) records.push(['Last generated', String(stats.years[last])])
  return records
}

// A generator's history: its records and its generation and share of the grid's
// every year. The app opens it at All, with the records it finds by month and day.
function generatorHistoricPage(g: Generator, ctx: Context, figures: StationFigures): Page {
  const { defs, stats, total } = ctx
  const stationPath = generatorPath(g, defs.generators)
  const path = generatorHistoricPath(g, defs.generators)
  const station = `${g.name} ${stationKind(g)}`
  const heading = `${station}: Historical Generation`
  const values = figures.yearly.get(g)
  const from = values ? firstYear(values) : 0
  // Left out for a station with nothing on record yet
  const yearly = stats && values && from < values.length ? { stats, values } : null
  const since = yearly ? ` every year since ${yearly.stats.years[from]}` : ' by year, quarter and month'
  const records = ' and its records, from its best year to when it first generated'
  // Shorter than the page's intro, to stay within 160 characters (see fitDescription)
  // for the longest name, Te Puna Mauri ō Omaru's
  const description = `${g.name}'s generation${since}${yearly ? ", its share of New Zealand's grid" : ','}${records}.`
  const intro = `${g.name}'s electricity generation${since}${yearly ? ", its share of New Zealand's grid generation," : ','}${records}.`
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: station, path: stationPath }, { name: 'Historical generation', path }])
  const facts = yearly ? historicRecords(g, ctx, yearly.values, from) : []

  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(intro)}</p>
${facts.length ? `<h2>Records</h2>
<dl class="prerender__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
${yearly ? `<h2>Generation by year</h2>
${yearlyChart(yearly.stats, yearly.values, from, {
    colour: fuelColour(primaryFuel(g)), unit: 'GWh', label: `${g.name}'s generation each year, in GWh`, format: gwh, name: 'Generation', more: [gridShare(ctx, yearly.values)],
  })}
${yearlyTable(yearly.stats, [
    { head: 'Generation', values: yearly.values },
    { head: "Share of the grid's generation", values: yearly.values.map((v, i) => total[i] > 0 ? v / total[i] : 0), share: true },
  ], from)}` : ''}
<p>${link(stationPath, station)}: its units, capacity, and ${isRetired(g) ? 'when it was retired' : 'live generation, offers and prices'}.</p>
${seeAlso(ctx, g)}`

  const place = generatorPlace(g, defs)
  return {
    path, title: generatorHistoricTitle(g), description, body,
    jsonLd: graph(webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }), place),
  }
}

function substationStats(s: Substation, ctx: Context): string {
  const { stats, full } = ctx
  if (!stats || full < 0) return ''
  const values = substationDemand(stats, s.siteId)
  if (!(values[full] > 0.05)) return ''
  const from = firstYear(values)
  const before = full - 10 >= from && values[full - 10] > 0 ? full - 10 : -1
  const change = before >= 0 ? values[full] / values[before] - 1 : 0
  const sentence = `In ${stats.years[full]}, ${gwh(values[full])} was taken from the grid at ${s.description}`
    + (before < 0 ? '' : Math.abs(change) < 0.005 ? `, about the same as in ${stats.years[before]}` : `, ${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on ${stats.years[before]}`) + '.'
  return `<h2>Demand by year</h2>
<p>${esc(sentence)}</p>
${yearlyChart(stats, values, from, {
    colour: ACCENT, unit: 'GWh', label: `Electricity taken from the grid at ${s.description} each year, in GWh`, format: gwh, name: 'Taken from the grid',
  })}
${yearlyTable(stats, [{ head: 'Taken from the grid', values }], from)}`
}

function substationPage(s: Substation, ctx: Context): Page {
  const { defs } = ctx
  const path = substationPath(s, defs.substations)
  const heading = `${s.description} Substation`
  const intro = `Live electricity demand and nodal prices at ${s.description} substation (${s.siteId}) on New Zealand's national grid, in the ${island(s.island)}. Updated every five minutes, with history.`
  const description = fitDescription(`${s.description} substation (${s.siteId}), ${island(s.island)}: live electricity demand and nodal prices on New Zealand's national grid.`, 'Updated every five minutes, with history.')
  const generators = sortByName(defs.generators.filter((g) => g.units.some((u) => u.node.slice(0, 3) === s.siteId)), (g) => g.name)
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])
  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(intro)}</p>
<dl class="prerender__facts"><dt>Site code</dt><dd>${esc(s.siteId)}</dd><dt>Island</dt><dd>${island(s.island)}</dd><dt>Type</dt><dd>${s.type === 'TEE' ? 'Tee point' : 'Substation'}</dd></dl>
${substationStats(s, ctx)}
${generators.length ? `<h2>Generation connected here</h2>${linkList(generators.map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}` : ''}
<p>See also: ${link(islandPath(s.island === 'north' ? 'NI' : 'SI'), `Electricity in the ${island(s.island)}`)}</p>`
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

function hvdcStats(ctx: Context): string {
  const { stats, full } = ctx
  const hvdc = stats?.hvdc
  if (!stats || !hvdc || full < 0) return ''
  return `<h2>Flows by year</h2>
<p>In ${stats.years[full]}, the link sent ${esc(gwh(hvdc.north[full]))} north and ${esc(gwh(hvdc.south[full]))} south.</p>
${yearlyTable(stats, [{ head: 'Sent north', values: hvdc.north }, { head: 'Sent south', values: hvdc.south }])}`
}

function hvdcPage(ctx: Context): Page {
  const heading = 'HVDC Inter-Island Link'
  const description = `Live power flows north and south across New Zealand's HVDC Inter-Island link between Benmore and Haywards, with its transfer limits and history.`
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path: HVDC_PATH }])
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)}</p>
<p>The high-voltage direct current (HVDC) link joins the South Island's grid at Benmore to the North Island's at Haywards, crossing Cook Strait by submarine cable.</p>
${hvdcStats(ctx)}
<p>Flows from EMI's metered HVDC data, and from <a href="https://www.em6.co.nz">em6</a> for the days since EMI's latest month. Transfer limits from em6.</p>
<p>See also: ${link(islandPath('NI'), 'Electricity in the North Island')} · ${link(islandPath('SI'), 'Electricity in the South Island')}</p>`
  return { path: HVDC_PATH, title: HVDC_TITLE, description, body, jsonLd: graph(webPage(HVDC_PATH, heading, description, { breadcrumb: crumbs.jsonLd })) }
}

function projectCapacity(n: UnderConstructionNode): number {
  return n.capacityMW ?? n.capacityMWp ?? 0
}

function pipelinePage(projects: UnderConstructionNode[]): Page {
  const path = '/pipeline'
  const heading = 'New Zealand Generation Pipeline'
  const total = projects.reduce((sum, n) => sum + projectCapacity(n), 0)
  const description = `${projects.length} new generation projects being built or committed in New Zealand, ${mw(Math.round(total))} in all: their fuel, capacity, operator, status and when they're due to open.`
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])
  const rows = sortByName(projects, (n) => n.name).map((n) => `<tr><td>${esc(n.name)}${n.locationDescription ? ` (${esc(n.locationDescription)})` : ''}</td><td>${esc(n.fuel)}</td><td>${projectCapacity(n) ? esc(n.capacityMW ? mw(n.capacityMW) : `${mw(projectCapacity(n))}p`) : '–'}</td><td>${esc(n.operator)}</td><td>${esc(n.status)}</td><td>${n.openBy ? esc(n.openBy.slice(0, 7)) : '–'}</td></tr>`).join('')
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)} Compiled for this site from public sources, such as the developers' announcements.</p>
<table><thead><tr><th>Project</th><th>Fuel</th><th>Capacity</th><th>Operator</th><th>Status</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>`
  return { path, title: PIPELINE_TITLE, description, body, jsonLd: graph(webPage(path, heading, description, { breadcrumb: crumbs.jsonLd })) }
}

// The renewable share in the latest full year, for the home page to lead with
function renewableLead(ctx: Context): string {
  const { stats, total, full } = ctx
  if (!stats || full < 0 || !(total[full] > 0)) return ''
  const nodes = ctx.defs.generators.flatMap((g) => generationNodes(g.units.filter((u) => RENEWABLE_FUELS.includes(u.fuel))))
  const share = sumNodes(stats, nodes)[full] / total[full]
  return `<p>In ${stats.years[full]}, ${pct(share)} of the electricity generated on New Zealand's national grid was renewable. ${link(RENEWABLE_PATH, 'How renewable is New Zealand\'s electricity?')}</p>`
}

function homePage(ctx: Context): Page {
  const { defs } = ctx
  const description = 'Live map of New Zealand\'s electricity grid: every power station\'s output, the generation mix, nodal prices, offers, HVDC flows and outages, every five minutes.'
  const byFuel = new Map<string, Generator[]>()
  for (const g of defs.generators) byFuel.set(primaryFuel(g), [...(byFuel.get(primaryFuel(g)) ?? []), g])
  const order = FUEL_TOPICS.map((t) => t.fuel)
  const fuels = [...byFuel.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  const substationLinks = (code: string) => linkList(sortByName(defs.substations.filter((s) => s.island === code), (s) => s.description)
    .map((s) => ({ href: substationPath(s, defs.substations), text: s.description })))
  const fuelHeading = (fuel: string) => {
    const topic = fuelTopic(fuel)
    return topic ? link(fuelPath(topic), topic.name) : esc(fuel)
  }
  const body = `<h1>${SITE_NAME}</h1>
<p>${esc(description)}</p>
${renewableLead(ctx)}
<ul>
<li>The generation mix across New Zealand: hydro, geothermal, wind, solar, gas, coal, diesel and batteries, with an estimate of rooftop and other embedded solar.</li>
<li>Every grid-connected power station and substation on a map, with each one's output or demand, the price at its node and, for generators, their offers.</li>
<li>Flows across the <a href="${HVDC_PATH}">HVDC Inter-Island link</a>, planned outages, and the <a href="/pipeline">pipeline of new generation</a> being built.</li>
<li>Today, the last few days, or any day or range back to 2009, and totals over 90 days to all years.</li>
</ul>
${topicNav(ctx, 'Analysis')}
<h2>For developers and AI agents</h2>
<p>The data behind the map is available as JSON from <a href="${API_URL}/definitions">${API_URL}</a>, and to AI agents through an MCP server at ${MCP_URL}. See <a href="/llms.txt">llms.txt</a>.</p>
<h2>Power stations</h2>
${fuels.map((f) => `<h3>${fuelHeading(f)}</h3>${linkList(sortByName(byFuel.get(f) ?? [], (g) => g.name).map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}`).join('\n')}
<h2>Substations</h2>
<h3>North Island</h3>${substationLinks('north')}
<h3>South Island</h3>${substationLinks('south')}`
  return {
    path: '/', title: HOME_TITLE, description, body,
    jsonLd: graph(
      { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: SITE_NAME, description, inLanguage: 'en-NZ', creator: { '@id': CREATOR['@id'] } },
      {
        '@type': 'WebApplication', '@id': `${ORIGIN}/#app`, url: `${ORIGIN}/`, name: SITE_NAME, description,
        applicationCategory: 'ReferenceApplication', operatingSystem: 'Any', isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'NZD' }, creator: { '@id': CREATOR['@id'] },
      },
      {
        '@type': 'Dataset', '@id': `${ORIGIN}/#dataset`, url: `${ORIGIN}/`,
        name: 'New Zealand electricity generation, prices and offers',
        description: 'Five-minute generation by power station and fuel, nodal prices, offers, substation demand, HVDC flows and planned outages for New Zealand\'s national grid, reshaped from the Electricity Authority\'s EMI data and Transpower\'s.',
        keywords: ['New Zealand', 'electricity', 'generation', 'renewable energy', 'wholesale prices', 'national grid'],
        creator: { '@id': CREATOR['@id'] }, license: CC_BY, isAccessibleForFree: true,
        isBasedOn: ['https://www.emi.ea.govt.nz', 'https://www.transpower.co.nz'],
        spatialCoverage: { '@type': 'Place', name: 'New Zealand' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${API_URL}/definitions` },
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${API_URL}/dispatch/aggregates/annual` },
        ],
      },
    ),
  }
}

export function buildPages(defs: Definitions, projects: UnderConstructionNode[] = underConstruction, stats: Stats | null = null): Page[] {
  const ctx = buildContext(defs, stats)
  const figures = stationFigures(ctx)
  return [
    homePage(ctx),
    hvdcPage(ctx),
    pipelinePage(projects),
    ...topicPages(ctx),
    ...defs.generators.flatMap((g) => [generatorPage(g, ctx, figures), generatorHistoricPage(g, ctx, figures)]),
    ...defs.substations.map((s) => substationPage(s, ctx)),
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

// A page from the built index.html. A page of its own with a chart loads
// `chartScript`, the charts' tooltips (see src/chartTooltip.ts), in place of the app.
export function renderPage(template: string, page: Page, chartScript?: string): string {
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
  const body = `<div class="prerender">\n${header(page.live ?? '/', page.path)}\n<main class="prerender__main">\n${page.body}\n</main>\n${FOOTER}\n</div>`
  const html = fillBlock(fillBlock(template, 'page-head', head), 'page-body', body)
  if (!page.standalone) return html
  // A page of its own keeps the stylesheet but not the app, which would replace its content
  const own = html.replace(/\s*<script type="module"[^>]*><\/script>/g, '').replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
  return chartScript && page.body.includes('class="prerender__chart"')
    ? own.replace('</head>', `  <script type="module" src="${esc(chartScript)}"></script>\n  </head>`)
    : own
}

export function sitemap(pages: Page[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(ORIGIN + p.path)}</loc></url>`).join('\n')}
</urlset>
`
}

// The API's /definitions is its generators.json and substations.json as they
// are, so the build reads them from its repo: Cloudflare's bot protection
// answers GitHub's runners with a 403 on the API itself. VITE_API_BASE reads
// another API's /definitions instead, e.g. a branch's preview deployment.
const DEFINITIONS_REPO = 'https://raw.githubusercontent.com/morganfrenchstagg/nz-electricity-stats-api/main/src/data'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json() as T
}

async function loadDefinitions(apiBase?: string): Promise<Definitions> {
  if (apiBase) return getJson<Definitions>(`${apiBase.replace(/\/$/, '')}/definitions`)
  const [generators, substations] = await Promise.all([
    getJson<Generator[]>(`${DEFINITIONS_REPO}/generators.json`),
    getJson<Substation[]>(`${DEFINITIONS_REPO}/substations.json`),
  ])
  return { generators, substations }
}

// The API at its workers.dev address, which isn't behind frenchsta.gg's bot
// protection, so GitHub's runners can reach it
const BUILD_API_URL = 'https://nz-electricity-stats-api.morgan6725.workers.dev/v1'

// The yearly totals come from the API itself
async function loadStats(apiBase?: string): Promise<Stats> {
  const url = `${(apiBase ?? BUILD_API_URL).replace(/\/$/, '')}/dispatch/aggregates/annual`
  const stats = parseStats(await getJson<AnnualAggregates>(url), nzYear(new Date()))
  console.log(`station-pages: yearly figures for ${stats.years[0]}–${stats.years[stats.years.length - 1]}`)
  return stats
}

// Writes every page, and the sitemap, from the built index.html, the
// definitions and the yearly totals. The build fails if either can't be
// fetched, so a deploy never replaces the pages with ones that lack their
// figures, or drops the pages that are nothing but figures.
export function stationPages(apiBase?: string): Plugin {
  return {
    name: 'station-pages',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('station-pages: no index.html in the bundle')
      const [defs, stats] = await Promise.all([loadDefinitions(apiBase), loadStats(apiBase)])
        .catch((error: Error) => { throw new Error(`station-pages: ${error.message}`) })
      if (!defs.generators?.length || !defs.substations?.length) throw new Error('station-pages: the definitions have no generators or substations')

      const tooltips = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry && file.name === 'chartTooltip')
      if (!tooltips) throw new Error('station-pages: no chartTooltip entry in the bundle (see vite.config.ts)')

      const template = String(index.source)
      const pages = buildPages(defs, underConstruction, stats)
      for (const page of pages) {
        const html = renderPage(template, page, `/${tooltips.fileName}`)
        if (page.path === '/') index.source = html
        else this.emitFile({ type: 'asset', fileName: pageFile(page.path), source: html })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(pages) })
    },
  }
}
