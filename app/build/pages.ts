import type { Plugin } from 'vite'
import type { Generator, Substation, UnderConstructionNode } from '../src/types'
import { underConstruction } from '../src/data/underConstruction'
import { fuelColour } from '../src/utils/colours'
import { isCharging, isCommissioning, isDecommissioned, isRetired } from '../src/utils/generators'
import {
  generatorCapacity,
  generatorHistoricPath,
  generatorHistoricTitle,
  generatorPath,
  generatorTitle,
  HOME_TITLE,
  HVDC_PATH,
  HVDC_TITLE,
  PIPELINE_TITLE,
  SITE_NAME,
  stationKind,
  substationPath,
  substationTitle,
} from '../src/utils/stationPaths'
import {
  AGENT_DATA,
  API_URL,
  article,
  breadcrumbs,
  capitalise,
  CC_BY,
  CREATOR,
  esc,
  fitDescription,
  fuelsText,
  graph,
  gwh,
  island,
  FOOTER,
  header,
  kindPhrase,
  link,
  linkList,
  LLMS_TXT_LINK,
  mw,
  nzDate,
  nzYear,
  ordinal,
  ORIGIN,
  pct,
  primaryFuel,
  sortByName,
  webPage,
} from './html'
import type { Definitions, Page } from './html'
import {
  generationNodes,
  hoursIn,
  parseMonthly,
  parseStats,
  RENEWABLE_FUELS,
  substationDemand,
  sumMonthly,
  sumNodes,
} from './stats'
import type { AnnualAggregates, MonthlyStats, Stats } from './stats'
import {
  FUEL_TOPICS,
  fuelPath,
  fuelTopic,
  islandPath,
  operatorPath,
  operatorsWithPages,
  RENEWABLE_PATH,
  topicNav,
  topicPages,
} from './topics'
import { buildContext, firstYear, gridShare, monthlyTable, monthName, yearlyChart, yearlyTable } from './yearly'
import type { Context } from './yearly'
import { pageMarkdown } from './markdown'
import { markdownPath } from '../edge/markdown'
import { todayHtmlPlaceholder, todayPlaceholder } from '../edge/today'

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
  const ranked =
    ctx.full < 0 ? [] : [...yearly].filter(([, v]) => v[ctx.full] > 0).sort((a, b) => b[1][ctx.full] - a[1][ctx.full])
  return { yearly, rank: new Map(ranked.map(([g], i) => [g, i + 1])) }
}

// Its generation over its capacity through a year, when that capacity didn't
// change during it, so the one figure fits the whole year
function capacityFactor(g: Generator, year: number, energy: number): number | null {
  if (stationKind(g) === 'Battery') return null
  const units = g.units.filter((u) => !isCharging(u) && u.capacity > 0)
  const changed = units.some(
    (u) => (u.commissioned && nzYear(u.commissioned) >= year) || (u.decomissioned && nzYear(u.decomissioned) >= year),
  )
  if (changed) return null
  const capacity = units.filter((u) => !u.decomissioned).reduce((sum, u) => sum + u.capacity, 0)
  const factor = capacity > 0 ? (energy * 1000) / (capacity * hoursIn(year)) : 0
  return factor > 0 && factor <= 1 ? factor : null
}

// The year a station's figures end: for a retired one, the year it last
// generated in, and for one in service, this year. A retired battery's years of
// charging more than it discharged don't count.
function lastYear(g: Generator, ctx: Context, values: number[]): number {
  if (!ctx.stats || !isRetired(g)) return values.length - 1
  const day = ctx.lastGenerated.get(g.site)
  const i = day ? ctx.stats.years.indexOf(Number(day.slice(0, 4))) : -1
  return i >= 0 ? i : values.findLastIndex((v) => v >= 0.05)
}

// That a retired station is decommissioned, and when it last generated
function decommissionedNote(g: Generator, ctx: Context): string {
  const day = ctx.lastGenerated.get(g.site)
  return day ? `It's now decommissioned, and last generated on ${nzDate(day)}.` : "It's now decommissioned."
}

