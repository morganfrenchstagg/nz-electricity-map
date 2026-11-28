import { describe, expect, it } from 'vitest'
import type { Generator, Substation, Unit } from '../src/types'
import { buildPages, esc, lastGeneratedDay, markdownFile, pageFile, renderPage, sitemap } from './pages'
import type { Definitions } from './pages'
import { barChart } from './charts'
import { figures, fitDescription, shareCell } from './html'
import { parseMonthly, parseStats, sumNodes, totalGeneration, substationDemand } from './stats'
import type { AnnualAggregates } from './stats'
import type { ChartTip } from '../src/utils/chartTip'
import { yearlyTable } from './yearly'
import { pageMarkdown } from './markdown'

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    name: 'Huntly 5',
    unitCode: 'HLY5',
    node: 'HLY2201 HLY5',
    capacity: 400,
    fuel: 'Gas',
    fuelCode: 'GAS',
    commissioned: '2007-06-01T12:00:00.000Z',
    ...overrides,
  }
}

// Huntly's units, as the API defines them: a battery with its charging unit, a
// retired unit, and one standing in for units once only metered together
const huntly: Generator = {
  site: 'HLY',
  name: 'Huntly',
  operator: 'Genesis Energy',
  gridZone: 'CNI',
  island: 'NI',
  location: { lat: -37.5, long: 175.1 },
  units: [
    unit({ name: 'Huntly Unit 5', unitCode: 'HLY5', capacity: 403 }),
    unit({
      name: 'Huntly Unit 6',
      unitCode: 'HLY6',
      node: 'HLY2201 HLY6',
      capacity: 46,
      commissioned: '2004-06-01T12:00:00.000Z',
    }),
    ...[1, 2, 4].map((n) =>
      unit({
        name: `Huntly Rankine ${n}`,
        unitCode: `HLY${n}`,
        node: `HLY2201 HLY${n}`,
        fuel: 'Coal/Gas',
        fuelCode: 'CLG',
        capacity: 240,
        commissioned: '1983-01-01T12:00:00.000Z',
      }),
    ),
    unit({
      name: 'Huntly Battery',
      unitCode: 'HLY11',
      node: 'HLY2201 HLY11',
      fuel: 'Battery (Discharging)',
      fuelCode: 'BESS',
      capacity: 100,
      commissioned: '2026-07-02T12:00:00.000Z',
    }),
    unit({
      name: 'Huntly Battery',
      unitCode: 'HLY91',
      node: 'HLY2201 HLY91',
      fuel: 'Battery (Charging)',
      fuelCode: 'BESS-C',
      capacity: -100,
      commissioned: '2026-07-02T12:00:00.000Z',
    }),
    unit({
      name: 'Huntly Rankine 3',
      unitCode: 'HLY3',
      node: 'HLY2201 HLY3',
      fuel: 'Coal/Gas',
      fuelCode: 'CLG',
      capacity: 240,
      commissioned: '1983-01-01T12:00:00.000Z',
      decomissioned: '2014-01-23T10:59:59.000Z',
    }),
    unit({
      name: 'Huntly Rankine 1–4',
      unitCode: 'HLY1-4',
      node: 'HLY2201 HLY1-4',
      fuel: 'Coal/Gas',
      fuelCode: 'CLG',
      capacity: 0,
      decomissioned: '1999-12-31T10:59:59.999Z',
      combines: ['HLY2201 HLY1', 'HLY2201 HLY2', 'HLY2201 HLY3', 'HLY2201 HLY4'],
    }),
  ],
}
const otahuhu: Generator = {
  site: 'OTA',
  name: 'Ōtāhuhu',
  operator: 'Contact',
  gridZone: 'UNI',
  island: 'NI',
  location: { lat: -36.9, long: 174.8 },
  units: [
    unit({
      name: 'Ōtāhuhu B',
      unitCode: 'OTB',
      node: 'OTA2201 OTB',
      capacity: 380,
      decomissioned: '2015-09-30T12:00:00.000Z',
    }),
  ],
}
const hly: Substation = {
  siteId: 'HLY',
  description: 'Huntly',
  lat: -37.5,
  long: 175.1,
  type: 'ACSTN',
  gridZone: 1,
  island: 'north',
}
const defs: Definitions = { generators: [huntly, otahuhu], substations: [hly] }
// The tooltip of each bar of the charts in some HTML, as its data-tip holds it
function tips(html: string): ChartTip[] {
  return [...html.matchAll(/data-tip="([^"]*)"/g)].map(
    (m) =>
      JSON.parse(
        m[1]
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&'),
      ) as ChartTip,
  )
}

const TEMPLATE =
  '<head><!--page-head--><title>x</title><!--/page-head--></head><body><div id="root"><!--page-body--><!--/page-body--></div></body>'

