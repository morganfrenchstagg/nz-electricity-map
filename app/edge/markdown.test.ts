import { afterEach, describe, expect, it, vi } from 'vitest'
import { markdownPath, onRequest, prefersMarkdown } from './markdown'
import { todayHtmlPlaceholder, todayPlaceholder } from './today'

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

describe('markdownPath', () => {
  it("is a page's path with .md on the end", () => {
    expect(markdownPath('/')).toBe('/index.md')
    expect(markdownPath('/hvdc')).toBe('/hvdc.md')
    expect(markdownPath('/generator/huntly/historic')).toBe('/generator/huntly/historic.md')
  })

  it("is null for a path that isn't a page's", () => {
    expect(markdownPath('/hvdc/')).toBeNull()
    expect(markdownPath('/generator/huntly.md')).toBeNull()
    expect(markdownPath('/hvdc.html')).toBeNull()
  })
})

describe('prefersMarkdown', () => {
  it('is true for a client that names Markdown and likes it at least as well as HTML', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
    expect(prefersMarkdown('Text/Markdown; charset=utf-8')).toBe(true)
    expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true)
    expect(prefersMarkdown('text/html, text/markdown')).toBe(true)
    expect(prefersMarkdown('text/markdown;q=0.5, */*;q=0.1')).toBe(true)
    expect(prefersMarkdown('text/x-markdown')).toBe(true)
  })

  it('is false for browsers, wildcards and clients that like HTML better', () => {
    expect(prefersMarkdown(null)).toBe(false)
    expect(prefersMarkdown(BROWSER)).toBe(false)
    expect(prefersMarkdown('*/*')).toBe(false)
    expect(prefersMarkdown('text/*')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0.5, text/html')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0.5, */*')).toBe(false)
  })
})