function generatorStats(g: Generator, ctx: Context, figures: StationFigures): string {
  const { stats, total, full, current } = ctx
  const values = figures.yearly.get(g)
  if (!stats || !values) return ''
  const from = firstYear(values)
  const to = lastYear(g, ctx, values)
  if (from > to) return ''
  const retired = isRetired(g)
  const sentences: string[] = []
  if (!retired && full >= 0 && values[full] > 0) {
    const year = stats.years[full]
    const rank = figures.rank.get(g)
    const factor = capacityFactor(g, year, values[full])
    sentences.push(
      `In ${year}, ${g.name} generated ${gwh(values[full])}, ${pct(values[full] / total[full])} of New Zealand's grid generation` +
        (rank ? `, the ${rank === 1 ? '' : `${ordinal(rank)} `}most of any station` : '') +
        (factor ? `, at a capacity factor of ${pct(factor)}` : '') +
        '.',
    )
  }
  const fullYears = stats.years
    .map((_, i) => i)
    .filter((i) => i >= from && i <= to && !stats.partial.has(stats.years[i]))
  if (fullYears.length > 1) {
    const best = fullYears.reduce((b, i) => (values[i] > values[b] ? i : b), fullYears[0])
    sentences.push(`Its best year was ${stats.years[best]}, with ${gwh(values[best])}.`)
  }
  if (!retired && current >= 0 && values[current] > 0)
    sentences.push(`So far in ${stats.years[current]}, it's generated ${gwh(values[current])}.`)
  return `<h2>Generation by year</h2>
${sentences.length ? `<p>${esc(sentences.join(' '))}</p>` : ''}
${yearlyChart(stats, values, from, {
  colour: fuelColour(primaryFuel(g)),
  unit: 'GWh',
  label: `${g.name}'s generation each year, in GWh`,
  format: gwh,
  name: 'Generation',
  more: [gridShare(ctx, values)],
  to,
})}
${yearlyTable(stats, [{ head: 'Generation', values }], from, to)}`
}

// Links to the pages about its fuel, operator and island
function seeAlso(ctx: Context, g: Generator): string {
  const topic = fuelTopic(primaryFuel(g))
  const links = [
    topic ? link(fuelPath(topic), topic.heading) : '',
    operatorsWithPages(ctx.defs.generators).includes(g.operator)
      ? link(operatorPath(g.operator), `${g.operator}'s power stations`)
      : '',
    link(islandPath(g.island), `Electricity in the ${island(g.island)}`),
  ].filter(Boolean)
  return `<p>See also: ${links.join(' · ')}</p>`
}

// The 5-minute dispatch begins on this day. Before it, back to August 1997, the
// data is half-hourly metered generation.
const FIVE_MINUTE_FROM = '2020-09-11'