describe('buildPages', () => {
  const pages = buildPages(defs, [])
  const page = (path: string) => pages.find((p) => p.path === path)!

  it("writes the home, HVDC, pipeline, topic and every station page, and each generator's history", () => {
    expect(pages.map((p) => p.path)).toEqual([
      '/',
      '/hvdc',
      '/pipeline',
      '/analysis',
      '/analysis/fuel/gas',
      '/analysis/fuel/coal',
      '/analysis/fuel/batteries',
      '/analysis/island/north-island',
      '/analysis/island/south-island',
      '/generator/huntly',
      '/generator/huntly/historic',
      '/generator/otahuhu',
      '/generator/otahuhu/historic',
      '/substation/huntly',
    ])
  })

  it("gives a generator's history its own title, and links it from the station's page", () => {
    const p = page('/generator/huntly/historic')
    expect(p.title).toBe('Huntly Power Station – Historical Generation & Records | NZ Electricity Map')
    expect(p.body).toContain('<h1>Huntly Power Station: Historical Generation</h1>')
    expect(p.body).toContain('<a href="/generator/huntly">Huntly Power Station</a> › Historical generation')
    expect(page('/generator/huntly').body).toContain(
      '<a href="/generator/huntly/historic">Huntly&#39;s historical generation and records</a>'.replace('&#39;', "'"),
    )
  })

  it('describes a generator from its definition', () => {
    const p = page('/generator/huntly')
    expect(p.title).toBe('Huntly Power Station – Live Generation | NZ Electricity Map')
    // Its units in service, the battery counted once: 403 + 46 + 3 × 240 + 100
    expect(p.description).toBe(
      'Huntly is a 1,269 MW gas and coal power station in the North Island, operated by Genesis Energy. See its live and historical generation, offers and prices.',
    )
    expect(p.body).toContain('<h1>Huntly Power Station</h1>')
    expect(p.body).toContain('<a href="/substation/huntly">Huntly substation</a>')
  })

  it("lists a generator's units but not a battery's charging unit or one standing in for others", () => {
    const units = [...page('/generator/huntly').body.matchAll(/<tr><td>(.*?)<\/td>/g)].map((m) => m[1])
    expect(units).toEqual([
      'Huntly Unit 5 (HLY5)',
      'Huntly Unit 6 (HLY6)',
      'Huntly Rankine 1 (HLY1)',
      'Huntly Rankine 2 (HLY2)',
      'Huntly Rankine 4 (HLY4)',
      'Huntly Battery (HLY11)',
      'Huntly Rankine 3 (HLY3)',
    ])
  })

  it('describes a retired generator in the past tense', () => {
    expect(page('/generator/otahuhu').description).toBe(
      'Ōtāhuhu was a 380 MW gas power station in the North Island, operated by Contact until 2015. See its historical generation.',
    )
  })

  it("credits the site's creator on every page, in its text and structured data", () => {
    for (const p of pages) {
      const graph = (p.jsonLd as { '@graph': { '@type': string; name?: string; author?: object }[] })['@graph']
      expect(graph).toContainEqual(
        expect.objectContaining({
          '@type': 'Person',
          name: 'Morgan French-Stagg',
          url: 'https://www.linkedin.com/in/morganfrenchstagg',
        }),
      )
    }
    const html = renderPage(TEMPLATE, page('/substation/huntly'))
    expect(html).toContain(
      'created by\n<a href="https://www.linkedin.com/in/morganfrenchstagg" rel="author">Morgan French-Stagg</a>',
    )
  })

  it('links a substation to the generation connected there', () => {
    expect(page('/substation/huntly').body).toContain('<a href="/generator/huntly">Huntly</a>')
  })

  it('links every station from the home page', () => {
    const home = page('/').body
    expect(home).toContain('href="/generator/huntly"')
    expect(home).toContain('href="/generator/otahuhu"')
    expect(home).toContain('href="/substation/huntly"')
  })
})

