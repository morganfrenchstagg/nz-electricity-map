// Markdown for agents that ask for it
// (https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/).
// The build writes each page's Markdown beside its HTML, at its path with .md
// on the end (see build/markdown.ts). This Pages Functions middleware
// (functions/_middleware.ts) serves it at the page's own address to a request
// whose Accept header prefers text/markdown. Browsers, which don't name
// Markdown, get the HTML as before. frontend/_routes.json runs it for the
// pages' paths only, so their assets are served without it. The home page and
// a station's, asked for either way or at their .md, have generation so far
// today filled in (see today.ts).

import { withToday } from './today'

interface PagesContext {
  request: Request
  next: () => Promise<Response>
  env: { ASSETS: { fetch: (request: Request) => Promise<Response> } }
}

// Where a page's Markdown is: /index.md for the home page, /hvdc.md for /hvdc.
// Null for a path with a trailing slash or an extension, which Pages redirects
// or serves as a file. No page's path has a dot (see slugify).
export function markdownPath(path: string): string | null {
  if (path === '/') return '/index.md'
  if (path.endsWith('/') || /\.[^/]*$/.test(path)) return null
  return `${path}.md`
}

interface MediaRange {
  type: string
  subtype: string
  q: number
}

function parseAccept(accept: string): MediaRange[] {
  return accept.split(',').flatMap((part) => {
    const [mediaType, ...params] = part.split(';')
    const [type, subtype] = mediaType.trim().toLowerCase().split('/')
    if (!type || !subtype) return []
    const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='))
    const value = q === undefined ? 1 : Number(q.slice(2))
    return [{ type, subtype, q: Number.isNaN(value) ? 1 : Math.min(Math.max(value, 0), 1) }]
  })
}

// The quality the client gives a type, from the most specific range that matches it
function quality(ranges: MediaRange[], type: string, subtype: string): number {
  const matching = [
    ranges.filter((r) => r.type === type && r.subtype === subtype),
    ranges.filter((r) => r.type === type && r.subtype === '*'),
    ranges.filter((r) => r.type === '*' && r.subtype === '*'),
  ].find((rs) => rs.length > 0)
  return matching ? Math.max(...matching.map((r) => r.q)) : 0
}

// Whether a client names Markdown and likes it at least as well as HTML. A
// wildcard alone doesn't count: browsers send */* and mean HTML.
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const ranges = parseAccept(accept)
  const markdown = Math.max(
    0,
    ...ranges
      .filter((r) => r.type === 'text' && (r.subtype === 'markdown' || r.subtype === 'x-markdown'))
      .map((r) => r.q),
  )
  return markdown > 0 && markdown >= quality(ranges, 'text', 'html')
}

// Caches keep the HTML and the Markdown apart
function varyOnAccept(response: Response): Response {
  const copy = new Response(response.body, response)
  const vary = (copy.headers.get('Vary') ?? '').split(',').map((v) => v.trim().toLowerCase())
  if (!vary.includes('accept') && !vary.includes('*')) copy.headers.append('Vary', 'Accept')
  return copy
}

// A rough count of its tokens, as Cloudflare estimates them: a token every 4 bytes
function tokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4)
}

// The pages that have today's generation filled in: the home page's, by fuel,
// and a station's, /generator/huntly.md
const LIVE_PAGE = /^\/(index|generator\/[^/]+)\.md$/

async function markdownResponse(request: Request, path: string, assets: PagesContext['env']['ASSETS']) {
  // Always a GET, so a HEAD request gets its token count too. The request's
  // headers go with it, so a conditional request is answered by the file's
  // ETag, but for a page with today's generation, which isn't the file once it's filled in
  const live = LIVE_PAGE.test(path)
  const headers = new Headers(request.headers)
  if (live) for (const name of ['If-None-Match', 'If-Modified-Since']) headers.delete(name)
  const file = await assets.fetch(new Request(new URL(path, request.url), { headers }))
  if (file.status === 304) return varyOnAccept(file)
  if (!file.ok) return null
  const text = live ? await withToday(await file.text()) : await file.text()
  // The file's own headers, from _headers, but for those that described its
  // body as it came, which the new response works out for itself
  const responseHeaders = new Headers(file.headers)
  responseHeaders.delete('Content-Length')
  responseHeaders.delete('Content-Encoding')
  if (live) for (const name of ['ETag', 'Last-Modified']) responseHeaders.delete(name)
  responseHeaders.set('Content-Type', 'text/markdown; charset=utf-8')
  responseHeaders.set('X-Markdown-Tokens', String(tokens(text)))
  return varyOnAccept(new Response(request.method === 'HEAD' ? null : text, { status: 200, headers: responseHeaders }))
}

export async function onRequest({ request, next, env }: PagesContext): Promise<Response> {
  const { pathname } = new URL(request.url)
  // A page's .md, or the page itself for a client that prefers Markdown
  const path =
    request.method !== 'GET' && request.method !== 'HEAD'
      ? null
      : pathname.endsWith('.md')
        ? pathname
        : prefersMarkdown(request.headers.get('Accept'))
          ? markdownPath(pathname)
          : null
  if (path) {
    // A path that isn't a page's has no Markdown, and gets the HTML's 404
    const markdown = await markdownResponse(request, path, env.ASSETS)
    if (markdown) return markdown
  }
  return varyOnAccept(await next())
}
