// Generation so far today, in a page's Markdown: a station's on its page, and
// the grid's by fuel on the home page. The build writes a Today section with
// where to get it (todayPlaceholder), naming get_day_profile's arguments, and
// markdown.ts fills it in from the API's MCP server as it serves the page: the
// energy so far, the peak and when it was, the latest reading, and each half
// hour's mean. If the API can't be reached, the placeholder stays.

const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
// How long the figures are kept, in seconds. The dispatch is every 5 minutes.
const CACHE_SECONDS = 60
const TIMEOUT_MS = 5000

// A station's, by its site code, or the grid's split by fuel
export type TodayArgs = { station: string[] } | { group_by: 'fuel' }

// `subject`: "Its generation", "New Zealand's generation by fuel"
export function todayPlaceholder(subject: string, args: TodayArgs): string {
  return `## Today\n\n${subject} so far today, every 5 minutes: the MCP tool \`get_day_profile\` with \`${JSON.stringify(args)}\`.`
}

// The placeholder, and the arguments it names
const PLACEHOLDER = /^## Today\n\n.*`get_day_profile` with `(\{[^`]*\})`\.$/m

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

// A station's day: its energy, peak and latest reading, and its half hours
export function stationToday(profile: DayProfile): string {
  const day = dayName(profile.date)
  const station = profile.columns[1]
  const summary = station === undefined ? undefined : profile.summary[station]
  const readings = profile.rows.filter((row): row is [string, number] => typeof row[1] === 'number')
  if (!summary || readings.length === 0) return `## Today\n\nIt hasn't generated so far today, ${day} (NZ time).`
  const [latestAt, latest] = readings[readings.length - 1]
  // The API gives the energy to the MWh
  const mwh = summary.energyGWh * 1000
  const energy = mwh < 0.5 && readings.some(([, mw]) => mw > 0) ? 'under 1' : figure(mwh)
  return [
    '## Today',
    `So far on ${day}, in NZ time:`,
    [
      `- Generated: ${energy} MWh`,
      `- Peak: ${figure(summary.peakMW)} MW at ${time(summary.peakAt)}`,
      `- Latest: ${figure(latest)} MW at ${time(latestAt)}`,
    ].join('\n'),
    tableMarkdown(
      ['Half hour', 'Mean generation (MW)'],
      halfHours(readings, 1).map(([start, [mw]]) => [start, mw === null ? '–' : figure(mw)]),
    ),
  ].join('\n\n')
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

async function dayProfile(args: TodayArgs): Promise<DayProfile> {
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the MCP server answered ${response.status}`)
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } }
  const text = body.result?.content?.[0]?.text
  if (!text || body.result?.isError) throw new Error(`get_day_profile failed: ${text ?? JSON.stringify(body)}`)
  return JSON.parse(text) as DayProfile
}

// The Today section, kept for a minute in the Cache API where there is one (not
// under Node, in the tests)
async function today(args: TodayArgs): Promise<string> {
  const cache = typeof caches === 'undefined' ? null : await caches.open('today')
  const key = `https://electricitymap.frenchsta.gg/today/${encodeURIComponent(JSON.stringify(args))}`
  const cached = await cache?.match(key)
  if (cached) return cached.text()
  const profile = await dayProfile(args)
  const section = 'station' in args ? stationToday(profile) : groupsToday(profile, 'Fuel')
  await cache?.put(key, new Response(section, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } }))
  return section
}

// The Markdown with its Today section filled in. As it is if it has none, or
// if the API can't be reached, when its placeholder says where to get them.
export async function withToday(markdown: string): Promise<string> {
  const match = PLACEHOLDER.exec(markdown)
  if (!match) return markdown
  try {
    const section = await today(JSON.parse(match[1]) as TodayArgs)
    return markdown.replace(match[0], () => section)
  } catch (error) {
    console.error(`Today's generation for ${match[1]}:`, error)
    return markdown
  }
}