describe("stations' data for agents", () => {
  const pages = buildPages(defs, [])
  const page = (path: string) => pages.find((p) => p.path === path)!

  it("tells agents in a station's Markdown that its 5-minute and daily data are there, and how to get them", () => {
    const markdown = pageMarkdown(page('/generator/huntly'))
    expect(markdown).toContain(
      "\n## Daily and 5-minute data\n\nThe MCP server and the API have Huntly's generation every 5 minutes from 11 September 2020, and every half hour before that back to August 1997, unit by unit, and its daily totals.\n",
    )
    expect(markdown).toContain(
      '- Through a day: the MCP tool `get_day_profile` with `{"station":["HLY"],"date":"YYYY-MM-DD","resolution":"5min","group_by":"unit"}`, or every node\'s from the API\'s `https://api.electricitymap.frenchsta.gg/v1/dispatch/YYYY-MM-DD`',
    )
    expect(markdown).toContain(
      '- Day by day: the MCP tool `get_energy` with `{"station":["HLY"],"resolution":"daily","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}`, or each day of a month, in MWh, from `https://api.electricitymap.frenchsta.gg/v1/dispatch/aggregates/YYYY/MM?nodes=HLY2201%20HLY5,HLY2201%20HLY6,',
    )
    expect(markdown).toContain(
      '- Right now: the MCP tool `get_current_state` with `{"station":["HLY"],"group_by":"unit"}`, or the latest 5 minutes from `https://api.electricitymap.frenchsta.gg/v1/dispatch/latest`',
    )
    expect(markdown).toContain("Its units' nodes in the API's data: `HLY2201 HLY5`, `HLY2201 HLY6`")
    expect(pageMarkdown(page('/generator/huntly/historic'))).toContain('\n## Daily and 5-minute data\n')
    // In the Markdown only
    expect(page('/generator/huntly').body).not.toContain('get_day_profile')
  })

  it('gives a station retired before the 5-minute data began its half-hourly data, and nothing live', () => {
    const markdown = pageMarkdown(page('/generator/otahuhu'))
    expect(markdown).toContain(
      "\n## Daily and half-hourly data\n\nThe MCP server and the API have Ōtāhuhu's generation every half hour while it ran, back to August 1997 (the 5-minute data starts on 11 September 2020, after it was retired), unit by unit, and its daily totals.\n",
    )
    expect(markdown).toContain('"resolution":"30min"')
    expect(markdown).not.toContain('Right now')
  })

  it('gives a station commissioned since the 5-minute data began only that', () => {
    const solar: Generator = {
      ...otahuhu,
      site: 'KHA',
      name: 'Kōwhai Park',
      units: [
        unit({ name: 'Kōwhai Park', unitCode: 'KHA0', node: 'KHA0331 KHA0', commissioned: '2025-03-01T12:00:00.000Z' }),
      ],
    }
    const [markdown] = buildPages({ generators: [solar], substations: [] }, [])
      .filter((p) => p.path === '/generator/kowhai-park')
      .map(pageMarkdown)
    expect(markdown).toContain("have Kōwhai Park's generation every 5 minutes, unit by unit, and its daily totals.")
    expect(markdown).toContain('- Right now:')
  })

  it("links the MCP server's and the API's docs once on every page's Markdown, the home page's in its content", () => {
    for (const path of ['/', '/hvdc', '/generator/huntly', '/substation/huntly']) {
      const markdown = pageMarkdown(page(path))
      expect(markdown.match(/\n## For developers and AI agents\n/g)).toHaveLength(1)
      expect(markdown).toContain('[docs](https://api.electricitymap.frenchsta.gg/docs)')
      expect(markdown).toContain('[server card](/.well-known/mcp/server-card.json)')
    }
    expect(page('/').body).toContain('<h2>For developers and AI agents</h2>')
  })
})

describe('renderPage', () => {
  const [home] = buildPages(defs, [])

  it('fills the head and #root of the template', () => {
    const html = renderPage(TEMPLATE, home)
    expect(html).toContain('<link rel="canonical" href="https://electricitymap.frenchsta.gg/" />')
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="/index.md" />')
    expect(html).toContain('<script type="application/ld+json">')
    expect(html).toContain('<div id="root"><div class="prerender">')
    expect(html).toContain('<a class="prerender__cta" href="/">Open live map</a>')
    expect(html).toContain('<footer class="prerender__footer">')
    expect(html).not.toContain('<title>x</title>')
  })

  it('keeps structured data from closing its script', () => {
    const html = renderPage(TEMPLATE, { ...home, jsonLd: { name: '</script><b>' } })
    expect(html).toContain('"\\u003c/script>\\u003cb>"')
  })

  it('fails on a template without the blocks', () => {
    expect(() => renderPage('<html></html>', home)).toThrow(/page-head/)
  })
})

describe('lastGeneratedDay', () => {
  const monthly = parseMonthly([
    {
      series: ['OTA2201 OTB'],
      data: [
        ['2025-01-01', 900000],
        ['2025-02-01', 2000],
        ['2025-03-01', 0.5],
        ['2025-04-01', 0],
      ],
    },
  ])
  const month = (rows: (string | number)[][]) => ({ series: ['OTA2201 OTB', 'OTA2201 OTHER'], data: rows })

  it("is the last day of a station's last month with a MWh that it generated a MWh on, not counting a meter's specks", async () => {
    const asked: string[] = []
    const day = await lastGeneratedDay(['OTA2201 OTB'], monthly, (m) => {
      asked.push(m)
      return Promise.resolve(
        month([
          ['2025-02-19', 1900, 0],
          ['2025-02-20', 100, 50],
          ['2025-02-21', 0.4, 9],
        ]),
      )
    })
    expect(day).toBe('2025-02-20')
    // March's half a MWh is too little to look at
    expect(asked).toEqual(['2025-02'])
  })

  it("looks back a month when none of the last one's days had a MWh", async () => {
    const days: Record<string, (string | number)[][]> = {
      '2025-02': [['2025-02-03', 0.9, 0]],
      '2025-01': [
        ['2025-01-30', 30000, 0],
        ['2025-01-31', 0, 0],
      ],
    }
    expect(await lastGeneratedDay(['OTA2201 OTB'], monthly, (m) => Promise.resolve(month(days[m])))).toBe('2025-01-30')
  })

  it('is null for a station with nothing on record', async () => {
    expect(await lastGeneratedDay(['NOPE'], monthly, () => Promise.reject(new Error('unused')))).toBeNull()
  })
})

describe('files', () => {
  it('names each page file as Pages serves it', () => {
    expect(pageFile('/')).toBe('index.html')
    expect(pageFile('/generator/huntly')).toBe('generator/huntly.html')
    expect(pageFile('/generator/huntly/historic')).toBe('generator/huntly/historic.html')
  })

  it("names each page's Markdown file as edge/markdown.ts serves it", () => {
    expect(markdownFile('/')).toBe('index.md')
    expect(markdownFile('/generator/huntly')).toBe('generator/huntly.md')
    expect(markdownFile('/analysis/fuel/hydro')).toBe('analysis/fuel/hydro.md')
  })

  it('lists every page in the sitemap', () => {
    const xml = sitemap(buildPages(defs, []))
    expect(xml).toContain('<loc>https://electricitymap.frenchsta.gg/generator/huntly</loc>')
    expect(xml).toContain('<loc>https://electricitymap.frenchsta.gg/generator/huntly/historic</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(14)
  })

  it('escapes text for HTML', () => {
    expect(esc('A & "B" <c>')).toBe('A &amp; &quot;B&quot; &lt;c&gt;')
  })
})

// A hydro station in the South Island beside them, and yearly totals for the
// three, 2026 being the year so far
const manapouri: Generator = {
  site: 'MAN',
  name: 'Manapōuri',
  operator: 'Meridian Energy',
  gridZone: 'SI',
  island: 'SI',
  location: { lat: -45.5, long: 167.3 },
  units: [
    unit({
      name: 'Manapōuri',
      unitCode: 'MAN0',
      node: 'MAN2201 MAN0',
      fuel: 'Hydro',
      fuelCode: 'HYD',
      capacity: 800,
      commissioned: '1971-09-01T12:00:00.000Z',
    }),
  ],
}
const withHydro: Definitions = { generators: [huntly, otahuhu, manapouri], substations: [hly] }
const aggregates: AnnualAggregates = {
  series: [
    'HLY2201 HLY5',
    'HLY2201 HLY1',
    'HLY2201 HLY1-4',
    'HLY2201 HLY11',
    'HLY2201 HLY91',
    'OTA2201 OTB',
    'MAN2201 MAN0',
    'KAW0112 DLS0',
    'HLY0331',
  ],
  data: [
    ['1997-01-01', 0, 0, 1500000, 0, 0, 500000, 2000000, 0, -200000],
    ['2015-01-01', 2000000, 1000000, 0, 0, 0, 100000, 5000000, 0, -300000],
    ['2024-01-01', 2500000, 500000, 0, 0, 0, 0, 4500000, 100000, -310000],
    ['2025-01-01', 2000000, 400000, 0, 10000, -12000, 0, 4552000, 100000, -320000],
    ['2026-01-01', 1000000, 100000, 0, 50000, -60000, 0, 4000000, 50000, -250000],
  ],
  hvdc: { series: ['northFlow', 'southFlow'], data: [['2025-01-01', 2065000, 592000]] },
}
const stats = parseStats(aggregates, 2026)
// Monthly totals for 2025 and 2026 to February so far: Manapōuri's from August
// 2025, and Ōtāhuhu's to March 2025
const months = (values: number[], year: number) =>
  values.map((v, i) => [`${year}-${String(i + 1).padStart(2, '0')}-01`, v, i < 3 ? 1000 * (i + 1) : 0])
const monthly = parseMonthly([
  {
    series: ['MAN2201 MAN0', 'OTA2201 OTB'],
    data: months([0, 0, 0, 0, 0, 0, 0, 300000, 420000, 480000, 410000, 390000], 2025),
  },
  { series: ['MAN2201 MAN0', 'OTA2201 OTB'], data: months([400000, 350000], 2026).map((row) => [row[0], row[1], 0]) },
])

describe('yearly figures', () => {
  it("reads each node's MWh a year, and which years are only partly covered", () => {
    expect(stats.years).toEqual([1997, 2015, 2024, 2025, 2026])
    expect([...stats.partial]).toEqual([1997, 2026])
    expect(stats.hvdc?.north).toEqual([0, 0, 0, 2065, 0])
  })

  it("sums the grid's generation in GWh without batteries charging, and with nodes the definitions lack", () => {
    // 2025: Huntly's 2,000 + 400 + 10 discharged, Manapōuri's 4,552 and the unknown node's 100
    expect(totalGeneration(stats, withHydro)[3]).toBe(7062)
  })

  it('counts a node once however many units name it', () => {
    expect(sumNodes(stats, ['MAN2201 MAN0', 'MAN2201 MAN0'])[3]).toBe(4552)
  })

  it("takes a substation's demand as what its buses drew", () => {
    expect(substationDemand(stats, 'HLY')[3]).toBe(320)
  })
})

describe('pages with yearly figures', () => {
  const pages = buildPages(withHydro, [], stats, monthly)
  const page = (path: string) => pages.find((p) => p.path === path)!

  it("gives a station's history its generation every month, newest year first, and its best month", () => {
    const history = page('/generator/manapouri/historic')
    expect(history.body).toContain(
      "<h2>Generation by month</h2>\n<p>Manapōuri's generation each month, in GWh, February 2026 only so far.</p>",
    )
    const markdown = pageMarkdown(history)
    expect(markdown).toContain(
      [
        '| Year | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        '| 2026 | 400 | 350 |  |  |  |  |  |  |  |  |  |  |',
        '| 2025 |  |  |  |  |  |  |  | 300 | 420 | 480 | 410 | 390 |',
      ].join('\n'),
    )
    // Of the whole months, not February 2026 so far
    expect(markdown).toContain('- **Best month:** October 2025, with 480 GWh\n')
    expect(markdown.indexOf('## Generation by year')).toBeLessThan(markdown.indexOf('## Generation by month'))
  })

  it("stops a retired station's months at its last, and leaves out a station's with none", () => {
    const markdown = pageMarkdown(page('/generator/otahuhu/historic'))
    expect(markdown).toContain("Ōtāhuhu's generation each month, in GWh.\n")
    expect(markdown).toContain('| 2025 | 1.0 | 2.0 | 3.0 |  |')
    expect(markdown).not.toContain('| 2026 |')
    expect(page('/generator/huntly/historic').body).not.toContain('Generation by month')
  })

  it("puts today's generation in a live station's Markdown, after its facts, for the edge to fill in", () => {
    expect(pageMarkdown(page('/generator/manapouri'))).toContain(
      '- **Site code:** MAN\n\n## Today\n\nIts generation so far today, every 5 minutes: the MCP tool `get_day_profile` with `{"station":["MAN"]}`.\n\n## Generation by year\n',
    )
    expect(pageMarkdown(page('/generator/otahuhu'))).not.toContain('## Today')
    expect(pageMarkdown(page('/generator/manapouri/historic'))).not.toContain('## Today')
    expect(page('/generator/manapouri').body).not.toContain('Today')
  })

  it("writes a station's page as Markdown, its figures in a table rather than a chart", () => {
    const markdown = pageMarkdown(page('/generator/manapouri'))
    expect(markdown).toContain('\n# Manapōuri Power Station\n')
    expect(markdown).toContain('\n- **Operator:** Meridian Energy\n')
    expect(markdown).toContain('\n## Generation by year\n\nIn 2025, Manapōuri generated 4,552 GWh')
    expect(markdown).toContain('\n| Year | Generation (GWh) |\n| --- | ---: |\n| 2026 so far |')
    expect(markdown).toContain("[Manapōuri's historical generation and records](/generator/manapouri/historic)")
    expect(markdown).not.toMatch(/<|&[a-z]+;|prerender/)
  })

  it('gives a station its yearly generation, share, rank, capacity factor and best year', () => {
    const body = page('/generator/manapouri').body
    // 4,552 GWh over 800 MW through 2025's 8,760 hours
    expect(body).toContain(
      'In 2025, Manapōuri generated 4,552 GWh, 64.5% of New Zealand&#39;s grid generation, the most of any station, at a capacity factor of 65%.'.replace(
        '&#39;',
        "'",
      ),
    )
    expect(body).toContain('Its best year was 2015, with 5,000 GWh.')
    expect(body).toContain('So far in 2026, it&#39;s generated 4,000 GWh.'.replace('&#39;', "'"))
    expect(body).toContain('<th class="num">Generation (GWh)</th>')
    expect(body).toContain('<td>2026&nbsp;so&nbsp;far</td><td class="num">4,000</td>')
    expect(body).toContain('<td>1997&nbsp;(Aug–Dec)</td><td class="num">2,000</td>')
    expect(tips(body)[0]).toEqual({
      title: '1997 (Aug–Dec)',
      rows: [
        { name: 'Generation', value: '2,000 GWh', swatch: 'part' },
        { name: 'Share of grid', value: '50.0%' },
      ],
    })
    expect(tips(body).at(-1)?.title).toBe('2026 so far')
    expect(body).toContain('Part years: 1997 (Aug–Dec) and 2026 so far')
  })

  it("gives a generator's history its records, and its share of the grid's generation each year", () => {
    const body = page('/generator/manapouri/historic').body
    expect(body).toContain('<dt>On record since</dt><dd>August 1997, when the records begin</dd>')
    // Of 2015's 8,100 GWh: Huntly's 3,000 + Ōtāhuhu's 100 + Manapōuri's 5,000
    expect(body).toContain(
      '<dt>Best year</dt><dd>2015, with 5,000 GWh (61.7% of the grid&#39;s generation)</dd>'.replace('&#39;', "'"),
    )
    expect(body).toContain('<dt>Generated on record</dt><dd>20,052 GWh</dd>')
    expect(body).toContain('<td>2025</td><td class="num">4,552</td><td class="num">64.5%</td>')
    expect(body).not.toContain('Last generated')
  })

  it("gives a retired generator's history the last year it generated", () => {
    expect(page('/generator/otahuhu/historic').body).toContain('<dt>Last generated</dt><dd>2015</dd>')
  })

  it('leaves out a capacity factor when its capacity changed during the year', () => {
    expect(page('/generator/huntly').body).not.toContain('capacity factor')
  })

  it("counts a retired station's years before it was retired, the combined units' among them", () => {
    expect(page('/generator/huntly').body).toContain('<td>1997&nbsp;(Aug–Dec)</td><td class="num">1,500</td>')
    expect(page('/generator/otahuhu').body).toContain('<td>2015</td><td class="num">100</td>')
  })

  it("ends a retired station's years at the last it generated in", () => {
    const station = pageMarkdown(page('/generator/otahuhu'))
    expect(station).toContain('| 2015 | 100 |\n| 1997 (Aug–Dec) | 500 |')
    expect(station).not.toMatch(/\| 202[456]/)
    // Its one whole year isn't a best
    expect(station).not.toContain('best year')
    const history = pageMarkdown(page('/generator/otahuhu/historic'))
    expect(history).toContain("Ōtāhuhu's electricity generation every year from 1997 to 2015,")
    expect(history).not.toMatch(/\| 202[456] \| [^|]* \| [^|]* \|\n/)
  })

  it('says a retired station is decommissioned, and when it last generated', () => {
    const withDay = buildPages(withHydro, [], stats, monthly, new Map([['OTA', '2015-09-21']]))
    const find = (path: string) => pageMarkdown(withDay.find((p) => p.path === path)!)
    const station = find('/generator/otahuhu')
    expect(station).toContain(
      "Ōtāhuhu was a 380 MW gas power station in the North Island, operated by Contact until 2015. It's now decommissioned, and last generated on 21 Sept 2015. See its historical generation.",
    )
    expect(station).toContain('- **Decommissioned:** 1 Oct 2015\n- **Last generated:** 21 Sept 2015\n')
    const history = find('/generator/otahuhu/historic')
    expect(history).toContain("It's now decommissioned, and last generated on 21 Sept 2015.\n")
    expect(history).toContain('- **Last generated:** 21 Sept 2015\n')
    // Without the day, the year
    expect(page('/generator/otahuhu').body).toContain("It's now decommissioned. See its")
    expect(pageMarkdown(page('/generator/otahuhu/historic'))).toContain('- **Last generated:** 2015\n')
    expect(find('/generator/manapouri')).not.toContain('decommissioned')
  })

  it('gives a substation its yearly demand', () => {
    expect(page('/substation/huntly').body).toContain('In 2025, 320 GWh was taken from the grid at Huntly.')
  })

  it('gives the HVDC its yearly flows', () => {
    expect(page('/hvdc').body).toContain('In 2025, the link sent 2,065 GWh north and 592 GWh south.')
  })

  it("writes a fuel's page from its units, a station with several fuels on each of theirs", () => {
    const gas = page('/analysis/fuel/gas')
    expect(gas.standalone).toBe(true)
    expect(gas.body).toContain(
      'In 2025, gas-fired units generated 2,000 GWh, 28.3% of the electricity generated on New Zealand&#39;s national grid.'.replace(
        '&#39;',
        "'",
      ),
    )
    expect(gas.live).toBe('/?fuels=GAS')
    expect(gas.body).toContain('There is 1 station with gas-fired units in service, with 449 MW of capacity: Huntly.')
    expect(gas.body).toContain(
      '<a href="/generator/huntly">Huntly</a></td><td>Genesis Energy</td><td>North Island</td><td class="num">449</td><td class="num">2,000</td>',
    )
    expect(gas.body).toContain(
      '<h3>Retired</h3><ul class="prerender__links"><li><a href="/generator/otahuhu">Ōtāhuhu</a></li></ul>',
    )
    expect(page('/analysis/fuel/batteries').body).toContain('grid batteries generated 10 GWh, 0.1%')
  })

  it('writes the renewable share every year', () => {
    const body = page('/analysis/renewable-energy').body
    expect(body).toContain(
      'In 2025, 64.5% of the electricity generated on New Zealand&#39;s national grid came from renewable sources: hydro 64.5%.'.replace(
        '&#39;',
        "'",
      ),
    )
    expect(body).toContain('<td>2025</td><td class="num">64.5%</td><td class="num">4,552</td>')
  })

  it("writes each island's generation, demand and HVDC flows", () => {
    const body = page('/analysis/island/south-island').body
    expect(body).toContain(
      'In 2025, they generated 4,552 GWh, 64.5% of New Zealand&#39;s grid generation'.replace('&#39;', "'"),
    )
    expect(body).toContain(
      'It imported 592 GWh from the North Island over the HVDC link, and exported 2,065 GWh to it.',
    )
  })

  it("marks an island's demand across its generation each year", () => {
    // Huntly's 2,000 + 400 + 10 discharged, and Huntly substation's 320
    const body = page('/analysis/island/north-island').body
    expect(tips(body).find((t) => t.title === '2025')).toEqual({
      title: '2025',
      rows: [
        { name: 'Generation', value: '2,410 GWh', swatch: 'bar' },
        { name: 'Taken from the grid', value: '320 GWh', swatch: 'mark' },
        { name: 'Imported via HVDC', value: '2,065 GWh' },
        { name: 'Exported via HVDC', value: '592 GWh' },
      ],
    })
    expect(body).toContain('class="prerender__chart-mark"')
    expect(body).toContain(
      '<td>2025</td><td class="num">2,410</td><td class="num">320</td><td class="num">2,065</td><td class="num">592</td>',
    )
  })

  it('links a station to its fuel, operator and island pages', () => {
    expect(page('/generator/manapouri').body).toContain(
      'See also: <a href="/analysis/fuel/hydro">Hydro power in New Zealand</a> · <a href="/analysis/island/south-island">Electricity in the South Island</a>',
    )
  })

  it('puts each Analysis page under Analysis in its breadcrumbs, and marks the section in its header', () => {
    const hydro = page('/analysis/fuel/hydro')
    expect(hydro.body).toContain(
      '<a href="/">NZ Electricity Map</a> › <a href="/analysis">Analysis</a> › Hydro power in New Zealand',
    )
    expect(JSON.stringify(hydro.jsonLd)).toContain(
      '"name":"Analysis","item":"https://electricitymap.frenchsta.gg/analysis"',
    )
    expect(renderPage(TEMPLATE, hydro)).toContain('<a href="/analysis" aria-current="true">Analysis</a>')
    expect(renderPage(TEMPLATE, page('/generator/manapouri'))).toContain('<a href="/analysis">Analysis</a></nav>')
  })

  it("sums up the renewable share, and each fuel's, island's and operator's figures, on the Analysis page", () => {
    const analysis = page('/analysis')
    expect(analysis.standalone).toBe(true)
    expect(renderPage(TEMPLATE, analysis)).toContain('<a href="/analysis" aria-current="page">Analysis</a>')
    // Huntly's 2,000 + 400 + 10 discharged, Manapōuri's 4,552 and the unknown node's 100
    expect(analysis.body).toContain(
      'In 2025, the grid generated 7,062 GWh, 64.5% of it from renewable sources: hydro 64.5%.',
    )
    expect(analysis.body).toContain(
      '<a href="/analysis/renewable-energy">How renewable is New Zealand\'s electricity?</a>',
    )
    // Hydro, Manapōuri's 800 MW, generated the most in 2025, so it comes first
    expect(analysis.body).toContain(
      '<tbody><tr><td><a href="/analysis/fuel/hydro">Hydro</a></td><td class="num">1</td><td class="num">800</td><td class="num">4,552</td><td class="num">64.5%</td></tr>',
    )
  })

  it("names the page it's on among the links at its foot, without linking it to itself", () => {
    const body = page('/analysis/fuel/hydro').body
    expect(body).toContain('<li><span aria-current="page">Hydro</span></li>')
    expect(body).toContain('<li><a href="/analysis/fuel/gas">Gas</a></li>')
  })

  it('leads the home page with the renewable share', () => {
    expect(page('/').body).toContain(
      'In 2025, 64.5% of the electricity generated on New Zealand&#39;s national grid was renewable.'.replace(
        '&#39;',
        "'",
      ),
    )
  })

  it('writes a topic page without the app, keeping its stylesheet', () => {
    const template =
      '<head><!--page-head--><!--/page-head--><script type="module" crossorigin src="/assets/index.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/react.js">\n<link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"><!--page-body--><!--/page-body--></div></body>'
    const topic = renderPage(template, page('/analysis/fuel/hydro'))
    expect(topic).not.toContain('script type="module"')
    expect(topic).not.toContain('modulepreload')
    expect(topic).toContain('<link rel="stylesheet" href="/assets/index.css">')
    expect(renderPage(template, page('/generator/manapouri'))).toContain('script type="module"')
  })

  it("loads the charts' tooltips on a page of its own with a chart, in place of the app", () => {
    const template =
      '<head><!--page-head--><!--/page-head--><script type="module" crossorigin src="/assets/index.js"></script>\n</head><body><div id="root"><!--page-body--><!--/page-body--></div></body>'
    const script = '<script type="module" src="/assets/chartTooltip.js"></script>'
    expect(renderPage(template, page('/analysis/fuel/hydro'), '/assets/chartTooltip.js')).toContain(script)
    expect(renderPage(template, page('/analysis/fuel/hydro'), '/assets/chartTooltip.js')).not.toContain(
      '/assets/index.js',
    )
    expect(renderPage(template, page('/analysis'), '/assets/chartTooltip.js')).not.toContain(script)
    expect(renderPage(template, page('/generator/manapouri'), '/assets/chartTooltip.js')).not.toContain(script)
  })
})

describe('tables', () => {
  it('gives a column of figures one precision, with none as a dash', () => {
    expect(figures([1234.4, 93.8, 0, 0.3])).toEqual(['1,234', '94', '–', '&lt;1'])
    expect(figures([93.8, 1.14])).toEqual(['93.8', '1.1'])
  })

  it('gives a share a decimal place, with none as a dash', () => {
    expect(shareCell(0.05)).toBe('5.0%')
    expect(shareCell(0)).toBe('–')
    expect(shareCell(0.0001)).toBe('&lt;0.1%')
  })

  it('shows the latest ten years, and the rest behind a toggle', () => {
    const years = Array.from({ length: 20 }, (_, i) => 2007 + i)
    const many = parseStats({ series: ['MAN2201 MAN0'], data: years.map((y) => [`${y}-01-01`, 1000000]) }, 2026)
    const html = yearlyTable(many, [{ head: 'Generation', values: years.map(() => 1000) }])
    expect(html).toContain('<summary>Earlier years, 2007–2016</summary>')
    expect(html.indexOf('<td>2017</td>')).toBeLessThan(html.indexOf('prerender__more-rows'))
    expect(html.indexOf('<td>2016</td>')).toBeGreaterThan(html.indexOf('prerender__more-rows'))
  })
})

describe('descriptions', () => {
  it('adds the second sentence only when it fits in 160 characters', () => {
    expect(fitDescription('A short one.', 'And more.')).toBe('A short one. And more.')
    expect(fitDescription(`${'x'.repeat(150)}.`, 'And more.')).toBe(`${'x'.repeat(150)}.`)
  })

  it("keeps every page's description within 160 characters", () => {
    for (const page of [...buildPages(defs, []), ...buildPages(withHydro, [], stats)]) {
      expect(page.description.length, page.path).toBeLessThanOrEqual(160)
    }
  })

  it("ends a station's description with what its page shows, when it fits", () => {
    expect(buildPages(withHydro, [], stats).find((p) => p.path === '/generator/huntly')!.description).toBe(
      'Huntly is a 1,269 MW gas and coal power station in the North Island, operated by Genesis Energy. See its live and historical generation, offers and prices.',
    )
  })
})

describe('barChart', () => {
  const html = barChart(
    [
      { label: '2024', value: 12000 },
      { label: '2025', value: 0 },
      { label: '2026', value: 6000, partial: true, title: '2026 so far' },
    ],
    {
      colour: 'red',
      unit: 'GWh',
      label: 'Generation each year',
      format: (v) => `${v} GWh`,
      name: 'Generation',
    },
  )

  it('draws a bar for each value above zero, as tall as its share of the axis, the partial year faded', () => {
    expect(html.match(/class="prerender__chart-bar/g)).toHaveLength(2)
    // 12,000 of an axis up to 15,000
    expect(html).toContain('<div class="prerender__chart-bar" style="height:80%"></div>')
    expect(html).toContain('<div class="prerender__chart-bar prerender__chart-bar--part" style="height:40%"></div>')
  })

  it('gives each bar its year and value for its tooltip, and the chart a label', () => {
    expect(tips(html).map((t) => t.title)).toEqual(['2024', '2025', '2026 so far'])
    expect(tips(html)[2].rows).toEqual([{ name: 'Generation', value: '6000 GWh', swatch: 'part' }])
    expect(html).toContain('role="img" aria-label="Generation each year" style="--chart-colour:red"')
  })

  it('names its unit over the axis', () => {
    expect(html).toContain('<span class="prerender__chart-unit">GWh</span>')
  })

  it('labels a large axis compactly, in clean steps from zero', () => {
    expect(html).toContain('<div class="prerender__chart-tick" style="bottom:0%"><span>0</span></div>')
    expect(html).toContain('<div class="prerender__chart-tick" style="bottom:33.3%"><span>5K</span></div>')
    expect(html).toContain('<div class="prerender__chart-tick" style="bottom:100%"><span>15K</span></div>')
  })
})
