import type { Generator, Unit } from '../src/types'
import { fuelColour } from '../src/utils/colours'
import { isCharging, isDecommissioned } from '../src/utils/generators'
import { ANALYSIS_PATH, generatorPath, SITE_NAME, slugify } from '../src/utils/stationPaths'
import {
  breadcrumbs,
  esc,
  figures,
  fitDescription,
  graph,
  gwh,
  island,
  link,
  linkList,
  list,
  mw,
  ordinal,
  pct,
  primaryFuel,
  shareCell,
  sortByName,
  table,
  unitFuel,
  webPage,
} from './html'
import type { Page } from './html'
import { generationBy, generationByFuel, generationNodes, RENEWABLE_FUELS, substationDemand, sumNodes } from './stats'
import { firstYear, gridShare, yearlyChart, yearlyTable } from './yearly'
import type { Column, Context } from './yearly'

// The Analysis section: pages about a fuel, an operator, an island and the
// grid's renewable share, with their yearly generation and stations, and one
// that sums them all up, at ANALYSIS_PATH. Unlike a station's page, each is a
// page of its own, without the app, so search engines that run it still index
// its content. They moved under ANALYSIS_PATH in November 2026; frontend/_redirects
// sends their old paths on.

export const RENEWABLE_PATH = `${ANALYSIS_PATH}/renewable-energy`
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
}

export const FUEL_TOPICS: FuelTopic[] = [
  {
    fuel: 'Hydro',
    slug: 'hydro',
    name: 'Hydro',
    heading: 'Hydro power in New Zealand',
    subject: 'hydro stations',
    one: 'hydro station',
    several: 'hydro stations',
    code: 'HYD',
  },
  {
    fuel: 'Geothermal',
    slug: 'geothermal',
    name: 'Geothermal',
    heading: 'Geothermal power in New Zealand',
    subject: 'geothermal stations',
    one: 'geothermal station',
    several: 'geothermal stations',
    code: 'GEO',
  },
  {
    fuel: 'Wind',
    slug: 'wind',
    name: 'Wind',
    heading: 'Wind power in New Zealand',
    subject: 'wind farms',
    one: 'wind farm',
    several: 'wind farms',
    code: 'WIN',
  },
  {
    fuel: 'Solar',
    slug: 'solar',
    name: 'Solar',
    heading: 'Solar power in New Zealand',
    subject: 'grid-connected solar farms',
    one: 'solar farm',
    several: 'solar farms',
    code: 'SOL',
  },
  {
    fuel: 'Gas',
    slug: 'gas',
    name: 'Gas',
    heading: 'Gas-fired generation in New Zealand',
    subject: 'gas-fired units',
    one: 'station with gas-fired units',
    several: 'stations with gas-fired units',
    code: 'GAS',
  },
  {
    fuel: 'Coal/Gas',
    slug: 'coal',
    name: 'Coal',
    heading: 'Coal power in New Zealand',
    subject: "Huntly's Rankine units, which burn coal and gas,",
    one: 'station with coal-fired units',
    several: 'stations with coal-fired units',
    code: 'CLG',
  },
  {
    fuel: 'Diesel',
    slug: 'diesel',
    name: 'Diesel',
    heading: 'Diesel generation in New Zealand',
    subject: 'diesel generators',
    one: 'diesel station',
    several: 'diesel stations',
    code: 'DIE',
  },
  {
    fuel: 'Battery',
    slug: 'batteries',
    name: 'Batteries',
    heading: 'Grid batteries in New Zealand',
    subject: 'grid batteries',
    one: 'grid battery',
    several: 'grid batteries',
    code: 'BESS',
  },
]

export function fuelTopic(fuel: string): FuelTopic | undefined {
  return FUEL_TOPICS.find((t) => t.fuel === fuel)
}

export function fuelPath(topic: FuelTopic): string {
  return `${ANALYSIS_PATH}/fuel/${topic.slug}`
}