// For agents, in the Markdown of a station's pages: that its generation is
// there every 5 minutes (or half hour) and day by day, and the MCP tools' and
// API routes' calls that get it. The tools take its site code, which no other
// station shares. The API's routes take its units' nodes, as other stations
// share their buses.
function stationData(g: Generator): string {
  const dates = (key: 'commissioned' | 'decomissioned') =>
    g.units
      .map((u) => u[key]?.slice(0, 10))
      .filter((d): d is string => !!d)
      .sort()
  const retiredOn = isRetired(g) ? dates('decomissioned').pop() : undefined
  const fiveMinute = !retiredOn || retiredOn >= FIVE_MINUTE_FROM
  const firstCommissioned = dates('commissioned')[0]
  const coverage = !fiveMinute
    ? 'every half hour while it ran, back to August 1997 (the 5-minute data starts on 11 September 2020, after it was retired)'
    : firstCommissioned && firstCommissioned >= FIVE_MINUTE_FROM
      ? 'every 5 minutes'
      : 'every 5 minutes from 11 September 2020, and every half hour before that back to August 1997'
  const nodes = generationNodes(g.units)
  const code = (text: string) => `<code>${esc(text)}</code>`
  const tool = (name: string, args: object) =>
    `the MCP tool ${code(name)} with ${code(JSON.stringify({ station: [g.site], ...args }))}`
  const day = { date: 'YYYY-MM-DD', resolution: fiveMinute ? '5min' : '30min', group_by: 'unit' }
  const days = { resolution: 'daily', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
  const aggregates = `${API_URL}/dispatch/aggregates/YYYY/MM?nodes=${nodes.map(encodeURIComponent).join(',')}`
  return `<h2>${fiveMinute ? 'Daily and 5-minute data' : 'Daily and half-hourly data'}</h2>
<p>${esc(`The MCP server and the API have ${g.name}'s generation ${coverage}, unit by unit, and its daily totals.`)}</p>
<ul>
<li>Through a day: ${tool('get_day_profile', day)}, or every node's from the API's ${code(`${API_URL}/dispatch/YYYY-MM-DD`)}</li>
<li>Day by day: ${tool('get_energy', days)}, or each day of a month, in MWh, from ${code(aggregates)}</li>
${retiredOn ? '' : `<li>Right now: ${tool('get_current_state', { group_by: 'unit' })}, or the latest 5 minutes from ${code(`${API_URL}/dispatch/latest`)}</li>\n`}</ul>
<p>Its units' nodes in the API's data: ${nodes.map(code).join(', ')}</p>`
}

function generatorPage(g: Generator, ctx: Context, figures: StationFigures): Page {
  const { defs } = ctx
  const path = generatorPath(g, defs.generators)
  const retired = isRetired(g)
  const capacity = generatorCapacity(g)
  const operator = g.secondaryOperator ? `${g.operator} and ${g.secondaryOperator}` : g.operator
  const commissioned = g.units
    .map((u) => u.commissioned)
    .filter((d): d is string => !!d)
    .sort()[0]
  const decommissioned = g.units
    .map((u) => u.decomissioned)
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  const kind = stationKind(g)
  const heading = `${g.name} ${kind}`
  // Some, such as an aggregated fleet of home batteries, have no capacity of their own
  const sized = capacity > 0 ? `${article(capacity)} ${mw(capacity)} ${kindPhrase(g)}` : `a ${kindPhrase(g)}`
  const [about, more] = retired
    ? [
        `${g.name} was ${sized} in the ${island(g.island)}, operated by ${operator}${decommissioned ? ` until ${nzYear(decommissioned)}` : ''}.`,
        'See its historical generation.',
      ]
    : [
        `${g.name} is ${sized} in the ${island(g.island)}, operated by ${operator}.`,
        'See its live and historical generation, offers and prices.',
      ]
  const description = fitDescription(about, more)
  const fuel = primaryFuel(g)
  const topic = fuelTopic(fuel)
  const others = sortByName(
    defs.generators.filter((o) => o !== g && primaryFuel(o) === fuel),
    (o) => o.name,
  )
  const substation = defs.substations.find((s) => g.units.some((u) => u.node.slice(0, 3) === s.siteId))
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: heading, path },
  ])

  const facts: [string, string][] = [
    ['Operator', operator],
    ['Fuel', capitalise(fuelsText(g))],
    ...(capacity > 0
      ? [[retired ? 'Capacity (when decommissioned)' : 'Capacity', mw(capacity)] as [string, string]]
      : []),
    ['Island', island(g.island)],
    ...(g.scheme ? [['Scheme', g.scheme] as [string, string]] : []),
    ...(commissioned ? [['First commissioned', nzDate(commissioned)] as [string, string]] : []),
    ...(retired && decommissioned ? [['Decommissioned', nzDate(decommissioned)] as [string, string]] : []),
    ...(retired && ctx.lastGenerated.has(g.site)
      ? [['Last generated', nzDate(ctx.lastGenerated.get(g.site) ?? '')] as [string, string]]
      : []),
    ['Site code', g.site],
  ]
  // Not a battery's charging unit, nor one standing in for units only metered together
  const unitRows = g.units
    .filter((u) => !isCharging(u) && !u.combines)
    .map((u) => {
      const status = isDecommissioned(u) ? 'Retired' : isCommissioning(u) ? 'Commissioning' : 'In service'
      return `<tr><td>${esc(u.name)} (${esc(u.unitCode)})</td><td>${esc(u.fuel)}</td><td>${u.capacity ? esc(mw(u.capacity)) : '–'}</td><td>${u.commissioned ? esc(nzDate(u.commissioned)) : '–'}</td><td>${status}</td></tr>`
    })
    .join('')

  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(retired ? `${about} ${decommissionedNote(g, ctx)} ${more}` : `${about} ${more}`)}</p>
<dl class="prerender__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${retired ? '' : todayHtmlPlaceholder(g.site)}
${generatorStats(g, ctx, figures)}
<p>${link(generatorHistoricPath(g, defs.generators), `${g.name}'s historical generation and records`)}</p>
<h2>Units</h2>
<table><thead><tr><th>Unit</th><th>Fuel</th><th>Capacity</th><th>Commissioned</th><th>Status</th></tr></thead><tbody>${unitRows}</tbody></table>
${substation ? `<p>Connected to the grid at ${link(substationPath(substation, defs.substations), `${substation.description} substation`)}.</p>` : ''}
${seeAlso(ctx, g)}
${others.length ? `<h2>Other ${esc((topic?.name ?? fuel).toLowerCase())} stations</h2>${linkList(others.map((o) => ({ href: generatorPath(o, defs.generators), text: o.name })))}` : ''}`

  const place = generatorPlace(g, defs)
  return {
    path,
    title: generatorTitle(g),
    description,
    body,
    agentData: stationData(g),
    today: retired ? undefined : todayPlaceholder('Its generation', { station: [g.site] }),
    jsonLd: graph(
      webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }),
      place,
    ),
  }
}

// The station its page and its history's page are about
function generatorPlace(g: Generator, defs: Definitions) {
  return {
    '@type': 'Place',
    '@id': `${ORIGIN}${generatorPath(g, defs.generators)}#station`,
    name: `${g.name} ${stationKind(g)}`,
    geo: { '@type': 'GeoCoordinates', latitude: g.location.lat, longitude: g.location.long },
    address: { '@type': 'PostalAddress', addressCountry: 'NZ' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Capacity', value: generatorCapacity(g), unitText: 'MW' },
      { '@type': 'PropertyValue', name: 'Fuel', value: fuelsText(g) },
      {
        '@type': 'PropertyValue',
        name: 'Operator',
        value: g.secondaryOperator ? `${g.operator} and ${g.secondaryOperator}` : g.operator,
      },
    ],
  }
}

