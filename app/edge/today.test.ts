import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayMarkdown, todayPlaceholder, withToday } from './today'
import type { DayProfile } from './today'

const PROFILE: DayProfile = {
  date: '2026-11-28',
  columns: ['period', 'Manapōuri'],
  rows: [
    ['2026-11-28T00:00', 600],
    ['2026-11-28T00:05', 610],
    ['2026-11-28T00:25', 620],
    ['2026-11-28T00:30', 700],
    ['2026-11-28T00:35', 715.25],
  ],
  summary: { Manapōuri: { peakMW: 715.25, peakAt: '2026-11-28T00:35', energyGWh: 0.4321 } },
}

describe('todayMarkdown', () => {
  it("gives the energy so far, the peak and when it was, the latest reading, and each half hour's mean", () => {
    expect(todayMarkdown(PROFILE)).toBe(
      [
        '## Today',
        'So far on 28 November 2026, in NZ time:',
        '- Generated: 432.1 MWh\n- Peak: 715.3 MW at 00:35\n- Latest: 715.3 MW at 00:35',
        '| Half hour | Mean generation (MW) |\n| --- | ---: |\n| 00:00 | 610 |\n| 00:30 | 707.6 |',
      ].join('\n\n'),
    )
  })

  it('gives the energy to the MWh, as the API does, and a little as under 1', () => {
    const little = {
      ...PROFILE,
      rows: [['2026-11-28T00:00', 0.3]],
      summary: { Manapōuri: { ...PROFILE.summary.Manapōuri, energyGWh: 0 } },
    }
    expect(todayMarkdown(little)).toContain('- Generated: under 1 MWh\n')
  })

  it("says so when a station hasn't generated today", () => {
    expect(todayMarkdown({ ...PROFILE, columns: ['period'], rows: [['2026-11-28T00:00']], summary: {} })).toBe(
      "## Today\n\nIt hasn't generated so far today, 28 November 2026 (NZ time).",
    )
  })
})

describe('withToday', () => {
  const page = `# Manapōuri Power Station\n\n${todayPlaceholder('MAN')}\n\n## Generation by year\n`

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
    expect(filled).toBe(`# Manapōuri Power Station\n\n${todayMarkdown(PROFILE)}\n\n## Generation by year\n`)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.electricitymap.frenchsta.gg/mcp')
    expect(JSON.parse(init.body as string)).toMatchObject({
      method: 'tools/call',
      params: { name: 'get_day_profile', arguments: { station: ['MAN'], group_by: 'station', resolution: '5min' } },
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
