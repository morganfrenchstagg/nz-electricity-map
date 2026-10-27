import type { Generator, RecentData, Substation } from './types'
import { nzLocalMs, nzNowMs } from './utils/time'
import { appendRecent, newestTimestamp } from './utils/recentDispatch'

// Every API request belongs here. Freshness follows each response's max-age, so
// this cache agrees with the browser's HTTP cache instead of keeping its own
// copy of how long each endpoint lasts.
// VITE_API_BASE points the app at another API, e.g. a local `wrangler dev` (see README)
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://api.electricitymap.frenchsta.gg/v1').replace(/\/$/, '')
// The distributed solar estimate comes from its own API (nz-solar-stats-api).
// VITE_SOLAR_API_BASE points the app at another, e.g. a local `wrangler dev` (see README)
const SOLAR_API_BASE = (import.meta.env.VITE_SOLAR_API_BASE || 'https://nz-solar-stats-api.morgan6725.workers.dev').replace(/\/$/, '')

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

// An estimate of each GXP's distributed solar output over an NZ day
export interface SolarProduction {
  date: string
  // The day's 15-minute instants, in UTC
  profileTimes: string[]
  // Each GXP's installed distributed solar as at the last month end on or
  // before `date`, and its estimated MW at each of profileTimes
  gxps: { gxp: string; distributedMw: number; profileMw: number[] }[]
}

// The estimate added up into energy at each GXP, over each period of a file
export interface SolarEnergy {
  // GXPs, the most energy first, which can differ from one file to the next
  series: string[]
  // Each period's first and last NZ dates, how many of its days have been
  // estimated so far, and the MWh at each of series in them
  data: { from: string; to: string; days: number; totalMwh: number; mwh: number[] }[]
}

export interface AggregateResponse {
  series: string[]
  data: (string | number)[][]
}

// Loaded by maplibre as a GeoJSON source rather than fetched here
export const TRANSMISSION_LINES_URL = `${API_BASE}/transmission-lines`

interface CacheOptions<T> {
  notFound?: T
  freshFor?: (value: T) => number
  // In place of fetching `path`, e.g. to fetch only what's new since the value held
  load?: (held: T | undefined) => Promise<{ value: T; maxAgeMs: number }>
}

interface CacheEntry {
  promise: Promise<unknown>
  value?: unknown
  expires: number
}

const cache = new Map<string, CacheEntry>()

async function getJson<T>(path: string, notFound?: T, base = API_BASE): Promise<{ value: T; maxAgeMs: number }> {
  const res = await fetch(`${base}/${path}`)
  if (res.status === 404 && notFound !== undefined) return { value: notFound, maxAgeMs: 0 }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const maxAge = /\bmax-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')
  return { value: await res.json() as T, maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : 0 }
}

function cachedJson<T>(path: string, { notFound, freshFor, load }: CacheOptions<T> = {}): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() < hit.expires) return hit.promise as Promise<T>
  const entry: CacheEntry = {
    value: hit?.value,
    expires: Infinity, // so callers share the request while it's in flight
    promise: (load ? load(hit?.value as T | undefined) : getJson(path, notFound)).then(
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

// Once the recent intervals are held, only the ones after the newest are
// fetched, rather than all 3 days again. If the nodes have changed it's all
// fetched again, as the held rows' columns no longer line up (see appendRecent).
async function loadRecentDispatch(held: RecentData | undefined): Promise<{ value: RecentData; maxAgeMs: number }> {
  const since = held && newestTimestamp(held)
  if (!held || !since) return getJson('dispatch/recent')
  const added = await getJson<RecentData>(`dispatch/recent?since=${encodeURIComponent(since)}`)
  const value = appendRecent(held, added.value)
  return value ? { ...added, value } : getJson('dispatch/recent')
}

// `day` is a "YYYY-MM-DD" date, or 'recent' for the rolling latest window.
export function fetchDispatch(day: string): Promise<RecentData> {
  return cachedJson(`dispatch/${day}`, day === 'recent' ? { freshFor: untilNextDispatch, load: loadRecentDispatch } : {})
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

// The solar API sends no max-age. Today's estimate already runs to midnight,
// and only changes as the API updates it, so it's checked every 15 minutes.
const SOLAR_FRESH_MS = 15 * MINUTE_MS

function solarProductionPath(date: string): string {
  return `solar-production/${date}`
}

// `date` is a "YYYY-MM-DD" date. Null for a day the API has no estimate for.
export function fetchSolarProduction(date: string): Promise<SolarProduction | null> {
  const path = solarProductionPath(date)
  return cachedJson(path, {
    freshFor: () => SOLAR_FRESH_MS,
    load: async () => {
      const { value, maxAgeMs } = await getJson<{ result: SolarProduction } | null>(path, null, SOLAR_API_BASE)
      return { value: value?.result ?? null, maxAgeMs }
    },
  })
}

export function peekSolarProduction(date: string): SolarProduction | null | undefined {
  return lastJson(solarProductionPath(date))
}

// The solar API's file for the same periods as an aggregates path (see
// fetchAggregates): "2026/09" is daily/2026-09, "2026/weekly" weekly/2026, and
// "annual" annual
function solarEnergyPath(path: string): string {
  const [year, period] = path.split('/')
  if (!period) return `solar-energy/${year}`
  if (/^\d{2}$/.test(period)) return `solar-energy/daily/${year}-${period}`
  return `solar-energy/${period}/${year}`
}

// `path` is an aggregates path (see fetchAggregates). Null for one the API has
// nothing for yet, e.g. a year before its backfill reaches.
export function fetchSolarEnergy(path: string): Promise<SolarEnergy | null> {
  const solarPath = solarEnergyPath(path)
  return cachedJson(solarPath, {
    freshFor: () => SOLAR_FRESH_MS,
    load: async () => {
      const { value, maxAgeMs } = await getJson<{ result: SolarEnergy } | null>(solarPath, null, SOLAR_API_BASE)
      return { value: value?.result ?? null, maxAgeMs }
    },
  })
}

// `path` is a month of daily totals ("2026/09"), a year of weekly or monthly
// totals ("2026/weekly", "2026/monthly"), or every year's totals ("annual").
// `nodes` are prefix-matched by the API, so a substation siteId returns every
// bus and generator at that site. Empty `nodes` returns every node.
export function fetchAggregates(path: string, nodes: string): Promise<AggregateResponse> {
  const query = nodes ? `?nodes=${encodeURIComponent(nodes)}` : ''
  // A month or year with nothing aggregated yet (e.g. on the 1st) 404s
  return cachedJson(`dispatch/aggregates/${path}${query}`, { notFound: { series: [], data: [] } })
}
