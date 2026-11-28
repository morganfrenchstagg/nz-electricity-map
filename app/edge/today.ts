// Generation so far today, in a page's Markdown: a station's on its page, and
// the grid's by fuel on the home page. The build writes a Today section with
// where to get it (todayPlaceholder), naming get_day_profile's arguments, and
// markdown.ts fills it in from the API's MCP server as it serves the page: the
// energy so far, the peak and when it was, the latest reading, and a station's
// every 5 minutes, or the grid's each half hour's mean. If the API can't be
// reached, the placeholder stays.
//
// A station's page's HTML has it too, in place of a comment the build writes
// (todayHtmlPlaceholder), with its latest hour's readings and the rest behind a
// toggle. If the API can't be reached, the page goes without it.

import { esc, table } from '../build/html'

const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
// How long the figures are kept, in seconds. The dispatch is every 5 minutes.
const CACHE_SECONDS = 60
const TIMEOUT_MS = 5000
// A page's scripts run once all its HTML has come, so it waits on the server for less
const HTML_TIMEOUT_MS = 2000
// The readings a station's HTML shows before its toggle for the rest: its latest hour's
const RECENT_READINGS = 12

// A station's, by its site code, or the grid's split by fuel
export type TodayArgs = { station: string[] } | { group_by: 'fuel' }

// `subject`: "Its generation", "New Zealand's generation by fuel"
export function todayPlaceholder(subject: string, args: TodayArgs): string {
  return `## Today\n\n${subject} so far today, every 5 minutes: the MCP tool \`get_day_profile\` with \`${JSON.stringify(args)}\`.`
}

// The placeholder, and the arguments it names
const PLACEHOLDER = /^## Today\n\n.*`get_day_profile` with `(\{[^`]*\})`\.$/m

// Where a station's page's HTML has its Today section: a comment, so the page
// shows nothing there until it's filled in
export function todayHtmlPlaceholder(site: string): string {
  return `<!--today ${JSON.stringify({ station: [site] })}-->`
}

const HTML_PLACEHOLDER = /<!--today (\{[^>]*\})-->/

export function hasTodayHtml(html: string): boolean {
  return HTML_PLACEHOLDER.test(html)
}

interface Summary {
  peakMW: number
  peakAt: string
  energyGWh: number
}

// What get_day_profile answers: a row each 5 minutes of the time (NZ,
// YYYY-MM-DDTHH:MM) and each group's MW, and each group's summary. Grouped by
// fuel, its last column and summary are the total.
export interface DayProfile {
  date: string
  columns: string[]
  rows: (string | number | null)[][]
  summary: Record<string, Summary>
}

function figure(n: number): string {
  return n.toLocaleString('en-NZ', { maximumFractionDigits: 1 })
}

// "13:05", from "2026-11-28T13:05"
function time(period: string): string {
  return period.slice(11, 16)
}

// "28 November 2026"
function dayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Each half hour, by when it starts, with each column's mean of its 5-minute
// readings, or null where it has none
function halfHours(rows: DayProfile['rows'], columns: number): [string, (number | null)[]][] {
  const starts = new Map<string, number[][]>()
  for (const row of rows) {
    const period = String(row[0])
    const start = `${period.slice(11, 14)}${Number(period.slice(14, 16)) < 30 ? '00' : '30'}`
    const mws = row.slice(1, columns + 1).map((mw) => (typeof mw === 'number' ? mw : NaN))
    starts.set(start, [...(starts.get(start) ?? []), mws])
  }
  return [...starts].map(([start, readings]) => [
    start,
    Array.from({ length: columns }, (_, i) => {
      const mws = readings.map((r) => r[i]).filter((mw) => !Number.isNaN(mw))
      return mws.length ? mws.reduce((sum, mw) => sum + mw, 0) / mws.length : null
    }),
  ])
}

function tableMarkdown(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(head), line(head.map((_, i) => (i === 0 ? '---' : '---:'))), ...rows.map(line)].join('\n')
}

// A station's day: its energy, peak and latest reading, and every 5 minutes'
// time and MW, with a dash for one it has no reading for. Null if it hasn't
// generated today.
function stationDay(profile: DayProfile): { facts: [string, string][]; readings: [string, string][] } | null {
  const station = profile.columns[1]
  const summary = station === undefined ? undefined : profile.summary[station]
  const readings = profile.rows.filter((row): row is [string, number] => typeof row[1] === 'number')
  if (!summary || readings.length === 0) return null
  const [latestAt, latest] = readings[readings.length - 1]
  // The API gives the energy to the MWh
  const mwh = summary.energyGWh * 1000
  const energy = mwh < 0.5 && readings.some(([, mw]) => mw > 0) ? 'under 1' : figure(mwh)
  return {
    facts: [
      ['Generated', `${energy} MWh`],
      ['Peak', `${figure(summary.peakMW)} MW at ${time(summary.peakAt)}`],
      ['Latest', `${figure(latest)} MW at ${time(latestAt)}`],
    ],
    readings: profile.rows.map(([period, mw]) => [time(String(period)), typeof mw === 'number' ? figure(mw) : '–']),
  }
}

export function stationToday(profile: DayProfile): string {
  const day = dayName(profile.date)
  const station = stationDay(profile)
  if (!station) return `## Today\n\nIt hasn't generated so far today, ${day} (NZ time).`
  return [
    '## Today',
    `So far on ${day}, in NZ time:`,
    station.facts.map(([name, value]) => `- ${name}: ${value}`).join('\n'),
    tableMarkdown(['Time', 'Generation (MW)'], station.readings),
  ].join('\n\n')
}