// What a history's page says of the years: when it's on record from, its
// best full year, its total, and for a retired station the last year it generated
function historicRecords(
  g: Generator,
  ctx: Context,
  values: number[],
  from: number,
  months: number[] | null,
): [string, string][] {
  const { stats, total } = ctx
  if (!stats) return []
  const records: [string, string][] = []
  const first = stats.years[from]
  const to = lastYear(g, ctx, values)
  records.push([
    'On record since',
    from === 0 && stats.partial.has(first) ? `August ${first}, when the records begin` : String(first),
  ])
  const fullYears = stats.years
    .map((_, i) => i)
    .filter((i) => i >= from && i <= to && !stats.partial.has(stats.years[i]))
  if (fullYears.length > 0) {
    const best = fullYears.reduce((b, i) => (values[i] > values[b] ? i : b), fullYears[0])
    records.push([
      'Best year',
      `${stats.years[best]}, with ${gwh(values[best])} (${pct(values[best] / total[best])} of the grid's generation)`,
    ])
  }
  // Of the months wholly covered: all but this one so far
  if (ctx.monthly && months) {
    const whole = months.slice(0, -1)
    const best = whole.reduce((b, v, i) => (v > whole[b] ? i : b), 0)
    if (whole[best] >= 0.05)
      records.push(['Best month', `${monthName(ctx.monthly.months[best])}, with ${gwh(whole[best])}`])
  }
  records.push(['Generated on record', gwh(values.slice(from, to + 1).reduce((sum, v) => sum + v, 0))])
  if (isRetired(g)) {
    const day = ctx.lastGenerated.get(g.site)
    if (day) records.push(['Last generated', nzDate(day)])
    else if (to >= from) records.push(['Last generated', String(stats.years[to])])
  }
  return records
}

// Its generation every month, to this one so far, or for a retired station to
// the last it generated in
function monthlySection(g: Generator, ctx: Context, monthly: MonthlyStats, months: number[]): string {
  const retired = isRetired(g)
  const day = ctx.lastGenerated.get(g.site)
  const to = !retired
    ? months.length - 1
    : day
      ? monthly.months.indexOf(day.slice(0, 7))
      : months.findLastIndex((v) => v >= 0.05)
  const table = monthlyTable(monthly, months, to)
  if (!table) return ''
  const current = retired ? '' : `, ${monthName(monthly.months[months.length - 1])} only so far`
  return `<h2>Generation by month</h2>
<p>${esc(`${g.name}'s generation each month, in GWh${current}.`)}</p>
${table}`
}

// A generator's history: its records and its generation and share of the grid's
// every year and month. The app opens it at All, with the records it finds by month and day.
function generatorHistoricPage(g: Generator, ctx: Context, figures: StationFigures): Page {
  const { defs, stats, total } = ctx
  const stationPath = generatorPath(g, defs.generators)
  const path = generatorHistoricPath(g, defs.generators)
  const station = `${g.name} ${stationKind(g)}`
  const heading = `${station}: Historical Generation`
  const values = figures.yearly.get(g)
  const from = values ? firstYear(values) : 0
  // Left out for a station with nothing on record yet
  const to = values ? lastYear(g, ctx, values) : -1
  const yearly = stats && values && from <= to ? { stats, values } : null
  const retired = isRetired(g)
  const since = !yearly
    ? ' by year, quarter and month'
    : retired
      ? ` every year from ${yearly.stats.years[from]} to ${yearly.stats.years[to]}`
      : ` every year since ${yearly.stats.years[from]}`
  const records = ' and its records, from its best year to when it first generated'
  // Shorter than the page's intro, to stay within 160 characters (see fitDescription)
  // for the longest name, Te Puna Mauri ō Omaru's
  const description = `${g.name}'s generation${since}${yearly ? ", its share of New Zealand's grid" : ','}${records}.`
  const intro = `${g.name}'s electricity generation${since}${yearly ? ", its share of New Zealand's grid generation," : ','}${records}.`
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: station, path: stationPath },
    { name: 'Historical generation', path },
  ])
  const months = ctx.monthly ? sumMonthly(ctx.monthly, generationNodes(g.units)) : null
  const facts = yearly ? historicRecords(g, ctx, yearly.values, from, months) : []
  const byMonth = ctx.monthly && months ? monthlySection(g, ctx, ctx.monthly, months) : ''

  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(retired ? `${intro} ${decommissionedNote(g, ctx)}` : intro)}</p>
