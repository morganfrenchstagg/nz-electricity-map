import { FOOTER, ORIGIN } from './html'
import type { Page } from './html'

// Each page as Markdown, for AI agents that ask for it (see edge/markdown.ts):
// its title, description and address as front matter, then its content and
// footer, converted from the HTML the build writes for them. That HTML is the
// build's own, from a few tags (see html.ts), so a converter for those does.
// The site's header and the breadcrumbs are left out, as are the charts, whose
// tables carry every figure, and their keys.

interface Element {
  tag: string
  attrs: string
  children: Node[]
}
type Node = Element | string

const SKIPPED_CLASSES = ['prerender__crumbs', 'prerender__chart', 'prerender__key']
const SKIPPED_TAGS = new Set(['header', 'script', 'style', 'svg', 'summary'])
const INLINE_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'span', 'br', 'code'])
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'wbr'])

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity
    return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
  })
}

// Comments, tags, and the text between them
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/gi

function parse(html: string): Node[] {
  const root: Element = { tag: '', attrs: '', children: [] }
  const open = [root]
  for (const [, closing, name, attrs, selfClosing, text] of html.matchAll(TOKEN)) {
    const parent = open[open.length - 1]
    if (text !== undefined) parent.children.push(decode(text))
    else if (!name) continue
    else if (closing) {
      const i = open.findLastIndex((e) => e.tag === name.toLowerCase())
      if (i > 0) open.length = i
    } else {
      const element: Element = { tag: name.toLowerCase(), attrs, children: [] }
      parent.children.push(element)
      if (!selfClosing && !VOID_TAGS.has(element.tag)) open.push(element)
    }
  }
  return root.children
}

function attr(element: Element, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(element.attrs)
  return match ? decode(match[1]) : ''
}

function skipped(element: Element): boolean {
  const classes = attr(element, 'class').split(/\s+/)
  return SKIPPED_TAGS.has(element.tag) || SKIPPED_CLASSES.some((c) => classes.includes(c))
}

function isElement(node: Node): node is Element {
  return typeof node !== 'string'
}

// Text that Markdown would otherwise take for emphasis, a link or code. An
// underscore inside a word, as in a unit's code (te_awamutu), can't be emphasis.
function escapeText(text: string): string {
  return text.replace(/[\\`*[\]]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\$&')
}

function inline(nodes: Node[]): string {
  return nodes
    .map((node) => (isElement(node) ? inlineElement(node) : escapeText(node)))
    .join('')
    .replace(/\s+/g, ' ')
}

function inlineElement(element: Element): string {
  if (skipped(element)) return ''
  const text = inline(element.children).trim()
  switch (element.tag) {
    case 'a': {
      const href = attr(element, 'href')
      // As the page has it: a site's path is short, and the front matter's url
      // is what it's relative to
      return href && text ? `[${text}](${href})` : text
    }
    case 'b':
    case 'strong':
      return text && `**${text}**`
    case 'br':
      return ' '
    default:
      return inline(element.children)
  }
}

function descendants(element: Element, tag: string): Element[] {
  return element.children.filter(isElement).flatMap((child) => (child.tag === tag ? [child] : descendants(child, tag)))
}

function tableMarkdown(table: Element): string {
  const rows = descendants(table, 'tr').map((tr) => tr.children.filter(isElement).filter((c) => /^t[hd]$/.test(c.tag)))
  if (rows.length === 0) return ''
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  const text = (cell: Element) => inline(cell.children).trim().replace(/\|/g, '\\|')
  // Figures' columns right-aligned, as the page has them
  const align = rows[0].map((cell) => (/(?:^|\s)num(?:\s|$)/.test(attr(cell, 'class')) ? '---:' : '---'))
  return [line(rows[0].map(text)), line(align), ...rows.slice(1).map((cells) => line(cells.map(text)))].join('\n')
}

function block(element: Element): string[] {
  if (skipped(element)) return []
  switch (element.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4': {
      const text = inline(element.children).trim()
      return text ? [`${'#'.repeat(Number(element.tag[1]))} ${text}`] : []
    }
    case 'p': {
      const text = inline(element.children).trim()
      return text ? [text] : []
    }
    case 'ul':
    case 'ol': {
      const items = element.children
        .filter(isElement)
        .filter((li) => li.tag === 'li')
        .map((li, i) => `${element.tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li.children).trim()}`)
      return items.length ? [items.join('\n')] : []
    }
    case 'dl': {
      // Each term with its definition: "- **Operator:** Genesis Energy"
      const items: string[] = []
      let term = ''
      for (const child of element.children.filter(isElement)) {
        if (child.tag === 'dt') term = inline(child.children).trim()
        else if (child.tag === 'dd') items.push(`- **${term}:** ${inline(child.children).trim()}`)
      }
      return items.length ? [items.join('\n')] : []
    }
    case 'table': {
      const table = tableMarkdown(element)
      return table ? [table] : []
    }
    default:
      return blocks(element.children)
  }
}

// Blocks, and the inline content between them, each a paragraph
function blocks(nodes: Node[]): string[] {
  const out: string[] = []
  let run: Node[] = []
  const endRun = () => {
    const text = inline(run).trim()
    if (text) out.push(text)
    run = []
  }
  for (const node of nodes) {
    if (!isElement(node) || INLINE_TAGS.has(node.tag)) {
      run.push(node)
      continue
    }
    endRun()
    out.push(...block(node))
  }
  endRun()
  return out
}

export function htmlToMarkdown(html: string): string {
  return blocks(parse(html)).join('\n\n')
}

export function pageMarkdown(page: Page): string {
  // JSON's strings are YAML's double-quoted strings
  const frontMatter = [
    '---',
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    `url: ${JSON.stringify(ORIGIN + page.path)}`,
    '---',
  ].join('\n')
  return `${frontMatter}\n\n${htmlToMarkdown(`${page.body}\n${FOOTER}`)}\n`
}
