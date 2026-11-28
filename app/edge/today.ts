// A station's generation so far today, in its page's Markdown. The build
// writes a Today section with where to get it (todayPlaceholder), naming the
// station's site code, and markdown.ts fills it in from the API's MCP server
// (get_day_profile) as it serves the page: each half hour's mean, the energy
// so far, the peak and when it was, and the latest reading. If the API can't be
// reached, the placeholder stays.

const MCP_URL = 'https://api.electricitymap.frenchsta.gg/mcp'
// How long a station's figures are kept, in seconds. The dispatch is every 5 minutes.
const CACHE_SECONDS = 60
const TIMEOUT_MS = 5000

export function todayPlaceholder(site: string): string {
  return `## Today\n\nIts generation so far today, every 5 minutes: the MCP tool \`get_day_profile\` with \`${JSON.stringify({ station: [site] })}\`.`
}

// The placeholder, and the site code it names
const PLACEHOLDER = /^## Today\n\n.*`\{"station":\["([^"]+)"\]\}`.*$/m

interface Summary {
  peakMW: number
  peakAt: string
  energyGWh: number
}

// What get_day_profile answers, grouped by station: a row each 5 minutes of
// the time (NZ, YYYY-MM-DDTHH:MM) and the station's MW
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

export function todayMarkdown(profile: DayProfile): string {
  const day = new Date(`${profile.date}T12:00:00Z`).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const station = profile.columns[1]
  const summary = station === undefined ? undefined : profile.summary[station]
  const readings = profile.rows.filter((row): row is [string, number] => typeof row[1] === 'number')
  if (!summary || readings.length === 0) return `## Today\n\nIt hasn't generated so far today, ${day} (NZ time).`

  // Each half hour's 5-minute readings, by when it starts
  const halfHours = new Map<string, number[]>()
  for (const [period, mw] of readings) {
    const start = `${period.slice(11, 14)}${Number(period.slice(14, 16)) < 30 ? '00' : '30'}`
    halfHours.set(start, [...(halfHours.get(start) ?? []), mw])
  }
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
    [
      '| Half hour | Mean generation (MW) |',
      '| --- | ---: |',
      ...[...halfHours].map(
        ([start, mws]) => `| ${start} | ${figure(mws.reduce((sum, mw) => sum + mw, 0) / mws.length)} |`,
      ),
    ].join('\n'),
  ].join('\n\n')
}

async function dayProfile(site: string): Promise<DayProfile> {
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
      params: { name: 'get_day_profile', arguments: { station: [site], group_by: 'station', resolution: '5min' } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the MCP server answered ${response.status}`)
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } }
  const text = body.result?.content?.[0]?.text
  if (!text || body.result?.isError) throw new Error(`get_day_profile failed: ${text ?? JSON.stringify(body)}`)
  return JSON.parse(text) as DayProfile
}

// The station's Today section, kept for a minute in the Cache API where there
// is one (not under Node, in the tests)
async function today(site: string): Promise<string> {
  const cache = typeof caches === 'undefined' ? null : await caches.open('today')
  const key = `https://electricitymap.frenchsta.gg/today/${encodeURIComponent(site)}`
  const cached = await cache?.match(key)
  if (cached) return cached.text()
  const section = todayMarkdown(await dayProfile(site))
  await cache?.put(key, new Response(section, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } }))
  return section
}

// The Markdown with its Today section filled in. As it is if it has none, or
// if the API can't be reached, when its placeholder says where to get them.
export async function withToday(markdown: string): Promise<string> {
  const match = PLACEHOLDER.exec(markdown)
  if (!match) return markdown
  try {
    const section = await today(match[1])
    return markdown.replace(match[0], () => section)
  } catch (error) {
    console.error(`Today's generation at ${match[1]}:`, error)
    return markdown
  }
}
