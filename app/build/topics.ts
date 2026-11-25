import type { Generator, Unit } from '../src/types'
import { fuelColour } from '../src/utils/colours'
import { isCharging, isDecommissioned } from '../src/utils/generators'
import { generatorPath, SITE_NAME, slugify } from '../src/utils/stationPaths'
import {
  breadcrumbs, esc, fitDescription, graph, gwh, island, link, linkList, list, mw, ordinal, pct, primaryFuel, sortByName, SOURCES,
  table, unitFuel, webPage,
} from './html'
import type { Page } from './html'
import { generationBy, generationByFuel, generationNodes, RENEWABLE_FUELS, substationDemand, sumNodes } from './stats'
import { firstYear, yearlyChart, yearlyTable, yearLabel } from './yearly'
import type { Context } from './yearly'

// Pages about a fuel, an operator, an island and the grid's renewable share,
// with their yearly generation and stations. Unlike a station's page, each is a
// page of its own, without the app, so search engines that run it still index
// its content.

export const RENEWABLE_PATH = '/renewable-energy'
const ACCENT = 'var(--color-accent)'

export interface FuelTopic {
  // As a unit names it
  fuel: string
  slug: string
  name: string
  heading: string
  // What generated it, and what its stations are called, one and several
  subject: string
  one: string
  several: string
  // Its code in the live map's ?fuels=
  code: string
  note?: string
}

export const FUEL_TOPICS: FuelTopic[] = [
  { fuel: 'Hydro', slug: 'hydro', name: 'Hydro', heading: 'Hydro power in New Zealand', subject: 'hydro stations', one: 'hydro station', several: 'hydro stations', code: 'HYD' },
  { fuel: 'Geothermal', slug: 'geothermal', name: 'Geothermal', heading: 'Geothermal power in New Zealand', subject: 'geothermal stations', one: 'geothermal station', several: 'geothermal stations', code: 'GEO' },
  { fuel: 'Wind', slug: 'wind', name: 'Wind', heading: 'Wind power in New Zealand', subject: 'wind farms', one: 'wind farm', several: 'wind farms', code: 'WIN' },
  {
    fuel: 'Solar', slug: 'solar', name: 'Solar', heading: 'Solar power in New Zealand', subject: 'grid-connected solar farms', one: 'solar farm', several: 'solar farms', code: 'SOL',
    note: 'Rooftop solar, and other solar embedded in local networks, isn\'t dispatched on the national grid, so isn\'t counted here. The live map estimates it separately.',
  },
  { fuel: 'Gas', slug: 'gas', name: 'Gas', heading: 'Gas-fired generation in New Zealand', subject: 'gas-fired units', one: 'station with gas-fired units', several: 'stations with gas-fired units', code: 'GAS' },
  {
    fuel: 'Coal/Gas', slug: 'coal', name: 'Coal', heading: 'Coal power in New Zealand', subject: 'Huntly\'s Rankine units, which burn coal and gas,', one: 'station with coal-fired units', several: 'stations with coal-fired units', code: 'CLG',
    note: 'Huntly\'s Rankine units are the grid\'s coal-fired generation, and can burn gas too. Their generation isn\'t split between the two fuels.',
  },
  { fuel: 'Diesel', slug: 'diesel', name: 'Diesel', heading: 'Diesel generation in New Zealand', subject: 'diesel generators', one: 'diesel station', several: 'diesel stations', code: 'DIE' },
  {
    fuel: 'Battery', slug: 'batteries', name: 'Batteries', heading: 'Grid batteries in New Zealand', subject: 'grid batteries', one: 'grid battery', several: 'grid batteries', code: 'BESS',
    note: 'Batteries store electricity rather than generate it, charging when it\'s plentiful and discharging when it\'s needed. Their generation here is what they discharged.',
  },
]

export function fuelTopic(fuel: string): FuelTopic | undefined {
  return FUEL_TOPICS.find((t) => t.fuel === fuel)
}

export function fuelPath(topic: FuelTopic): string {
  return `/fuel/${topic.slug}`
}

// An operator has a page once it has more than one station; one station's page
// says all there is
export function operatorsWithPages(generators: Generator[]): string[] {
  const counts = new Map<string, number>()
  for (const g of generators) counts.set(g.operator, (counts.get(g.operator) ?? 0) + 1)
  return sortByName([...counts].filter(([, n]) => n > 1).map(([op]) => op), (op) => op)
}