describe('onRequest', () => {
  const MARKDOWN = '# HVDC Inter-Island Link\n\nFlows north and south.\n'
  const STATION = `# Manapōuri Power Station\n\n${todayPlaceholder('Its generation', { station: ['MAN'] })}\n`
  const HOME = `# NZ Electricity Map\n\n${todayPlaceholder("New Zealand's generation by fuel", { group_by: 'fuel' })}\n`
  const FILES: Record<string, string> = { '/hvdc.md': MARKDOWN, '/generator/manapouri.md': STATION, '/index.md': HOME }

  // Pages' static files: the Markdown, with its ETag and the Cache-Control from _headers
  const assets = {
    fetch: (request: Request) => {
      const { pathname } = new URL(request.url)
      const file = FILES[pathname]
      if (file === undefined) return Promise.resolve(new Response('Not found', { status: 404 }))
      const headers = {
        'Content-Type': 'text/markdown',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        ETag: '"md"',
      }
      if (request.headers.get('If-None-Match') === '"md"')
        return Promise.resolve(new Response(null, { status: 304, headers }))
      return Promise.resolve(new Response(file, { headers }))
    },
  }
  const html = (status = 200) =>
    new Response('<!doctype html>', {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', Vary: 'Accept-Encoding' },
    })

  function get(
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
    next: (request?: Request) => Response = () => html(),
  ) {
    const request = new Request(`https://electricitymap.frenchsta.gg${path}`, { method, headers })
    return onRequest({ request, next: (r) => Promise.resolve(next(r)), env: { ASSETS: assets } })
  }

  it('answers a request for Markdown with the Markdown', async () => {
    const response = await get('/hvdc', { Accept: 'text/markdown' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Vary')).toBe('Accept')
    expect(response.headers.get('X-Markdown-Tokens')).toBe(String(Math.ceil(MARKDOWN.length / 4)))
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    expect(response.headers.get('ETag')).toBe('"md"')
    expect(await response.text()).toBe(MARKDOWN)
  })

  it('answers a HEAD request with the Markdown headers and no body', async () => {
    const response = await get('/hvdc', { Accept: 'text/markdown' }, 'HEAD')
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('X-Markdown-Tokens')).not.toBeNull()
    expect(response.body).toBeNull()
  })

  it("answers a conditional request by the Markdown's ETag", async () => {
    const response = await get('/hvdc', { Accept: 'text/markdown', 'If-None-Match': '"md"' })
    expect(response.status).toBe(304)
    expect(response.headers.get('Vary')).toBe('Accept')
  })

  it('answers a browser with the HTML, varying on Accept', async () => {
    const response = await get('/hvdc', { Accept: BROWSER })
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Accept')
    expect(await response.text()).toBe('<!doctype html>')
  })

  it("falls back to the HTML for a path that has no Markdown, or a method that isn't a read", async () => {
    const missing = await get('/generator/nowhere', { Accept: 'text/markdown' }, 'GET', () => html(404))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    const post = await get('/hvdc', { Accept: 'text/markdown' }, 'POST')
    expect(post.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  describe("a station's page", () => {
    afterEach(() => vi.unstubAllGlobals())

    // The MCP server's day so far at Manapōuri
    function mcp() {
      const profile = {
        date: '2026-11-28',
        columns: ['period', 'Manapōuri'],
        rows: [['2026-11-28T00:00', 620]],
        summary: { Manapōuri: { peakMW: 620, peakAt: '2026-11-28T00:00', energyGWh: 0.0517 } },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(Response.json({ result: { content: [{ text: JSON.stringify(profile) }] } }))),
      )
    }

    it("has today's generation filled in, and no ETag, as it isn't the file", async () => {
      mcp()
      const response = await get('/generator/manapouri', { Accept: 'text/markdown', 'If-None-Match': '"md"' })
      expect(response.status).toBe(200)
      expect(response.headers.get('ETag')).toBeNull()
      const text = await response.text()
      expect(text).toContain('## Today\n\nSo far on 28 November 2026, in NZ time:\n\n- Generated: 51.7 MWh')
      expect(text).not.toContain('get_day_profile')
    })

    it("has the home page's today by fuel too", async () => {
      const profile = {
        date: '2026-11-28',
        columns: ['period', 'Hydro', 'total'],
        rows: [['2026-11-28T00:00', 3000, 3000]],
        summary: {
          Hydro: { peakMW: 3000, peakAt: '2026-11-28T00:00', energyGWh: 0.25 },
          total: { peakMW: 3000, peakAt: '2026-11-28T00:00', energyGWh: 0.25 },
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(Response.json({ result: { content: [{ text: JSON.stringify(profile) }] } }))),
      )
      const response = await get('/', { Accept: 'text/markdown' })
      expect(response.headers.get('ETag')).toBeNull()
      expect(await response.text()).toContain('| Hydro | 250 | 100% | 3,000 | 00:00 | 3,000 |')
    })

    it('has it at its .md too, whatever the Accept header', async () => {
      mcp()
      const response = await get('/generator/manapouri.md', { Accept: '*/*' })
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
      expect(await response.text()).toContain('- Peak: 620 MW at 00:00')
    })
  })

  describe("a station's HTML", () => {
    afterEach(() => vi.unstubAllGlobals())

    const PAGE = `<!doctype html><h1>Manapōuri Power Station</h1>\n${todayHtmlPlaceholder('MAN')}\n<h2>Generation by year</h2>`
    const RETIRED = '<!doctype html><h1>Ōtāhuhu Power Station</h1>\n<h2>Generation by year</h2>'

    // The page's file, with its ETag, as Pages serves it
    const file = (body: string) => (request?: Request) => {
      if (request && request.method !== 'GET') throw new Error(`asked for the file with ${request.method}`)
      return new Response(body, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(new TextEncoder().encode(body).length),
          ETag: '"html"',
          Vary: 'Accept-Encoding',
        },
      })
    }

    function mcp() {
      const profile = {
        date: '2026-11-28',
        columns: ['period', 'Manapōuri'],
        rows: [['2026-11-28T00:00', 620]],
        summary: { Manapōuri: { peakMW: 620, peakAt: '2026-11-28T00:00', energyGWh: 0.0517 } },
      }
      const fetch = vi.fn(() =>
        Promise.resolve(Response.json({ result: { content: [{ text: JSON.stringify(profile) }] } })),
      )
      vi.stubGlobal('fetch', fetch)
      return fetch
    }

    it("has today's generation filled in, and no ETag or length, as it isn't the file", async () => {
      mcp()
      const response = await get('/generator/manapouri', { Accept: BROWSER }, 'GET', file(PAGE))
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('Vary')).toBe('Accept-Encoding, Accept')
      expect(response.headers.get('ETag')).toBeNull()
      expect(response.headers.get('Content-Length')).toBeNull()
      const text = await response.text()
      expect(text).toContain('<h2>Today</h2>\n<p>So far on 28 November 2026, in NZ time:</p>')
      expect(text).toContain('<dt>Generated</dt><dd>51.7 MWh</dd>')
      expect(text).toContain('<h1>Manapōuri Power Station</h1>\n<h2>Today</h2>')
      expect(text).toContain('</table></div>\n<h2>Generation by year</h2>')
      expect(text).not.toContain('<!--today')
    })

    it('answers a HEAD request with the headers a GET gets, without asking for the day', async () => {
      const fetch = mcp()
      const response = await get('/generator/manapouri', { Accept: BROWSER }, 'HEAD', file(PAGE))
      expect(response.status).toBe(200)
      expect(response.headers.get('ETag')).toBeNull()
      expect(response.body).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })

    it("leaves a retired station's page, which has nothing to fill in, as the file", async () => {
      const fetch = mcp()
      const response = await get('/generator/otahuhu', { Accept: BROWSER }, 'GET', file(RETIRED))
      expect(response.headers.get('ETag')).toBe('"html"')
      expect(await response.text()).toBe(RETIRED)
      expect(fetch).not.toHaveBeenCalled()
    })

    it("passes on a 304 or a 404 as it is, and leaves a station's history alone", async () => {
      const notModified = await get(
        '/generator/otahuhu',
        { 'If-None-Match': '"html"' },
        'GET',
        () => new Response(null, { status: 304, headers: { ETag: '"html"' } }),
      )
      expect(notModified.status).toBe(304)
      expect(notModified.headers.get('Vary')).toBe('Accept')
      const missing = await get('/generator/nowhere', { Accept: BROWSER }, 'GET', () => html(404))
      expect(missing.status).toBe(404)
      const history = await get('/generator/manapouri/historic', { Accept: BROWSER }, 'GET', file(PAGE))
      expect(history.headers.get('ETag')).toBe('"html"')
      expect(await history.text()).toBe(PAGE)
    })
  })
})