// An operator has a page once it has more than one station; one station's page
// says all there is
export function operatorsWithPages(generators: Generator[]): string[] {
  const counts = new Map<string, number>()
  for (const g of generators) counts.set(g.operator, (counts.get(g.operator) ?? 0) + 1)
  return sortByName(
    [...counts].filter(([, n]) => n > 1).map(([op]) => op),
    (op) => op,
  )
}

export function operatorPath(operator: string): string {
  return `${ANALYSIS_PATH}/operator/${slugify(operator)}`
}

export function islandPath(code: string): string {
  return `${ANALYSIS_PATH}/island/${slugify(island(code))}`
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
function generationColumns(ctx: Context, values: number[]): Column[] {
  return [
    { head: 'Generation', values },
    { head: 'Share of grid', values: values.map((v, i) => (ctx.total[i] > 0 ? v / ctx.total[i] : NaN)), share: true },
  ]
}

// The fuels with a page: those some unit burns, or stores
function fuelsWithPages(ctx: Context): FuelTopic[] {
  return FUEL_TOPICS.filter((t) => ctx.defs.generators.some((g) => g.units.some((u) => unitFuel(u) === t.fuel)))
}

// Links to every Analysis page, grouped, at the foot of each and on the home page
export function topicNav(ctx: Context, heading = 'More analysis', current?: string): string {
  const group = (title: string, links: string[]) =>
    `<h3>${title}</h3><ul>${links.map((l) => `<li>${l}</li>`).join('')}</ul>`
  // The page it's on, named but not linked
  const navLink = (href: string, text: string) =>
    href === current ? `<span aria-current="page">${esc(text)}</span>` : link(href, text)
  return `<nav class="prerender__explore" aria-labelledby="explore">
<h2 id="explore">${esc(heading)}</h2>
<div class="prerender__explore-groups">
<div>${group('Overview', [navLink(ANALYSIS_PATH, 'All analysis'), navLink(RENEWABLE_PATH, 'Renewable share')])}${group('By island', [navLink(islandPath('NI'), 'North Island'), navLink(islandPath('SI'), 'South Island')])}</div>
<div>${group(
    'By fuel',
    fuelsWithPages(ctx).map((t) => navLink(fuelPath(t), t.name)),
  )}</div>
<div class="prerender__explore-wide">${group(
    'By operator',
    operatorsWithPages(ctx.defs.generators).map((op) => navLink(operatorPath(op), op)),
  )}</div>
</div>
</nav>`
}

// A page in the Analysis section, under it in the breadcrumbs
function topicPage(
  ctx: Context,
  path: string,
  heading: string,
  title: string,
  description: string,
  content: string,
  live?: string,
): Page {
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: 'Analysis', path: ANALYSIS_PATH },
    { name: heading, path },
  ])
  return {
    path,
    title,
    description,
    standalone: true,
    live,
    body: `${crumbs.html}
<h1>${esc(heading)}</h1>
${content}
${topicNav(ctx, 'More analysis', path)}`,
    jsonLd: graph(webPage(path, heading, description, { breadcrumb: crumbs.jsonLd })),
  }
}

// A station's GWh in the latest full year from these of its units
function latestGwh(ctx: Context, units: Unit[]): number | null {
  return ctx.stats && ctx.full >= 0 ? sumNodes(ctx.stats, generationNodes(units))[ctx.full] : null
}

type StationColumn = 'Fuel' | 'Operator' | 'Island'