export function operatorPath(operator: string): string {
  return `/operator/${slugify(operator)}`
}

export function islandPath(code: string): string {
  return `/island/${slugify(island(code))}`
}

function plural(n: number, one: string, several: string): string {
  return `${n} ${n === 1 ? one : several}`
}

// A unit generating now: not a battery's charging, nor one combining others' metering, nor retired
function inService(u: Unit): boolean {
  return !isCharging(u) && u.capacity > 0 && !isDecommissioned(u)
}

function capacityOf(units: Unit[]): number {
  return units.filter(inService).reduce((sum, u) => sum + u.capacity, 0)
}

// Columns of GWh, and their share of the grid's, a value each year
function generationColumns(ctx: Context, values: number[]) {
  return [
    { head: 'Generation', values, format: gwh },
    {
      head: 'Share of grid',
      values: values.map((v, i) => ctx.total[i] > 0 ? v / ctx.total[i] : NaN),
      format: (v: number) => Number.isNaN(v) ? '–' : pct(v),
    },
  ]
}

// Links to every topic page, at the foot of each
export function topicNav(ctx: Context): string {
  const fuels = FUEL_TOPICS.filter((t) => ctx.defs.generators.some((g) => g.units.some((u) => unitFuel(u) === t.fuel)))
  return `<h2>Explore</h2>
<p>${link(RENEWABLE_PATH, 'How renewable is New Zealand\'s electricity?')}</p>
<p>By fuel: ${fuels.map((t) => link(fuelPath(t), t.name)).join(' · ')}</p>
<p>By island: ${link(islandPath('NI'), 'North Island')} · ${link(islandPath('SI'), 'South Island')}</p>
<p>By operator: ${operatorsWithPages(ctx.defs.generators).map((op) => link(operatorPath(op), op)).join(' · ')}</p>`
}

function topicPage(ctx: Context, path: string, heading: string, title: string, description: string, content: string): Page {
  const crumbs = breadcrumbs([{ name: SITE_NAME, path: '/' }, { name: heading, path }])
  return {
    path, title, description, standalone: true,
    body: `${crumbs.html}
<h1>${esc(heading)}</h1>
${content}
${topicNav(ctx)}
${SOURCES}`,
    jsonLd: graph(webPage(path, heading, description, { breadcrumb: crumbs.jsonLd })),
  }
}

// A station's GWh in the latest full year from these of its units
function latestGwh(ctx: Context, units: Unit[]): number | null {
  return ctx.stats && ctx.full >= 0 ? sumNodes(ctx.stats, generationNodes(units))[ctx.full] : null
}

function latestHead(ctx: Context): string[] {
  return ctx.stats && ctx.full >= 0 ? [`${ctx.stats.years[ctx.full]} generation`] : []
}

function latestCell(value: number | null): string[] {
  return value === null ? [] : [esc(gwh(value))]
}