// The same, in a station's page's HTML, its readings newest first, as the
// page's other tables are, and those before the latest hour behind a toggle
export function stationTodayHtml(profile: DayProfile): string {
  const day = esc(dayName(profile.date))
  const station = stationDay(profile)
  if (!station) return `<h2>Today</h2>\n<p>It hasn't generated so far today, ${day} (NZ time).</p>`
  const rows = station.readings.map((cells) => cells.map(esc)).reverse()
  const head = ['Time', 'Generation (MW)']
  const readings =
    rows.length <= RECENT_READINGS + 2
      ? table(head, rows, 1)
      : table(head, rows.slice(0, RECENT_READINGS), 1, {
          label: `Earlier today, ${rows[rows.length - 1][0]}–${rows[RECENT_READINGS][0]}`,
          rows: rows.slice(RECENT_READINGS),
        })
  return `<h2>Today</h2>
<p>So far on ${day}, in NZ time:</p>
<dl class="prerender__facts">${station.facts.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
${readings}`
}

// The grid's day, a group (fuel) at a time and in total: each one's energy and
// share of it, peak and latest reading, and its half hours
export function groupsToday(profile: DayProfile, group: string): string {
  const day = dayName(profile.date)
  const groups = profile.columns.slice(1)
  const readings = profile.rows.filter((row) => row.slice(1).some((mw) => typeof mw === 'number'))
  const total = profile.summary.total
  if (groups.length === 0 || readings.length === 0 || !total)
    return `## Today\n\nNo generation is on record so far today, ${day} (NZ time).`
  const latest = readings[readings.length - 1]
  const name = (g: string) => (g === 'total' ? 'Total' : g)
  const summaries = groups.map((g, i) => {
    const { energyGWh, peakMW, peakAt } = profile.summary[g]
    const now = latest[i + 1]
    return [
      name(g),
      figure(energyGWh * 1000),
      `${figure((energyGWh / total.energyGWh) * 100)}%`,
      figure(peakMW),
      time(peakAt),
      typeof now === 'number' ? figure(now) : '–',
    ]
  })
  return [
    '## Today',
    `So far on ${day}, in NZ time, with the latest readings at ${time(String(latest[0]))}:`,
    tableMarkdown([group, 'Generated (MWh)', 'Share', 'Peak (MW)', 'Peak at', 'Latest (MW)'], summaries),
    tableMarkdown(
      ['Half hour (mean MW)', ...groups.map(name)],
      halfHours(readings, groups.length).map(([start, mws]) => [
        start,
        ...mws.map((mw) => (mw === null ? '–' : figure(mw))),
      ]),
    ),
  ].join('\n\n')
}

async function dayProfile(args: TodayArgs, timeoutMs: number): Promise<DayProfile> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_day_profile',
        arguments: { ...('station' in args ? { ...args, group_by: 'station' } : args), resolution: '5min' },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`the MCP server answered ${response.status}`)
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } }
  const text = body.result?.content?.[0]?.text
  if (!text || body.result?.isError) throw new Error(`get_day_profile failed: ${text ?? JSON.stringify(body)}`)
  return JSON.parse(text) as DayProfile
}

// The day so far, kept for a minute in the Cache API where there is one (not
// under Node, in the tests), for a page's Markdown and its HTML alike
async function today(args: TodayArgs, timeoutMs: number): Promise<DayProfile> {
  const cache = typeof caches === 'undefined' ? null : await caches.open('today')
  const key = `https://electricitymap.frenchsta.gg/today/profile/${encodeURIComponent(JSON.stringify(args))}`
  const cached = await cache?.match(key)
  if (cached) return (await cached.json()) as DayProfile
  const profile = await dayProfile(args, timeoutMs)
  await cache?.put(key, Response.json(profile, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } }))
  return profile
}

// The Markdown with its Today section filled in. As it is if it has none, or
// if the API can't be reached, when its placeholder says where to get them.
export async function withToday(markdown: string): Promise<string> {
  const match = PLACEHOLDER.exec(markdown)
  if (!match) return markdown
  try {
    const args = JSON.parse(match[1]) as TodayArgs
    const profile = await today(args, TIMEOUT_MS)
    const section = 'station' in args ? stationToday(profile) : groupsToday(profile, 'Fuel')
    return markdown.replace(match[0], () => section)
  } catch (error) {
    console.error(`Today's generation for ${match[1]}:`, error)
    return markdown
  }
}

// A station's page's HTML with its Today section filled in, as a stream: the
// HTML before the section goes at once, so the browser fetches the page's
// styles and scripts while the section waits on the MCP server. If the server
// can't answer in time, the page goes without it. The HTML as it is if it has
// no placeholder.
export function withTodayHtml(html: string): ReadableStream<Uint8Array> | string {
  const match = HTML_PLACEHOLDER.exec(html)
  if (!match) return html
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(html.slice(0, match.index)))
      let section = ''
      try {
        section = stationTodayHtml(await today(JSON.parse(match[1]) as TodayArgs, HTML_TIMEOUT_MS))
      } catch (error) {
        console.error(`Today's generation for ${match[1]}:`, error)
      }
      controller.enqueue(encoder.encode(section + html.slice(match.index + match[0].length)))
      controller.close()
    },
  })
}