// Stations, as listed, with their capacity of `units` and those units'
// generation in the latest full year
function stationTable(ctx: Context, stations: { g: Generator; units: Unit[] }[], columns: StationColumn[]): string {
  const { defs, stats, full } = ctx
  const text = (g: Generator, c: StationColumn) =>
    esc(c === 'Fuel' ? primaryFuel(g) : c === 'Operator' ? g.operator : island(g.island))
  const capacity = figures(stations.map((s) => capacityOf(s.units)))
  const generated = stats && full >= 0 ? figures(stations.map((s) => latestGwh(ctx, s.units) ?? 0)) : null
  const head = [
    'Station',
    ...columns,
    'Capacity (MW)',
    ...(generated && stats ? [`${stats.years[full]} generation (GWh)`] : []),
  ]
  return table(
    head,
    stations.map((s, i) => [
      link(generatorPath(s.g, defs.generators), s.g.name),
      ...columns.map((c) => text(s.g, c)),
      capacity[i],
      ...(generated ? [generated[i]] : []),
    ]),
    1 + columns.length,
  )
}

function retiredList(ctx: Context, stations: Generator[]): string {
  return stations.length
    ? `<h3>Retired</h3>${linkList(sortByName(stations, (g) => g.name).map((g) => ({ href: generatorPath(g, ctx.defs.generators), text: g.name })))}`
    : ''
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
  const yearly = stats ? (generationByFuel(stats, defs).get(topic.fuel) ?? null) : null
  const path = fuelPath(topic)
  const year = stats && full >= 0 ? stats.years[full] : null

  const lead = [
    yearly && year !== null
      ? `In ${year}, ${topic.subject} generated ${gwh(yearly[full])}, ${pct(yearly[full] / total[full])} of the electricity generated on New Zealand's national grid.`
      : '',
    `${live.length === 1 ? 'There is' : 'There are'} ${plural(live.length, topic.one, topic.several)} in service, with ${mw(capacity)} of capacity` +
      (live.length > 1
        ? `. The largest are ${list(live.slice(0, 3).map((s) => s.g.name))}.`
        : live.length
          ? `: ${live[0].g.name}.`
          : '.'),
    yearly && stats && current >= 0
      ? `So far in ${stats.years[current]}, they've generated ${gwh(yearly[current])}, ${pct(yearly[current] / total[current])} of the grid's generation.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const description = fitDescription(
    `${topic.heading}: ${mw(capacity)} across ${plural(live.length, topic.one, topic.several)}` +
      (yearly && year !== null ? `, ${pct(yearly[full] / total[full])} of the grid's generation in ${year}` : '') +
      '.',
    'Every station, and yearly generation since 1997.',
  )
  const from = yearly ? firstYear(yearly) : 0

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${
  yearly && stats
    ? `<h2>${esc(topic.name)} generation by year</h2>
${yearlyChart(stats, yearly, from, {
  colour: fuelColour(topic.fuel),
  unit: 'GWh',
  label: `${topic.name} generation each year, in GWh`,
  format: gwh,
  name: 'Generation',
  more: [gridShare(ctx, yearly)],
})}
${yearlyTable(stats, generationColumns(ctx, yearly), from)}`
    : ''
}
<h2>${esc(topic.name)} stations in service</h2>
${stationTable(ctx, live, ['Operator', 'Island'])}
${retiredList(
  ctx,
  retired.map((s) => s.g),
)}`
  return topicPage(
    ctx,
    path,
    topic.heading,
    `${topic.heading}: Stations & Generation | ${SITE_NAME}`,
    description,
    content,
    `/?fuels=${topic.code}`,
  )
}

function operatorPage(operator: string, ctx: Context, rank: Map<string, number>): Page {
  const { defs, stats, full } = ctx
  const stations = defs.generators.filter((g) => g.operator === operator)
  const live = stations.filter((g) => g.units.some(inService)).sort((a, b) => capacityOf(b.units) - capacityOf(a.units))
  const retired = stations.filter((g) => !g.units.some(inService))
  const capacity = live.reduce((sum, g) => sum + capacityOf(g.units), 0)
  const byFuel = new Map<string, number>()
  for (const g of live)
    for (const u of g.units.filter(inService)) byFuel.set(unitFuel(u), (byFuel.get(unitFuel(u)) ?? 0) + u.capacity)
  const mix = [...byFuel]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([f, c]) => `${mw(c)} of ${f === 'Coal/Gas' ? 'coal and gas' : f === 'Battery' ? 'batteries' : f.toLowerCase()}`,
    )
  const yearly = stats
    ? (generationBy(stats, defs, (g) => (g.operator === operator ? 'all' : null)).get('all') ?? null)
    : null
  const year = stats && full >= 0 ? stats.years[full] : null
  const path = operatorPath(operator)
  const place = rank.get(operator)

  const lead = [
    `${operator} operates ${plural(live.length, 'power station', 'power stations')} on New Zealand's national grid, with ${mw(capacity)} of capacity in service${mix.length > 1 ? `: ${list(mix)}` : mix.length ? ` (${mix[0].replace(/^.* of /, '')})` : ''}.`,
    yearly && year !== null
      ? `In ${year}, its stations generated ${gwh(yearly[full])}, ${pct(yearly[full] / ctx.total[full])} of the grid's generation${place ? `, the ${place === 1 ? '' : `${ordinal(place)} `}most of any operator` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const description = fitDescription(
    `${operator} operates ${plural(live.length, 'power station', 'power stations')} in New Zealand with ${mw(capacity)} of capacity` +
      (yearly && year !== null ? `, generating ${gwh(yearly[full])} in ${year}` : '') +
      '.',
    'Every station, and yearly generation since 1997.',
  )
  const from = yearly ? firstYear(yearly) : 0

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${
  yearly && stats
    ? `<h2>${esc(operator)}'s generation by year</h2>
${yearlyChart(stats, yearly, from, {
  colour: ACCENT,
  unit: 'GWh',
  label: `${operator}'s generation each year, in GWh`,
  format: gwh,
  name: 'Generation',
  more: [gridShare(ctx, yearly)],
})}
${yearlyTable(stats, generationColumns(ctx, yearly), from)}`
    : ''
}
<h2>${esc(operator)}'s stations</h2>
${stationTable(
  ctx,
  live.map((g) => ({ g, units: g.units })),
  ['Fuel', 'Island'],
)}
${retiredList(ctx, retired)}`
  return topicPage(
    ctx,
    path,
    `${operator}'s power stations`,
    `${operator} Power Stations & Generation | ${SITE_NAME}`,
    description,
    content,
  )
}