${
  facts.length
    ? `<h2>Records</h2>
<dl class="prerender__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
    : ''
}
${
  yearly
    ? `<h2>Generation by year</h2>
${yearlyChart(yearly.stats, yearly.values, from, {
  colour: fuelColour(primaryFuel(g)),
  unit: 'GWh',
  label: `${g.name}'s generation each year, in GWh`,
  format: gwh,
  name: 'Generation',
  more: [gridShare(ctx, yearly.values)],
  to,
})}
${yearlyTable(
  yearly.stats,
  [
    { head: 'Generation', values: yearly.values },
    {
      head: "Share of the grid's generation",
      values: yearly.values.map((v, i) => (total[i] > 0 ? v / total[i] : 0)),
      share: true,
    },
  ],
  from,
  to,
)}`
    : ''
}
${byMonth}
<p>${link(stationPath, station)}: its units, capacity, and ${retired ? 'when it was decommissioned' : 'live generation, offers and prices'}.</p>
${seeAlso(ctx, g)}`

  const place = generatorPlace(g, defs)
  return {
    path,
    title: generatorHistoricTitle(g),
    description,
    body,
    agentData: stationData(g),
    jsonLd: graph(
      webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }),
      place,
    ),
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
  const sentence =
    `In ${stats.years[full]}, ${gwh(values[full])} was taken from the grid at ${s.description}` +
    (before < 0
      ? ''
      : Math.abs(change) < 0.005
        ? `, about the same as in ${stats.years[before]}`
        : `, ${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on ${stats.years[before]}`) +
    '.'
  return `<h2>Demand by year</h2>
<p>${esc(sentence)}</p>
${yearlyChart(stats, values, from, {
  colour: ACCENT,
  unit: 'GWh',
  label: `Electricity taken from the grid at ${s.description} each year, in GWh`,
  format: gwh,
  name: 'Taken from the grid',
})}
${yearlyTable(stats, [{ head: 'Taken from the grid', values }], from)}`
}

function substationPage(s: Substation, ctx: Context): Page {
  const { defs } = ctx
  const path = substationPath(s, defs.substations)
  const heading = `${s.description} Substation`
  const intro = `Live electricity demand and nodal prices at ${s.description} substation (${s.siteId}) on New Zealand's national grid, in the ${island(s.island)}. Updated every five minutes, with history.`
  const description = fitDescription(
    `${s.description} substation (${s.siteId}), ${island(s.island)}: live electricity demand and nodal prices on New Zealand's national grid.`,
    'Updated every five minutes, with history.',
  )
  const generators = sortByName(
    defs.generators.filter((g) => g.units.some((u) => u.node.slice(0, 3) === s.siteId)),
    (g) => g.name,
  )
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: heading, path },
  ])
  const body = `${crumbs.html}
<h1>${esc(heading)}</h1>
<p>${esc(intro)}</p>
<dl class="prerender__facts"><dt>Site code</dt><dd>${esc(s.siteId)}</dd><dt>Island</dt><dd>${island(s.island)}</dd><dt>Type</dt><dd>${s.type === 'TEE' ? 'Tee point' : 'Substation'}</dd></dl>
${substationStats(s, ctx)}
${generators.length ? `<h2>Generation connected here</h2>${linkList(generators.map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}` : ''}
<p>See also: ${link(islandPath(s.island === 'north' ? 'NI' : 'SI'), `Electricity in the ${island(s.island)}`)}</p>`
  const place = {
    '@type': 'Place',
    '@id': `${ORIGIN}${path}#substation`,
    name: heading,
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.long },
    address: { '@type': 'PostalAddress', addressCountry: 'NZ' },
  }
  return {
    path,
    title: substationTitle(s),
    description,
    body,
    jsonLd: graph(
      webPage(path, heading, description, { about: { '@id': place['@id'] }, breadcrumb: crumbs.jsonLd }),
      place,
    ),
  }
}

function hvdcStats(ctx: Context): string {
  const { stats, full } = ctx
  const hvdc = stats?.hvdc
  if (!stats || !hvdc || full < 0) return ''
  return `<h2>Flows by year</h2>
<p>In ${stats.years[full]}, the link sent ${esc(gwh(hvdc.north[full]))} north and ${esc(gwh(hvdc.south[full]))} south.</p>
${yearlyTable(stats, [
  { head: 'Sent north', values: hvdc.north },
  { head: 'Sent south', values: hvdc.south },
])}`
}

