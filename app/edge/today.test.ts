import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  groupsToday,
  hasTodayHtml,
  stationToday,
  stationTodayHtml,
  todayHtmlPlaceholder,
  todayPlaceholder,
  withToday,
  withTodayHtml,
} from './today'
import type { DayProfile } from './today'

const PROFILE: DayProfile = {
  date: '2026-11-28',
  columns: ['period', 'Manapōuri'],
  rows: [
    ['2026-11-28T00:00', 600],
    ['2026-11-28T00:05', 610],
    ['2026-11-28T00:10', null],
    ['2026-11-28T00:25', 620],
    ['2026-11-28T00:30', 700],
    ['2026-11-28T00:35', 715.25],
  ],
  summary: { Manapōuri: { peakMW: 715.25, peakAt: '2026-11-28T00:35', energyGWh: 0.4321 } },
}

describe('stationToday', () => {
  it('gives the energy so far, the peak and when it was, the latest reading, and every 5 minutes', () => {
    expect(stationToday(PROFILE)).toBe(
      [
        '## Today',
        'So far on 28 November 2026, in NZ time:',
        '- Generated: 432.1 MWh\n- Peak: 715.3 MW at 00:35\n- Latest: 715.3 MW at 00:35',
        [
          '| Time | Generation (MW) |',
          '| --- | ---: |',
          '| 00:00 | 600 |',
          '| 00:05 | 610 |',
          // A missing reading
          '| 00:10 | – |',
          '| 00:25 | 620 |',
          '| 00:30 | 700 |',
          '| 00:35 | 715.3 |',
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it('gives the energy to the MWh, as the API does, and a little as under 1', () => {
    const little = {
      ...PROFILE,
      rows: [['2026-11-28T00:00', 0.3]],
      summary: { Manapōuri: { ...PROFILE.summary.Manapōuri, energyGWh: 0 } },
    }
    expect(stationToday(little)).toContain('- Generated: under 1 MWh\n')
  })

  it("says so when a station hasn't generated today", () => {
    expect(stationToday({ ...PROFILE, columns: ['period'], rows: [['2026-11-28T00:00']], summary: {} })).toBe(
      "## Today\n\nIt hasn't generated so far today, 28 November 2026 (NZ time).",
    )
  })
})

describe('stationTodayHtml', () => {
  it('gives the energy so far, the peak and the latest reading, and every 5 minutes, newest first', () => {
    const html = stationTodayHtml(PROFILE)
    expect(html).toContain(
      '<h2>Today</h2>\n<p>So far on 28 November 2026, in NZ time:</p>\n<dl class="prerender__facts"><dt>Generated</dt><dd>432.1 MWh</dd><dt>Peak</dt><dd>715.3 MW at 00:35</dd><dt>Latest</dt><dd>715.3 MW at 00:35</dd></dl>',
    )
    expect(html).toContain('<th>Time</th><th class="num">Generation (MW)</th>')
    expect(html).toContain(
      '<tbody><tr><td>00:35</td><td class="num">715.3</td></tr><tr><td>00:30</td><td class="num">700</td></tr>',
    )
    // A missing reading
    expect(html).toContain('<tr><td>00:10</td><td class="num">–</td></tr>')
    expect(html).not.toContain('<details>')
  })

  it('shows the latest hour, and the readings before it behind a toggle', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [
      `2026-11-28T${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`,
      i,
    ])
    const html = stationTodayHtml({ ...PROFILE, rows })
    const [shown, earlier] = html.split('<tbody class="prerender__more-rows">')
    expect(shown.match(/<tr><td>/g)).toHaveLength(12)
    expect(shown).toContain('<tbody><tr><td>02:25</td><td class="num">29</td></tr>')
    expect(earlier.match(/<tr><td>/g)).toHaveLength(18)
    expect(earlier).toMatch(/^<tr><td>01:25<\/td>/)
    expect(html).toContain('<details><summary>Earlier today, 00:00–01:25</summary></details>')
  })

  it("says so when a station hasn't generated today", () => {
    expect(stationTodayHtml({ ...PROFILE, columns: ['period'], rows: [['2026-11-28T00:00']], summary: {} })).toBe(
      "<h2>Today</h2>\n<p>It hasn't generated so far today, 28 November 2026 (NZ time).</p>",
    )
  })
})

// The grid's day by fuel, with its total, and a missing reading
const BY_FUEL: DayProfile = {
  date: '2026-11-28',
  columns: ['period', 'Hydro', 'Wind', 'total'],
  rows: [
    ['2026-11-28T00:00', 3000, 100, 3100],
    ['2026-11-28T00:05', 3100, null, 3200],
    ['2026-11-28T00:30', 2900, 300.25, 3200.25],
  ],
  summary: {
    Hydro: { peakMW: 3100, peakAt: '2026-11-28T00:05', energyGWh: 0.75 },
    Wind: { peakMW: 300.25, peakAt: '2026-11-28T00:30', energyGWh: 0.0167 },
    total: { peakMW: 3200.25, peakAt: '2026-11-28T00:30', energyGWh: 0.7667 },
  },
}

describe('groupsToday', () => {
  it("gives each fuel's and the total's energy, share, peak and latest reading, and their half hours", () => {
    expect(groupsToday(BY_FUEL, 'Fuel')).toBe(
      [
        '## Today',
        'So far on 28 November 2026, in NZ time, with the latest readings at 00:30:',
        [
          '| Fuel | Generated (MWh) | Share | Peak (MW) | Peak at | Latest (MW) |',
          '| --- | ---: | ---: | ---: | ---: | ---: |',
          '| Hydro | 750 | 97.8% | 3,100 | 00:05 | 2,900 |',
          '| Wind | 16.7 | 2.2% | 300.3 | 00:30 | 300.3 |',
          '| Total | 766.7 | 100% | 3,200.3 | 00:30 | 3,200.3 |',
        ].join('\n'),
        [
          '| Half hour (mean MW) | Hydro | Wind | Total |',
          '| --- | ---: | ---: | ---: |',
          // Wind's missing reading left out of its mean, not taken as 0
          '| 00:00 | 3,050 | 100 | 3,150 |',
          '| 00:30 | 2,900 | 300.3 | 3,200.3 |',
        ].join('\n'),
      ].join('\n\n'),
    )
  })
})

describe('withToday', () => {
  const page = `# Manapōuri Power Station\n\n${todayPlaceholder('Its generation', { station: ['MAN'] })}\n\n## Generation by year\n`

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function answer(response: Response | Error) {
    const fetch = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it("fills in the placeholder with the station's day from the MCP server", async () => {
    const fetch = answer(Response.json({ result: { content: [{ type: 'text', text: JSON.stringify(PROFILE) }] } }))
    const filled = await withToday(page)
    expect(filled).toBe(`# Manapōuri Power Station\n\n${stationToday(PROFILE)}\n\n## Generation by year\n`)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.electricitymap.frenchsta.gg/mcp')
    expect(JSON.parse(init.body as string)).toMatchObject({
      method: 'tools/call',
      params: { name: 'get_day_profile', arguments: { station: ['MAN'], group_by: 'station', resolution: '5min' } },
    })
  })

  it("fills in the home page's by fuel", async () => {
    const fetch = answer(Response.json({ result: { content: [{ type: 'text', text: JSON.stringify(BY_FUEL) }] } }))
    const home = `# NZ Electricity Map\n\n${todayPlaceholder("New Zealand's generation by fuel", { group_by: 'fuel' })}\n\n## Analysis\n`
    expect(await withToday(home)).toBe(`# NZ Electricity Map\n\n${groupsToday(BY_FUEL, 'Fuel')}\n\n## Analysis\n`)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      params: { name: 'get_day_profile', arguments: { group_by: 'fuel', resolution: '5min' } },
    })
  })

  it("keeps the placeholder when the MCP server can't answer", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    answer(new Response('Bad gateway', { status: 502 }))
    expect(await withToday(page)).toBe(page)
    answer(Response.json({ result: { isError: true, content: [{ type: 'text', text: 'Unknown station' }] } }))
    expect(await withToday(page)).toBe(page)
    answer(new TypeError('fetch failed'))
    expect(await withToday(page)).toBe(page)
    expect(error).toHaveBeenCalledTimes(3)
  })

  it('leaves a page without the placeholder as it is, without asking', async () => {
    const fetch = answer(new Error('unused'))
    expect(await withToday('# Ōtāhuhu Power Station\n')).toBe('# Ōtāhuhu Power Station\n')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('withTodayHtml', () => {
  const placeholder = todayHtmlPlaceholder('MAN')
  const page = `<!doctype html><head></head><h1>Manapōuri</h1>\n${placeholder}\n<h2>Generation by year</h2>`
  const [before, after] = page.split(placeholder)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function rest(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder()
    let text = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
      text += decoder.decode(chunk.value, { stream: true })
    return text
  }

  it("sends the HTML before the section at once, then the station's day from the MCP server", async () => {
    let answer: (response: Response) => void = () => {}
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    vi.stubGlobal('fetch', fetch)
    expect(hasTodayHtml(page)).toBe(true)
    const stream = withTodayHtml(page)
    if (typeof stream === 'string') throw new Error('not streamed')
    const reader = stream.getReader()
    // Before the MCP server has answered
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(before)
    answer(Response.json({ result: { content: [{ type: 'text', text: JSON.stringify(PROFILE) }] } }))
    expect(await rest(reader)).toBe(stationTodayHtml(PROFILE) + after)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      params: { name: 'get_day_profile', arguments: { station: ['MAN'], group_by: 'station', resolution: '5min' } },
    })
  })

  it("leaves the section out when the MCP server can't answer", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Bad gateway', { status: 502 })))
    const stream = withTodayHtml(page)
    if (typeof stream === 'string') throw new Error('not streamed')
    expect(await rest(stream.getReader())).toBe(before + after)
    expect(error).toHaveBeenCalledOnce()
  })

  it('leaves a page without the placeholder as it is, without asking', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const retired = '<h1>Ōtāhuhu</h1>\n<h2>Generation by year</h2>'
    expect(hasTodayHtml(retired)).toBe(false)
    expect(withTodayHtml(retired)).toBe(retired)
    expect(fetch).not.toHaveBeenCalled()
  })
})