// Operators by their generation in the latest full year, the most first
function operatorRanks(ctx: Context): Map<string, number> {
  if (!ctx.stats || ctx.full < 0) return new Map()
  const byOperator = generationBy(ctx.stats, ctx.defs, (g) => g.operator)
  const ranked = [...byOperator].filter(([, v]) => v[ctx.full] > 0).sort((a, b) => b[1][ctx.full] - a[1][ctx.full])
  return new Map(ranked.map(([op], i) => [op, i + 1]))
}

// What was taken from the grid in an island each year (GWh), at its substations
function islandDemand(ctx: Context, code: 'NI' | 'SI'): number[] | null {
  const { defs, stats } = ctx
  if (!stats) return null
  return defs.substations
    .filter((s) => (s.island === 'north') === (code === 'NI'))
    .map((s) => substationDemand(stats, s.siteId))
    .reduce(
      (sum, d) => sum.map((v, i) => v + d[i]),
      stats.years.map(() => 0),
    )
}

function islandPage(code: 'NI' | 'SI', ctx: Context): Page {
  const { defs, stats, total, full } = ctx
  const name = island(code)
  const path = islandPath(code)
  const stations = defs.generators.filter((g) => g.island === code)
  const live = stations.filter((g) => g.units.some(inService)).sort((a, b) => capacityOf(b.units) - capacityOf(a.units))
  const retired = stations.filter((g) => !g.units.some(inService))
  const capacity = live.reduce((sum, g) => sum + capacityOf(g.units), 0)
  const generation = stats
    ? (generationBy(stats, defs, (g) => (g.island === code ? 'all' : null)).get('all') ?? null)
    : null
  const demand = islandDemand(ctx, code)
  const byFuel = stats ? generationBy(stats, defs, (g, u) => (g.island === code ? unitFuel(u) : null)) : null
  const year = stats && full >= 0 ? stats.years[full] : null
  // What the HVDC link brought into the island from the other, and took out to it
  const other = island(code === 'NI' ? 'SI' : 'NI')
  const hvdc = stats?.hvdc
  const imported = hvdc ? (code === 'NI' ? hvdc.north : hvdc.south) : null
  const exported = hvdc ? (code === 'NI' ? hvdc.south : hvdc.north) : null

  const lead = [
    `The ${name} has ${plural(live.length, 'grid-connected power station', 'grid-connected power stations')} in service, with ${mw(capacity)} of capacity.`,
    generation && demand && year !== null
      ? `In ${year}, they generated ${gwh(generation[full])}, ${pct(generation[full] / total[full])} of New Zealand's grid generation, and ${gwh(demand[full])} was taken from the grid in the ${name}.`
      : '',
    imported && exported && year !== null
      ? `It imported ${gwh(imported[full])} from the ${other} over the HVDC link, and exported ${gwh(exported[full])} to it.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const description =
    `Electricity in the ${name}: ${plural(live.length, 'power station', 'power stations')} with ${mw(capacity)} of capacity` +
    (generation && year !== null ? `, generating ${gwh(generation[full])} in ${year}` : '') +
    '. Generation by fuel, demand and every station.'
  const from = generation ? firstYear(generation) : 0
  const fuels =
    byFuel && year !== null && generation
      ? [...byFuel].filter(([, v]) => v[full] > 0.05).sort((a, b) => b[1][full] - a[1][full])
      : []
  const fuelGwh = figures(fuels.map(([, v]) => v[full]))
  const fuelRows = fuels.map(([fuel, v], i) => {
    const topic = fuelTopic(fuel)
    return [
      topic ? link(fuelPath(topic), topic.name) : esc(fuel),
      fuelGwh[i],
      shareCell(generation ? v[full] / generation[full] : NaN),
    ]
  })

  const content = `<p class="prerender__lead">${esc(lead)}</p>
${fuelRows.length ? `<h2>Generation by fuel in ${year}</h2>${table(['Fuel', 'Generation (GWh)', `Share of the ${name}'s`], fuelRows, 1)}` : ''}
${
  generation && demand && stats
    ? `<h2>${imported ? 'Generation, demand and HVDC flows' : 'Generation and demand'} by year</h2>
${yearlyChart(stats, generation, from, {
  colour: ACCENT,
  unit: 'GWh',
  format: gwh,
  marks: demand,
  name: 'Generation',
  markName: 'Taken from the grid',
  label: `Electricity generated in the ${name}, and taken from the grid there, each year, in GWh`,
  more:
    imported && exported
      ? [
          { name: 'Imported via HVDC', values: imported, format: gwh },
          { name: 'Exported via HVDC', values: exported, format: gwh },
        ]
      : [],
})}
${yearlyTable(
  stats,
  [
    { head: 'Generation', values: generation },
    { head: 'Taken from the grid', values: demand },
    ...(imported && exported
      ? [
          { head: 'Imported via HVDC', values: imported },
          { head: 'Exported via HVDC', values: exported },
        ]
      : []),
  ],
  from,
)}`
    : ''
}
<h2>Power stations in the ${name}</h2>
${stationTable(
  ctx,
  live.map((g) => ({ g, units: g.units })),
  ['Fuel', 'Operator'],
)}
${retiredList(ctx, retired)}`
  return topicPage(
    ctx,
    path,
    `Electricity in the ${name}`,
    `${name} Electricity: Generation, Demand & Stations | ${SITE_NAME}`,
    description,
    content,
  )
}

// Each renewable fuel's generation every year, their share of the grid's, and
// each one's share in the latest full year: "hydro 56.7%"
function renewableShare(
  ctx: Context,
): { fuels: { fuel: string; values: number[] }[]; share: number[]; parts: string[] } | null {
  const { defs, stats, total, full } = ctx
  if (!stats || full < 0) return null
  const byFuel = generationByFuel(stats, defs)
  const zero = stats.years.map(() => 0)
  const fuels = RENEWABLE_FUELS.map((f) => ({ fuel: f, values: byFuel.get(f) ?? zero }))
  const share = stats.years.map((_, i) =>
    total[i] > 0 ? fuels.reduce((sum, f) => sum + f.values[i], 0) / total[i] : 0,
  )
  const parts = fuels
    .filter((f) => f.values[full] > 0)
    .map((f) => `${f.fuel.toLowerCase()} ${pct(f.values[full] / total[full])}`)
  return { fuels, share, parts }
}

function renewablePage(ctx: Context): Page | null {
  const { stats, total, full, current } = ctx
  const renewable = renewableShare(ctx)
  if (!stats || !renewable) return null
  const { fuels, share, parts } = renewable
  const year = stats.years[full]
  const first = share.findIndex((v, i) => !stats.partial.has(stats.years[i]) && v > 0)
  const best = share.reduce(
    (b, v, i) => (!stats.partial.has(stats.years[i]) && v > share[b] ? i : b),
    Math.max(first, 0),
  )
  const heading = "How renewable is New Zealand's electricity?"

  const lead = [
    `In ${year}, ${pct(share[full])} of the electricity generated on New Zealand's national grid came from renewable sources: ${list(parts)}.`,
    current >= 0 ? `So far in ${stats.years[current]}, it's ${pct(share[current])}.` : '',
    first >= 0
      ? `It was ${pct(share[first])} in ${stats.years[first]}, and highest in ${stats.years[best]}, at ${pct(share[best])}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const description = `${pct(share[full])} of New Zealand's grid electricity was renewable in ${year}: hydro, geothermal, wind and solar. The renewable share every year since 1997.`
  const content = `<p class="prerender__lead">${esc(lead)}</p>
<h2>Renewable share by year</h2>
${yearlyChart(
  stats,
  share.map((v) => v * 100),
  0,
  {
    colour: fuelColour('Wind'),
    unit: '%',
    label: 'Share of grid generation from renewable sources each year, in percent',
    format: (v) => `${v.toLocaleString('en-NZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
    name: 'Renewable share',
    more: fuels.map((f) => ({ ...gridShare(ctx, f.values), name: f.fuel })),
  },
)}
${yearlyTable(stats, [
  { head: 'Renewable share', values: share, share: true },
  ...fuels.map((f) => ({ head: f.fuel, values: f.values })),
  { head: 'All generation', values: total },
])}`
  return topicPage(
    ctx,
    RENEWABLE_PATH,
    heading,
    `How Renewable Is NZ's Electricity? Renewable Share by Year | ${SITE_NAME}`,
    description,
    content,
  )
}