function hvdcPage(ctx: Context): Page {
  const heading = 'HVDC Inter-Island Link'
  const description = `Live power flows north and south across New Zealand's HVDC Inter-Island link between Benmore and Haywards, with its transfer limits and history.`
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: heading, path: HVDC_PATH },
  ])
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)}</p>
<p>The high-voltage direct current (HVDC) link joins the South Island's grid at Benmore to the North Island's at Haywards, crossing Cook Strait by submarine cable.</p>
${hvdcStats(ctx)}
<p>Flows from EMI's metered HVDC data, and from <a href="https://www.em6.co.nz">em6</a> for the days since EMI's latest month. Transfer limits from em6.</p>
<p>See also: ${link(islandPath('NI'), 'Electricity in the North Island')} · ${link(islandPath('SI'), 'Electricity in the South Island')}</p>`
  return {
    path: HVDC_PATH,
    title: HVDC_TITLE,
    description,
    body,
    jsonLd: graph(webPage(HVDC_PATH, heading, description, { breadcrumb: crumbs.jsonLd })),
  }
}

function projectCapacity(n: UnderConstructionNode): number {
  return n.capacityMW ?? n.capacityMWp ?? 0
}

function pipelinePage(projects: UnderConstructionNode[]): Page {
  const path = '/pipeline'
  const heading = 'New Zealand Generation Pipeline'
  const total = projects.reduce((sum, n) => sum + projectCapacity(n), 0)
  const description = `${projects.length} new generation projects being built or committed in New Zealand, ${mw(Math.round(total))} in all: their fuel, capacity, operator, status and when they're due to open.`
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: heading, path },
  ])
  const rows = sortByName(projects, (n) => n.name)
    .map(
      (n) =>
        `<tr><td>${esc(n.name)}${n.locationDescription ? ` (${esc(n.locationDescription)})` : ''}</td><td>${esc(n.fuel)}</td><td>${projectCapacity(n) ? esc(n.capacityMW ? mw(n.capacityMW) : `${mw(projectCapacity(n))}p`) : '–'}</td><td>${esc(n.operator)}</td><td>${esc(n.status)}</td><td>${n.openBy ? esc(n.openBy.slice(0, 7)) : '–'}</td></tr>`,
    )
    .join('')
  const body = `${crumbs.html}
<h1>${heading}</h1>
<p>${esc(description)} Compiled for this site from public sources, such as the developers' announcements.</p>
<table><thead><tr><th>Project</th><th>Fuel</th><th>Capacity</th><th>Operator</th><th>Status</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>`
  return {
    path,
    title: PIPELINE_TITLE,
    description,
    body,
    jsonLd: graph(webPage(path, heading, description, { breadcrumb: crumbs.jsonLd })),
  }
}

// The renewable share in the latest full year, for the home page to lead with
function renewableLead(ctx: Context): string {
  const { stats, total, full } = ctx
  if (!stats || full < 0 || !(total[full] > 0)) return ''
  const nodes = ctx.defs.generators.flatMap((g) =>
    generationNodes(g.units.filter((u) => RENEWABLE_FUELS.includes(u.fuel))),
  )
  const share = sumNodes(stats, nodes)[full] / total[full]
  return `<p>In ${stats.years[full]}, ${pct(share)} of the electricity generated on New Zealand's national grid was renewable. ${link(RENEWABLE_PATH, "How renewable is New Zealand's electricity?")}</p>`
}

