import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, pageMarkdown } from './markdown'
import { barChart } from './charts'
import { table } from './html'

describe('htmlToMarkdown', () => {
  it('writes headings, paragraphs and lists', () => {
    expect(
      htmlToMarkdown('<h1>Huntly</h1>\n<p>A  gas\nstation.</p><h2>Units</h2><ul><li>One</li><li>Two</li></ul>'),
    ).toBe('# Huntly\n\nA gas station.\n\n## Units\n\n- One\n- Two')
  })

  it("writes links as the page has them, and decodes the HTML's entities", () => {
    expect(htmlToMarkdown('<p>See <a href="/generator/huntly">Huntly&#39;s &amp; Ōtāhuhu&#x27;s</a>.</p>')).toBe(
      "See [Huntly's & Ōtāhuhu's](/generator/huntly).",
    )
    expect(htmlToMarkdown('<p><a href="https://www.emi.ea.govt.nz">EMI</a></p>')).toBe(
      '[EMI](https://www.emi.ea.govt.nz)',
    )
  })

  it('writes a definition list as terms and values', () => {
    expect(
      htmlToMarkdown('<dl class="prerender__facts"><dt>Operator</dt><dd>Genesis</dd><dt>Fuel</dt><dd>Gas</dd></dl>'),
    ).toBe('- **Operator:** Genesis\n- **Fuel:** Gas')
  })

  it('writes a table with every row, its figures right-aligned', () => {
    const html = table(
      ['Year', 'Generation (GWh)'],
      [
        ['2025', '1,234'],
        ['2024', 'a|b'],
      ],
      1,
      {
        label: 'Earlier years',
        rows: [['2023&nbsp;so&nbsp;far', '&lt;0.1']],
      },
    )
    expect(htmlToMarkdown(html)).toBe(
      '| Year | Generation (GWh) |\n| --- | ---: |\n| 2025 | 1,234 |\n| 2024 | a\\|b |\n| 2023 so far | <0.1 |',
    )
  })

  it('leaves out the breadcrumbs, the charts and their keys', () => {
    const chart = barChart([{ label: '2025', value: 10 }], {
      colour: 'red',
      unit: 'GWh',
      label: 'Chart',
      format: String,
      name: 'Generation',
    })
    const html = `<nav class="prerender__crumbs"><a href="/">Home</a> › Huntly</nav><h1>Huntly</h1>${chart}<p class="prerender__key"><span>Part year</span></p>`
    expect(htmlToMarkdown(html)).toBe('# Huntly')
  })

  it('escapes text that Markdown would take for formatting', () => {
    expect(htmlToMarkdown('<p>*not* [a] _link_</p>')).toBe('\\*not\\* \\[a\\] \\_link\\_')
  })

  it('leaves an underscore inside a word, which Markdown never takes for emphasis', () => {
    expect(htmlToMarkdown('<td>Te Awamutu (te_awamutu)</td>')).toBe('Te Awamutu (te_awamutu)')
    expect(htmlToMarkdown('<p>ō_ā _x x_</p>')).toBe('ō_ā \\_x x\\_')
  })

  it('keeps bare text between blocks as a paragraph of its own', () => {
    expect(htmlToMarkdown('<div>Before<h2>Heading</h2>after <b>bold</b></div>')).toBe(
      'Before\n\n## Heading\n\nafter **bold**',
    )
  })
})

describe('pageMarkdown', () => {
  const page = {
    path: '/hvdc',
    title: 'HVDC: Inter-Island Link | NZ Electricity Map',
    description: 'Flows "north" and south.',
    jsonLd: {},
    body: '<h1>HVDC Inter-Island Link</h1><p>Flows north and south.</p>',
  }

  it('leads with front matter, and ends with the footer', () => {
    const markdown = pageMarkdown(page)
    expect(markdown).toMatch(
      /^---\ntitle: "HVDC: Inter-Island Link \| NZ Electricity Map"\ndescription: "Flows \\"north\\" and south."\nurl: "https:\/\/electricitymap.frenchsta.gg\/hvdc"\n---\n\n# HVDC Inter-Island Link\n\nFlows north and south.\n\nData from/,
    )
    expect(markdown).toContain('[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)')
    expect(markdown).toMatch(/LinkedIn\]\(https:\/\/www.linkedin.com\/in\/morganfrenchstagg\)\.\n$/)
  })
})