// A row of the Analysis page's tables: a fuel, island or operator, with its
// stations and capacity in service and its yearly generation
interface Summary {
  name: string
  href: string
  stations: number
  capacity: number
  generated: number[] | null
}

// Rows the most generated in the latest full year first
function summaryTable(ctx: Context, first: string, rows: Summary[]): string {
  const { stats, total, full } = ctx
  const year = stats && full >= 0 ? stats.years[full] : null
  const latest = (r: Summary) => r.generated?.[full] ?? 0
  const sorted = year === null ? rows : [...rows].sort((a, b) => latest(b) - latest(a))
  const capacity = figures(sorted.map((r) => r.capacity))
  const generated = figures(sorted.map(latest))
  const head = [
    first,
    'Stations',
    'Capacity (MW)',
    ...(year !== null ? [`${year} generation (GWh)`, 'Share of grid'] : []),
  ]
  return table(
    head,
    sorted.map((r, i) => [
      link(r.href, r.name),
      String(r.stations),
      capacity[i],
      ...(year !== null ? [generated[i], shareCell(latest(r) / total[full])] : []),
    ]),
    1,
  )
}

// The Analysis section's own page: the grid's renewable share, and each fuel's,
// island's and operator's stations, capacity and generation, leading to their pages
function analysisPage(ctx: Context): Page {
  const { defs, stats, total, full } = ctx
  const year = stats && full >= 0 ? stats.years[full] : null
  const renewable = renewableShare(ctx)
  // The stations with a unit in service that `keep` keeps, and those units' capacity
  const inServiceWhere = (keep: (g: Generator, u: Unit) => boolean) => ({
    stations: defs.generators.filter((g) => g.units.some((u) => inService(u) && keep(g, u))).length,
    capacity: capacityOf(defs.generators.flatMap((g) => g.units.filter((u) => keep(g, u)))),
  })
  const all = inServiceWhere(() => true)
  const byFuel = stats ? generationByFuel(stats, defs) : null
  const byIsland = stats ? generationBy(stats, defs, (g) => g.island) : null
  const byOperator = stats ? generationBy(stats, defs, (g) => g.operator) : null
  const fuels = fuelsWithPages(ctx).map((t) => ({
    name: t.name,
    href: fuelPath(t),
    ...inServiceWhere((_, u) => unitFuel(u) === t.fuel),
    generated: byFuel?.get(t.fuel) ?? null,
  }))
  const islands = (['NI', 'SI'] as const).map((code) => ({
    name: island(code),
    href: islandPath(code),
    ...inServiceWhere((g) => g.island === code),
    generated: byIsland?.get(code) ?? null,
  }))
  const operators = operatorsWithPages(defs.generators).map((op) => ({
    name: op,
    href: operatorPath(op),
    ...inServiceWhere((g) => g.operator === op),
    generated: byOperator?.get(op) ?? null,
  }))

  const heading = 'Analysis'
  const description =
    "Analysis of New Zealand's grid electricity each year since 1997: its renewable share, and each fuel's, island's and operator's capacity and generation."
  const lead = [
    "How New Zealand's national grid has generated its electricity each year since 1997: how much of it is renewable, and how much each fuel, island and operator generates.",
    renewable && year !== null
      ? `In ${year}, the grid generated ${gwh(total[full])}, ${pct(renewable.share[full])} of it from renewable sources: ${list(renewable.parts)}.`
      : '',
    `It has ${plural(all.stations, 'power station', 'power stations')} in service, with ${mw(all.capacity)} of capacity.`,
  ]
    .filter(Boolean)
    .join(' ')
  const content = `<p class="prerender__lead">${esc(lead)}${renewable ? ` ${link(RENEWABLE_PATH, "How renewable is New Zealand's electricity?")}` : ''}</p>
<h2>By fuel</h2>
${summaryTable(ctx, 'Fuel', fuels)}
<h2>By island</h2>
${summaryTable(ctx, 'Island', islands)}
<h2>By operator</h2>
${summaryTable(ctx, 'Operator', operators)}`
  const crumbs = breadcrumbs([
    { name: SITE_NAME, path: '/' },
    { name: heading, path: ANALYSIS_PATH },
  ])
  return {
    path: ANALYSIS_PATH,
    title: `Analysis: NZ Electricity by Fuel, Island & Operator | ${SITE_NAME}`,
    description,
    standalone: true,
    body: `${crumbs.html}
<h1>${heading}</h1>
${content}`,
    jsonLd: graph(webPage(ANALYSIS_PATH, heading, description, { breadcrumb: crumbs.jsonLd })),
  }
}

export function topicPages(ctx: Context): Page[] {
  const ranks = operatorRanks(ctx)
  return [
    analysisPage(ctx),
    renewablePage(ctx),
    ...FUEL_TOPICS.map((t) => fuelPage(t, ctx)),
    ...operatorsWithPages(ctx.defs.generators).map((op) => operatorPage(op, ctx, ranks)),
    islandPage('NI', ctx),
    islandPage('SI', ctx),
  ].filter((p): p is Page => p !== null)
}