function homePage(ctx: Context): Page {
  const { defs } = ctx
  const description =
    "Live map of New Zealand's electricity grid: every power station's output, the generation mix, nodal prices, offers, HVDC flows and outages, every five minutes."
  const byFuel = new Map<string, Generator[]>()
  for (const g of defs.generators) byFuel.set(primaryFuel(g), [...(byFuel.get(primaryFuel(g)) ?? []), g])
  const order = FUEL_TOPICS.map((t) => t.fuel)
  const fuels = [...byFuel.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  const substationLinks = (code: string) =>
    linkList(
      sortByName(
        defs.substations.filter((s) => s.island === code),
        (s) => s.description,
      ).map((s) => ({ href: substationPath(s, defs.substations), text: s.description })),
    )
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
${AGENT_DATA}
<h2>Power stations</h2>
${fuels.map((f) => `<h3>${fuelHeading(f)}</h3>${linkList(sortByName(byFuel.get(f) ?? [], (g) => g.name).map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}`).join('\n')}
<h2>Substations</h2>
<h3>North Island</h3>${substationLinks('north')}
<h3>South Island</h3>${substationLinks('south')}`
  return {
    path: '/',
    title: HOME_TITLE,
    description,
    body,
    today: todayPlaceholder("New Zealand's generation by fuel", { group_by: 'fuel' }),
    jsonLd: graph(
      {
        '@type': 'WebSite',
        '@id': `${ORIGIN}/#website`,
        url: `${ORIGIN}/`,
        name: SITE_NAME,
        description,
        inLanguage: 'en-NZ',
        creator: { '@id': CREATOR['@id'] },
      },
      {
        '@type': 'WebApplication',
        '@id': `${ORIGIN}/#app`,
        url: `${ORIGIN}/`,
        name: SITE_NAME,
        description,
        applicationCategory: 'ReferenceApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'NZD' },
        creator: { '@id': CREATOR['@id'] },
      },
      {
        '@type': 'Dataset',
        '@id': `${ORIGIN}/#dataset`,
        url: `${ORIGIN}/`,
        name: 'New Zealand electricity generation, prices and offers',
        description:
          "Five-minute generation by power station and fuel, nodal prices, offers, substation demand, HVDC flows and planned outages for New Zealand's national grid, reshaped from the Electricity Authority's EMI data and Transpower's.",
        keywords: ['New Zealand', 'electricity', 'generation', 'renewable energy', 'wholesale prices', 'national grid'],
        creator: { '@id': CREATOR['@id'] },
        license: CC_BY,
        isAccessibleForFree: true,
        isBasedOn: ['https://www.emi.ea.govt.nz', 'https://www.transpower.co.nz'],
        spatialCoverage: { '@type': 'Place', name: 'New Zealand' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${API_URL}/definitions` },
          {
            '@type': 'DataDownload',
            encodingFormat: 'application/json',
            contentUrl: `${API_URL}/dispatch/aggregates/annual`,
          },
        ],
      },
    ),
  }
}

export function buildPages(
  defs: Definitions,
  projects: UnderConstructionNode[] = underConstruction,
  stats: Stats | null = null,
  monthly: MonthlyStats | null = null,
  lastGenerated: ReadonlyMap<string, string> = new Map(),
): Page[] {
  const ctx = buildContext(defs, stats, monthly, lastGenerated)
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

// The file its Markdown is written to, which edge/markdown.ts serves at its
// path to agents that ask for Markdown
export function markdownFile(path: string): string {
  const file = markdownPath(path)
  if (!file) throw new Error(`station-pages: no Markdown file for ${path}`)
  return file.slice(1)
}

function fillBlock(html: string, marker: string, content: string): string {
  const block = new RegExp(`<!--${marker}-->[\\s\\S]*?<!--/${marker}-->`)
  if (!block.test(html)) throw new Error(`index.html has no <!--${marker}--> block`)
  return html.replace(block, () => content)
}

// What the app fetches first, asked for while its JS loads rather than once it
// runs (see api.ts): the definitions, and the last 3 days' dispatch, which
// every view fetches but a past day or range (see useDispatchData). A link to
// one of those (?date=, or ?from= and ?to=, see useUrlState) doesn't need it, so
// a script asks for it only without one. Each must be the request the app
// makes, with its URL and CORS mode (crossorigin's anonymous is fetch()'s
// default), or the browser downloads it twice.
function appPreloads(api: string): string {
  const base = api.replace(/\/$/, '')
  const recent = JSON.stringify(`${base}/dispatch/recent`).replace(/</g, '\\u003c')
  return `<link rel="preload" href="${esc(base)}/definitions" as="fetch" crossorigin />
    <script>
      ;(function () {
        var p = new URLSearchParams(location.search)
        if (p.has('date') || (p.has('from') && p.has('to'))) return
        var link = document.createElement('link')
        link.rel = 'preload'
        link.as = 'fetch'
        link.crossOrigin = 'anonymous'
        link.href = ${recent}
        document.head.appendChild(link)
      })()
    </script>`
}

// A page from the built index.html. A page of its own with a chart loads
// `chartScript`, the charts' tooltips (see src/chartTooltip.ts), in place of the
// app. A page with the app preloads its first data from `api`, the API it
// fetches from (VITE_API_BASE, or the production API).
export function renderPage(template: string, page: Page, chartScript?: string, api?: string): string {
  const url = ORIGIN + page.path
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="alternate" type="text/markdown" href="/${esc(markdownFile(page.path))}" />`,
    LLMS_TXT_LINK,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>`,
    ...(page.standalone ? [] : [appPreloads(api || API_URL)]),
  ].join('\n    ')
  const body = `<div class="prerender">\n${header(page.live ?? '/', page.path)}\n<main class="prerender__main">\n${page.body}\n</main>\n${FOOTER}\n</div>`
  const html = fillBlock(fillBlock(template, 'page-head', head), 'page-body', body)
  if (!page.standalone) return html
  // A page of its own keeps the stylesheet but not the app, which would replace its content
  const own = html
    .replace(/\s*<script type="module"[^>]*><\/script>/g, '')
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
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
  return (await response.json()) as T
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

// The monthly totals, a year at a time, from 1997, when the records begin
async function loadMonthly(apiBase?: string): Promise<MonthlyStats> {
  const base = (apiBase ?? BUILD_API_URL).replace(/\/$/, '')
  const years = Array.from({ length: nzYear(new Date()) - 1996 }, (_, i) => 1997 + i)
  const monthly = parseMonthly(
    await Promise.all(years.map((y) => getJson<AnnualAggregates>(`${base}/dispatch/aggregates/${y}/monthly`))),
  )
  console.log(`station-pages: monthly figures for ${monthly.months[0]} to ${monthly.months[monthly.months.length - 1]}`)
  return monthly
}

// The last day a station generated at least a MWh on, as YYYY-MM-DD: the last
// such day of the last month with that much, from `days`, which gives a month's
// days' MWh at these nodes. A meter records a little now and then for years
// after a station shuts, which doesn't count.
export async function lastGeneratedDay(
  nodes: string[],
  monthly: MonthlyStats,
  days: (month: string) => Promise<AnnualAggregates>,
): Promise<string | null> {
  const months = sumMonthly(monthly, nodes)
  for (let i = months.length - 1; i >= 0; i--) {
    if (months[i] < 0.001) continue
    const { series, data } = await days(monthly.months[i])
    const columns = series.flatMap((node, j) => (nodes.includes(node) ? [j + 1] : []))
    const day = data.findLast((row) => columns.reduce((sum, j) => sum + (Number(row[j]) || 0), 0) >= 1)
    if (day) return String(day[0]).slice(0, 10)
  }
  return null
}

// When each retired station last generated, by its site code, from the API's
// daily totals for its last month (/v1/dispatch/aggregates/{year}/{month})
async function loadLastGenerated(
  defs: Definitions,
  monthly: MonthlyStats,
  apiBase?: string,
): Promise<Map<string, string>> {
  const base = (apiBase ?? BUILD_API_URL).replace(/\/$/, '')
  const retired = await Promise.all(
    defs.generators
      .filter((g) => isRetired(g))
      .map(async (g) => {
        const nodes = generationNodes(g.units)
        const query = nodes.map(encodeURIComponent).join(',')
        const day = await lastGeneratedDay(nodes, monthly, (month) =>
          getJson<AnnualAggregates>(
            `${base}/dispatch/aggregates/${month.slice(0, 4)}/${Number(month.slice(5, 7))}?nodes=${query}`,
          ),
        )
        return day ? [[g.site, day] as [string, string]] : []
      }),
  )
  return new Map(retired.flat())
}

// Writes every page and its Markdown, and the sitemap, from the built
// index.html, the definitions, the yearly and monthly totals and when retired
// stations last generated. The build
// fails if any can't be fetched, so a deploy never replaces the pages with ones
// that lack their figures, or drops the pages that are nothing but figures.
export function stationPages(apiBase?: string): Plugin {
  return {
    name: 'station-pages',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('station-pages: no index.html in the bundle')
      const [defs, stats, monthly] = await Promise.all([
        loadDefinitions(apiBase),
        loadStats(apiBase),
        loadMonthly(apiBase),
      ]).catch((error: Error) => {
        throw new Error(`station-pages: ${error.message}`)
      })
      const lastGenerated = await loadLastGenerated(defs, monthly, apiBase).catch((error: Error) => {
        throw new Error(`station-pages: ${error.message}`)
      })
      if (!defs.generators?.length || !defs.substations?.length)
        throw new Error('station-pages: the definitions have no generators or substations')

      const tooltips = Object.values(bundle).find(
        (file) => file.type === 'chunk' && file.isEntry && file.name === 'chartTooltip',
      )
      if (!tooltips) throw new Error('station-pages: no chartTooltip entry in the bundle (see vite.config.ts)')

      const template = String(index.source)
      const pages = buildPages(defs, underConstruction, stats, monthly, lastGenerated)
      for (const page of pages) {
        const html = renderPage(template, page, `/${tooltips.fileName}`, apiBase)
        if (page.path === '/') index.source = html
        else this.emitFile({ type: 'asset', fileName: pageFile(page.path), source: html })
        this.emitFile({ type: 'asset', fileName: markdownFile(page.path), source: pageMarkdown(page) })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(pages) })
    },
  }
}