function fuelPage(topic: FuelTopic, ctx: Context): Page | null {
  const { defs, stats, total, full, current } = ctx
  const stations = defs.generators
    .map((g) => ({ g, units: g.units.filter((u) => !isCharging(u) && unitFuel(u) === topic.fuel) }))
    .filter((s) => s.units.length > 0)
  if (stations.length === 0) return null
  const live = stations.filter((s) => s.units.some(inService)).sort((a, b) => capacityOf(b.units) - capacityOf(a.units))
  const retired = stations.filter((s) => !s.units.some(inService))
  const capacity = live.reduce((sum, s) => sum + capacityOf(s.units), 0)
  const yearly = stats ? generationByFuel(stats, defs).get(topic.fuel) ?? null : null
  const path = fuelPath(topic)
  const name = topic.name.toLowerCase()
  const year = stats && full >= 0 ? stats.years[full] : null

  const lead = [
    yearly && year !== null ? `In ${year}, ${topic.subject} generated ${gwh(yearly[full])}, ${pct(yearly[full] / total[full])} of the electricity generated on New Zealand's national grid.` : '',
    `${live.length === 1 ? 'There is' : 'There are'} ${plural(live.length, topic.one, topic.several)} in service, with ${mw(capacity)} of capacity`
      + (live.length > 1 ? `. The largest are ${list(live.slice(0, 3).map((s) => s.g.name))}.` : live.length ? `: ${live[0].g.name}.` : '.'),
    yearly && stats && current >= 0 ? `So far in ${stats.years[current]}, they've generated ${gwh(yearly[current])}, ${pct(yearly[current] / total[current])} of the grid's generation.` : '',
  ].filter(Boolean).join(' ')
  const description = fitDescription(`${topic.heading}: ${mw(capacity)} across ${plural(live.length, topic.one, topic.several)}`
    + (yearly && year !== null ? `, ${pct(yearly[full] / total[full])} of the grid's generation in ${year}` : '') + '.',
  'Every station, and yearly generation since 1997.')
  const from = yearly ? firstYear(yearly) : 0

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${topic.note ? `<p>${esc(topic.note)}</p>` : ''}
<p>${link(`/?fuels=${topic.code}`, `See ${name} generation live on the map`)}</p>
${yearly && stats ? `<h2>${esc(topic.name)} generation by year</h2>
${yearlyChart(stats, yearly, from, { colour: fuelColour(topic.fuel), unit: 'GWh', label: `${topic.name} generation each year, in GWh`, format: gwh })}
${yearlyTable(stats, generationColumns(ctx, yearly), from)}` : ''}
<h2>${esc(topic.name)} stations in service</h2>
${table(['Station', 'Operator', 'Island', 'Capacity', ...latestHead(ctx)], live.map((s) => [
    link(generatorPath(s.g, defs.generators), s.g.name), esc(s.g.operator), esc(island(s.g.island)), esc(mw(capacityOf(s.units))), ...latestCell(latestGwh(ctx, s.units)),
  ]))}
${retired.length ? `<h3>Retired</h3>${linkList(sortByName(retired, (s) => s.g.name).map((s) => ({ href: generatorPath(s.g, defs.generators), text: s.g.name })))}` : ''}`
  return topicPage(ctx, path, topic.heading, `${topic.heading}: Stations & Generation | ${SITE_NAME}`, description, content)
}

function operatorPage(operator: string, ctx: Context, rank: Map<string, number>): Page {
  const { defs, stats, full } = ctx
  const stations = defs.generators.filter((g) => g.operator === operator)
  const live = stations.filter((g) => g.units.some(inService)).sort((a, b) => capacityOf(b.units) - capacityOf(a.units))
  const retired = stations.filter((g) => !g.units.some(inService))
  const capacity = live.reduce((sum, g) => sum + capacityOf(g.units), 0)
  const byFuel = new Map<string, number>()
  for (const g of live) for (const u of g.units.filter(inService)) byFuel.set(unitFuel(u), (byFuel.get(unitFuel(u)) ?? 0) + u.capacity)
  const mix = [...byFuel].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${mw(c)} of ${f === 'Coal/Gas' ? 'coal and gas' : f === 'Battery' ? 'batteries' : f.toLowerCase()}`)
  const yearly = stats ? generationBy(stats, defs, (g) => g.operator === operator ? 'all' : null).get('all') ?? null : null
  const year = stats && full >= 0 ? stats.years[full] : null
  const path = operatorPath(operator)
  const place = rank.get(operator)

  const lead = [
    `${operator} operates ${plural(live.length, 'power station', 'power stations')} on New Zealand's national grid, with ${mw(capacity)} of capacity in service${mix.length > 1 ? `: ${list(mix)}` : mix.length ? ` (${mix[0].replace(/^.* of /, '')})` : ''}.`,
    yearly && year !== null ? `In ${year}, its stations generated ${gwh(yearly[full])}, ${pct(yearly[full] / ctx.total[full])} of the grid's generation${place ? `, the ${place === 1 ? '' : `${ordinal(place)} `}most of any operator` : ''}.` : '',
  ].filter(Boolean).join(' ')
  const description = fitDescription(`${operator} operates ${plural(live.length, 'power station', 'power stations')} in New Zealand with ${mw(capacity)} of capacity`
    + (yearly && year !== null ? `, generating ${gwh(yearly[full])} in ${year}` : '') + '.',
  'Every station, and yearly generation since 1997.')
  const from = yearly ? firstYear(yearly) : 0

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${yearly && stats ? `<h2>${esc(operator)}'s generation by year</h2>
<p>Each year is credited to the stations' current operator, including years before ${esc(operator)} owned them.</p>
${yearlyChart(stats, yearly, from, { colour: ACCENT, unit: 'GWh', label: `${operator}'s generation each year, in GWh`, format: gwh })}
${yearlyTable(stats, generationColumns(ctx, yearly), from)}` : ''}
<h2>${esc(operator)}'s stations</h2>
${table(['Station', 'Fuel', 'Island', 'Capacity', ...latestHead(ctx)], live.map((g) => [
    link(generatorPath(g, defs.generators), g.name), esc(primaryFuel(g)), esc(island(g.island)), esc(mw(capacityOf(g.units))), ...latestCell(latestGwh(ctx, g.units)),
  ]))}
${retired.length ? `<h3>Retired</h3>${linkList(sortByName(retired, (g) => g.name).map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}` : ''}`
  return topicPage(ctx, path, `${operator}'s power stations`, `${operator} Power Stations & Generation | ${SITE_NAME}`, description, content)
}

// Operators by their generation in the latest full year, the most first
function operatorRanks(ctx: Context): Map<string, number> {
  if (!ctx.stats || ctx.full < 0) return new Map()
  const byOperator = generationBy(ctx.stats, ctx.defs, (g) => g.operator)
  const ranked = [...byOperator].filter(([, v]) => v[ctx.full] > 0).sort((a, b) => b[1][ctx.full] - a[1][ctx.full])
  return new Map(ranked.map(([op], i) => [op, i + 1]))
}

function islandPage(code: 'NI' | 'SI', ctx: Context): Page {
  const { defs, stats, total, full } = ctx
  const name = island(code)
  const path = islandPath(code)
  const stations = defs.generators.filter((g) => g.island === code)
  const live = stations.filter((g) => g.units.some(inService))
  const capacity = live.reduce((sum, g) => sum + capacityOf(g.units), 0)
  const generation = stats ? generationBy(stats, defs, (g) => g.island === code ? 'all' : null).get('all') ?? null : null
  const substations = defs.substations.filter((s) => (s.island === 'north') === (code === 'NI'))
  const demand = stats ? substations.map((s) => substationDemand(stats, s.siteId)).reduce((sum, d) => sum.map((v, i) => v + d[i]), stats.years.map(() => 0)) : null
  const byFuel = stats ? generationBy(stats, defs, (g, u) => g.island === code ? unitFuel(u) : null) : null
  const year = stats && full >= 0 ? stats.years[full] : null
  const hvdc = stats?.hvdc

  const lead = [
    `The ${name} has ${plural(live.length, 'grid-connected power station', 'grid-connected power stations')} in service, with ${mw(capacity)} of capacity.`,
    generation && demand && year !== null ? `In ${year}, they generated ${gwh(generation[full])}, ${pct(generation[full] / total[full])} of New Zealand's grid generation, and ${gwh(demand[full])} was taken from the grid in the ${name}.` : '',
    hvdc && year !== null ? `The HVDC link between the islands sent ${gwh(hvdc.north[full])} north and ${gwh(hvdc.south[full])} south.` : '',
  ].filter(Boolean).join(' ')
  const description = `Electricity in the ${name}: ${plural(live.length, 'power station', 'power stations')} with ${mw(capacity)} of capacity`
    + (generation && year !== null ? `, generating ${gwh(generation[full])} in ${year}` : '') + '. Generation by fuel, demand and every station.'
  const from = generation ? firstYear(generation) : 0
  const fuelRows = byFuel && year !== null && generation
    ? [...byFuel].filter(([, v]) => v[full] > 0.05).sort((a, b) => b[1][full] - a[1][full]).map(([fuel, v]) => {
      const topic = fuelTopic(fuel)
      return [topic ? link(fuelPath(topic), topic.name) : esc(fuel), esc(gwh(v[full])), esc(pct(v[full] / generation[full]))]
    })
    : []

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${fuelRows.length ? `<h2>Generation by fuel in ${year}</h2>${table(['Fuel', 'Generation', `Share of the ${name}'s`], fuelRows)}` : ''}
${generation && demand && stats ? `<h2>Generation and demand by year</h2>
${yearlyChart(stats, generation, from, { colour: ACCENT, unit: 'GWh', label: `${name} generation each year, in GWh`, format: gwh })}
${yearlyTable(stats, [{ head: 'Generation', values: generation, format: gwh }, { head: 'Taken from the grid', values: demand, format: gwh }], from)}` : ''}
<h2>Power stations in the ${name}</h2>
${linkList(sortByName(stations, (g) => g.name).map((g) => ({ href: generatorPath(g, defs.generators), text: g.name })))}`
  return topicPage(ctx, path, `Electricity in the ${name}`, `${name} Electricity: Generation, Demand & Stations | ${SITE_NAME}`, description, content)
}

function renewablePage(ctx: Context): Page | null {
  const { defs, stats, total, full, current } = ctx
  if (!stats || full < 0) return null
  const byFuel = generationByFuel(stats, defs)
  const zero = stats.years.map(() => 0)
  const fuels = RENEWABLE_FUELS.map((f) => ({ fuel: f, values: byFuel.get(f) ?? zero }))
  const renewable = stats.years.map((_, i) => fuels.reduce((sum, f) => sum + f.values[i], 0))
  const share = renewable.map((v, i) => total[i] > 0 ? v / total[i] : 0)
  const year = stats.years[full]
  const parts = fuels.filter((f) => f.values[full] > 0).map((f) => `${f.fuel.toLowerCase()} ${pct(f.values[full] / total[full])}`)
  const first = share.findIndex((v, i) => !stats.partial.has(stats.years[i]) && v > 0)
  const best = share.reduce((b, v, i) => !stats.partial.has(stats.years[i]) && v > share[b] ? i : b, Math.max(first, 0))
  const heading = 'How renewable is New Zealand\'s electricity?'

  const lead = [
    `In ${year}, ${pct(share[full])} of the electricity generated on New Zealand's national grid came from renewable sources: ${list(parts)}.`,
    current >= 0 ? `So far in ${stats.years[current]}, it's ${pct(share[current])}.` : '',
    first >= 0 ? `It was ${pct(share[first])} in ${stats.years[first]}, and highest in ${stats.years[best]}, at ${pct(share[best])}.` : '',
  ].filter(Boolean).join(' ')
  const description = `${pct(share[full])} of New Zealand's grid electricity was renewable in ${year}: hydro, geothermal, wind and solar. The renewable share every year since 1997.`
  const content = `<p class="prerender__lead">${esc(lead)}</p>
<p>${link('/', 'See the renewable share right now on the live map')}, updated every five minutes.</p>
<h2>Renewable share by year</h2>
${yearlyChart(stats, share.map((v) => v * 100), 0, { colour: fuelColour('Wind'), unit: '%', label: 'Share of grid generation from renewable sources each year, in percent', format: (v) => `${v.toLocaleString('en-NZ', { maximumFractionDigits: 1 })}%` })}
${yearlyTable(stats, [
    { head: 'Renewable share', values: share, format: pct },
    ...fuels.map((f) => ({ head: f.fuel, values: f.values, format: gwh })),
    { head: 'All generation', values: total, format: gwh },
  ])}
<h2>What's counted</h2>
<p>Hydro, geothermal, wind and solar count as renewable. The figures are the generation of the units dispatched on the national grid, from the Electricity Authority's metered data until 10 September 2020 and its five-minute dispatch since. Rooftop solar and other generation embedded in local networks isn't included, and batteries, which store electricity rather than generate it, count towards all generation but not the renewable share.</p>
<p>${yearLabel(stats, 0)} starts in August, when the data does.</p>`
  return topicPage(ctx, RENEWABLE_PATH, heading, `How Renewable Is NZ's Electricity? Renewable Share by Year | ${SITE_NAME}`, description, content)
}

export function topicPages(ctx: Context): Page[] {
  const ranks = operatorRanks(ctx)
  return [
    renewablePage(ctx),
    ...FUEL_TOPICS.map((t) => fuelPage(t, ctx)),
    ...operatorsWithPages(ctx.defs.generators).map((op) => operatorPage(op, ctx, ranks)),
    islandPage('NI', ctx),
    islandPage('SI', ctx),
  ].filter((p): p is Page => p !== null)
}
