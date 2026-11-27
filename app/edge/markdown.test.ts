import { describe, expect, it } from 'vitest'
import { markdownPath, onRequest, prefersMarkdown } from './markdown'

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

  // Pages' static files: the Markdown, with its ETag and the Cache-Control from _headers
  const assets = {
    fetch: (request: Request) => {
      const { pathname } = new URL(request.url)
      if (pathname !== '/hvdc.md') return Promise.resolve(new Response('Not found', { status: 404 }))
      const headers = {
        'Content-Type': 'text/markdown',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        ETag: '"md"',
      }
      if (request.headers.get('If-None-Match') === '"md"')
        return Promise.resolve(new Response(null, { status: 304, headers }))
      return Promise.resolve(new Response(MARKDOWN, { headers }))
    },
  }
  const html = (status = 200) =>
    new Response('<!doctype html>', {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', Vary: 'Accept-Encoding' },
    })

  function get(path: string, headers: Record<string, string> = {}, method = 'GET', next = () => html()) {
    const request = new Request(`https://electricitymap.frenchsta.gg${path}`, { method, headers })
    return onRequest({ request, next: () => Promise.resolve(next()), env: { ASSETS: assets } })
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
})
