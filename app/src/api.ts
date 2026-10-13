import type { Generator, RecentData, Substation } from './types'
import { nzLocalMs, nzNowMs } from './utils/time'

// Every API request belongs here. Freshness follows each response's max-age, so
// this cache agrees with the browser's HTTP cache instead of keeping its own
// copy of how long each endpoint lasts.
const API_BASE = 'https://api.electricitymap.frenchsta.gg/v1'

const DISPATCH_INTERVAL_MS = 5 * 60 * 1000
const MINUTE_MS = 60 * 1000

export interface DefinitionsResponse {
  generators: Generator[]
  substations: Substation[]
}

export interface Offer {
  tranche: number
  megawatts: number
  price: number
}

export interface OffersData {
  date: string
  data: Record<string, Record<string, Offer[]>>
}

export interface OutageRecord {
  outageBlock: string
  timeStart: string
  timeEnd: string
  mwattLost: number
}

export type OutageData = Record<string, OutageRecord[]>

export interface AggregateResponse {
  series: string[]
  data: (string | number)[][]
}

// Loaded by maplibre as a GeoJSON source rather than fetched here
export const TRANSMISSION_LINES_URL = `${API_BASE}/transmission-lines`

interface CacheOptions<T> {
  notFound?: T
  freshFor?: (value: T) => number
}

interface CacheEntry {
  promise: Promise<unknown>
  value?: unknown
  expires: number
}

const cache = new Map<string, CacheEntry>()

async function getJson<T>(path: string, notFound?: T): Promise<{ value: T; maxAgeMs: number }> {
  const res = await fetch(`${API_BASE}/${path}`)
  if (res.status === 404 && notFound !== undefined) return { value: notFound, maxAgeMs: 0 }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const maxAge = /\bmax-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')
  return { value: await res.json() as T, maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : 0 }
}

function cachedJson<T>(path: string, { notFound, freshFor }: CacheOptions<T> = {}): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() < hit.expires) return hit.promise as Promise<T>
  const entry: CacheEntry = {
    value: hit?.value,
    expires: Infinity, // so callers share the request while it's in flight
    promise: getJson(path, notFound).then(
      ({ value, maxAgeMs }) => {
        entry.value = value
        entry.expires = Date.now() + (freshFor ? freshFor(value) : maxAgeMs)
        return value
      },
      (err: unknown) => {
        entry.expires = 0 // retried next call, without losing the last value for peek*
        throw err
      },
    ),
  }
  cache.set(path, entry)
  return entry.promise as Promise<T>
}

// Hooks render this straight away, even if stale, then call the matching fetch*
function lastJson<T>(path: string): T | undefined {
  return cache.get(path)?.value as T | undefined
}

// dispatch/recent is sent with a 5-second max-age, but nothing new can arrive
// until an interval after its newest row. The API publishes each interval a
// few minutes late, so after that it's checked again once a minute.
function untilNextDispatch(data: RecentData): number {
  const newest = data.data[data.data.length - 1]
  const due = newest ? nzLocalMs(newest[0] as string) + DISPATCH_INTERVAL_MS - nzNowMs() : 0
  return Math.max(due, MINUTE_MS)
}

export function fetchDefinitions(): Promise<DefinitionsResponse> {
  return cachedJson('definitions')
}

export function peekDefinitions(): DefinitionsResponse | undefined {
  return lastJson('definitions')
}

// `day` is a "YYYY-MM-DD" date, or 'recent' for the rolling latest window.
export function fetchDispatch(day: string): Promise<RecentData> {
  return cachedJson(`dispatch/${day}`, day === 'recent' ? { freshFor: untilNextDispatch } : {})
}

export function peekDispatch(day: string): RecentData | undefined {
  return lastJson(`dispatch/${day}`)
}

// `date` is a "YYYY-MM-DD" date, or 'latest' for the latest-available date.
export function fetchOffers(date: string): Promise<OffersData> {
  return cachedJson(`offers/${date}`)
}

export function peekOffers(date: string): OffersData | undefined {
  return lastJson(`offers/${date}`)
}

export function fetchOutages(): Promise<OutageData> {
  return cachedJson('outages')
}

export function peekOutages(): OutageData | undefined {
  return lastJson('outages')
}

// `path` is a month of daily totals ("2026/09") or a year of weekly or monthly
// totals ("2026/weekly", "2026/monthly"). `nodes` are prefix-matched by the
// API, so a substation siteId returns every bus and generator at that site.
// Empty `nodes` returns every node.
export function fetchAggregates(path: string, nodes: string): Promise<AggregateResponse> {
  const query = nodes ? `?nodes=${encodeURIComponent(nodes)}` : ''
  // A month or year with nothing aggregated yet (e.g. on the 1st) 404s
  return cachedJson(`dispatch/aggregates/${path}${query}`, { notFound: { series: [], data: [] } })
}
