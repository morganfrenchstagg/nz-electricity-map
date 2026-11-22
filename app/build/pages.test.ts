import { describe, expect, it } from 'vitest'
import type { Generator, Substation, Unit } from '../src/types'
import { buildPages, esc, pageFile, renderPage, sitemap } from './pages'
import type { Definitions } from './pages'

function unit(overrides: Partial<Unit> = {}): Unit {
  return { name: 'Huntly 5', unitCode: 'HLY5', node: 'HLY2201 HLY5', capacity: 400, fuel: 'Gas', fuelCode: 'GAS', commissioned: '2007-06-01T12:00:00.000Z', ...overrides }
}

const huntly: Generator = {
  site: 'HLY', name: 'Huntly', operator: 'Genesis', gridZone: 'CNI', island: 'NI', location: { lat: -37.5, long: 175.1 },
  units: [unit(), unit({ name: 'Huntly 1', unitCode: 'HLY1', fuel: 'Coal/Gas', capacity: 250, commissioned: '1983-01-01T12:00:00.000Z' })],
}
const otahuhu: Generator = {
  site: 'OTA', name: 'Ōtāhuhu', operator: 'Contact', gridZone: 'UNI', island: 'NI', location: { lat: -36.9, long: 174.8 },
  units: [unit({ name: 'Ōtāhuhu B', unitCode: 'OTB', node: 'OTA2201 OTB', capacity: 380, decomissioned: '2015-09-30T12:00:00.000Z' })],
}
const hly: Substation = { siteId: 'HLY', description: 'Huntly', lat: -37.5, long: 175.1, type: 'ACSTN', gridZone: 1, island: 'north' }
const defs: Definitions = { generators: [huntly, otahuhu], substations: [hly] }
const TEMPLATE = '<head><!--page-head--><title>x</title><!--/page-head--></head><body><div id="root"><!--page-body--><!--/page-body--></div></body>'

describe('buildPages', () => {
  const pages = buildPages(defs, [])
  const page = (path: string) => pages.find((p) => p.path === path)!

  it('writes the home, HVDC, pipeline and every station page', () => {
    expect(pages.map((p) => p.path)).toEqual(['/', '/hvdc', '/pipeline', '/generator/huntly', '/generator/otahuhu', '/substation/huntly'])
  })

  it('describes a generator from its definition', () => {
    const p = page('/generator/huntly')
    expect(p.title).toBe('Huntly Power Station – Live Generation | NZ Electricity Map')
    expect(p.description).toBe('Huntly is a 650 MW gas and coal power station in the North Island, operated by Genesis. See its live and historical generation, offers and prices.')
    expect(p.body).toContain('<h1>Huntly Power Station</h1>')
    expect(p.body).toContain('<a href="/substation/huntly">Huntly substation</a>')
  })

  it('describes a retired generator in the past tense', () => {
    expect(page('/generator/otahuhu').description).toBe('Ōtāhuhu was a 380 MW gas power station in the North Island, operated by Contact until 2015. See its historical generation.')
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

describe('renderPage', () => {
  const [home] = buildPages(defs, [])

  it('fills the head and #root of the template', () => {
    const html = renderPage(TEMPLATE, home)
    expect(html).toContain('<link rel="canonical" href="https://electricitymap.frenchsta.gg/" />')
    expect(html).toContain('<script type="application/ld+json">')
    expect(html).toContain('<div id="root"><main class="prerender">')
    expect(html).not.toContain('<title>x</title>')
  })

  it("keeps structured data from closing its script", () => {
    const html = renderPage(TEMPLATE, { ...home, jsonLd: { name: '</script><b>' } })
    expect(html).toContain('"\\u003c/script>\\u003cb>"')
  })

  it('fails on a template without the blocks', () => {
    expect(() => renderPage('<html></html>', home)).toThrow(/page-head/)
  })
})

describe('files', () => {
  it('names each page file as Pages serves it', () => {
    expect(pageFile('/')).toBe('index.html')
    expect(pageFile('/generator/huntly')).toBe('generator/huntly.html')
  })

  it('lists every page in the sitemap', () => {
    const xml = sitemap(buildPages(defs, []))
    expect(xml).toContain('<loc>https://electricitymap.frenchsta.gg/generator/huntly</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(6)
  })

  it('escapes text for HTML', () => {
    expect(esc('A & "B" <c>')).toBe('A &amp; &quot;B&quot; &lt;c&gt;')
  })
})
