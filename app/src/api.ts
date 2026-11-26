import type { Generator, HvdcData, RecentData, Substation } from './types'
import { nzLocalMs, nzNowMs, todayNZ } from './utils/time'
import { appendRecent, refetchSince } from './utils/recentDispatch'

// All API requests go through here. Cache freshness follows each response's
// max-age, matching the browser's HTTP cache rather than hard-coding lifetimes.
// VITE_API_BASE points the app at another API, e.g. a local `wrangler dev` (see README)
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://api.electricitymap.frenchsta.gg/v1').replace(/\/$/, '')
// The distributed solar estimate has its own API (nz-solar-stats-api).
// VITE_SOLAR_API_BASE overrides it, as VITE_API_BASE does (see README)
const SOLAR_API_BASE = (import.meta.env.VITE_SOLAR_API_BASE || 'https://api-solar.electricitymap.frenchsta.gg').replace(/\/$/, '')

const DISPATCH_INTERVAL_MS = 5 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
// How long the solar API allows its production job to store a run (see solarHasDay)
const SOLAR_RUN_MS = 2 * MINUTE_MS

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
  // Satellite readings up to this instant (UTC), forecast after. Null with no readings yet.
  observedUntil: string | null
  // Installed distributed solar as at the last month end on or before `date`,
  // and estimated MW at each of profileTimes
  gxps: { gxp: string; distributedMw: number; profileMw: number[] }[]
}

// The estimate as energy per GXP, over each period of a file
export interface SolarEnergy {
  // GXPs, most energy first; the order can differ between files
  series: string[]
  // Each period's first and last NZ dates, days estimated so far, and MWh per GXP
  data: { from: string; to: string; days: number; totalMwh: number; mwh: number[] }[]
}

export interface AggregateResponse {
  series: string[]
  data: (string | number)[][]
  // MWh the HVDC sent north and south per period, regardless of `nodes`
  hvdc?: HvdcData
}

// Loaded by maplibre as a GeoJSON source rather than fetched here
export const TRANSMISSION_LINES_URL = `${API_BASE}/transmission-lines`

interface CacheOptions<T> {
  notFound?: T
  freshFor?: (value: T) => number
  // Replaces fetching `path`, e.g. to fetch only what's new since the held value
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
    expires: Infinity, // callers share the request while it's in flight
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

// Hooks render this immediately, even if stale, then call the matching fetch*
function lastJson<T>(path: string): T | undefined {
  return cache.get(path)?.value as T | undefined
}

// dispatch/recent has a 5-second max-age, but nothing new can arrive until an
// interval after its newest row. Intervals are published a few minutes late, so
// after that it's rechecked once a minute.
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

// Once held, only the newest few intervals and any new ones are refetched, not
// all 3 days (see refetchSince). If the nodes changed, it's all refetched, as
// the held rows' columns no longer line up (see appendRecent).
async function loadRecentDispatch(held: RecentData | undefined): Promise<{ value: RecentData; maxAgeMs: number }> {
  const since = held && refetchSince(held)
  if (!held || !since) return getJson('dispatch/recent')
  const added = await getJson<RecentData>(`dispatch/recent?since=${encodeURIComponent(since)}`)
  const value = appendRecent(held, added.value, since)
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

// The outages going on now and over the next few days, or with `date` ("YYYY-MM-DD"),
// those going on at any time in that NZ day, from POCP's history of them
function outagesPath(date?: string): string {
  return date ? `outages/${date}` : 'outages'
}

export function fetchOutages(date?: string): Promise<OutageData> {
  return cachedJson(outagesPath(date))
}

export function peekOutages(date?: string): OutageData | undefined {
  return lastJson(outagesPath(date))
}

// Every day from estimatedFrom to estimatedTo is estimated and in the energy
// totals. Null before any are.
interface SolarCoverage {
  estimatedFrom: string | null
  estimatedTo: string | null
}

// The solar API 404s for days or periods with no estimate, so requests are
// checked against coverage first. Its max-age runs to the next aggregate run,
// which advances estimatedTo.
function fetchSolarCoverage(): Promise<SolarCoverage> {
  return cachedJson('solar-energy', {
    load: async () => {
      const { value, maxAgeMs } = await getJson<{ result: SolarCoverage }>('solar-energy', undefined, SOLAR_API_BASE)
      return { value: value.result, maxAgeMs }
    },
  })
}

// Whether the solar API has an estimate for a "YYYY-MM-DD" NZ date. Today's is
// stored every 10 minutes from midnight, so it exists once the first run's
// allowed time has passed; future days have none. Past days go back to the first
// estimated. If coverage is unavailable, a past day is requested anyway.
async function solarHasDay(date: string): Promise<boolean> {
  const today = todayNZ()
  if (date >= today) return date === today && nzNowMs() >= nzLocalMs(`${today}T00:00:00`) + SOLAR_RUN_MS
  const coverage = await fetchSolarCoverage().catch(() => null)
  return !coverage || (coverage.estimatedFrom !== null && date >= coverage.estimatedFrom)
}

// Whether the solar API has totals for any day in an aggregates path's file (see
// aggregatePathDays). If coverage is unavailable, it's requested anyway.
async function solarHasTotals(path: string): Promise<boolean> {
  const coverage = await fetchSolarCoverage().catch(() => null)
  if (!coverage) return true
  const { estimatedFrom, estimatedTo } = coverage
  if (estimatedFrom === null || estimatedTo === null) return false
  const [from, until] = aggregatePathDays(path)
  return from <= estimatedTo && until > estimatedFrom
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// An ISO week-numbering year starts on the Monday of the week containing 4 January
function isoYearStart(year: number): string {
  const jan4 = Date.UTC(year, 0, 4)
  return isoDate(jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS)
}

// NZ dates an aggregates file covers, as [first, day after last]: a month
// ("2026/09"), an ISO year's weeks ("2026/weekly"), a year's months
// ("2026/monthly"), or every year ("annual")
function aggregatePathDays(path: string): [string, string] {
  const [year, period] = path.split('/')
  if (!period) return ['0000-01-01', '9999-12-31']
  if (period === 'weekly') return [isoYearStart(Number(year)), isoYearStart(Number(year) + 1)]
  if (period === 'monthly') return [`${year}-01-01`, `${Number(year) + 1}-01-01`]
  return [`${year}-${period}-01`, isoDate(Date.UTC(Number(year), Number(period), 1))]
}

// The solar API's max-age runs to its next update: about a minute for today and
// yesterday (re-estimated every 10 minutes), hours for finished days and periods
function solarProductionPath(date: string): string {
  return `solar-production/${date}`
}

// `date` is "YYYY-MM-DD". Null for a day with no estimate, which isn't requested
// if coverage says so. Rechecked each call, against coverage cached until it expires.
export function fetchSolarProduction(date: string): Promise<SolarProduction | null> {
  const path = solarProductionPath(date)
  return cachedJson(path, {
    load: async () => {
      if (!(await solarHasDay(date))) return { value: null, maxAgeMs: 0 }
      const { value, maxAgeMs } = await getJson<{ result: SolarProduction } | null>(path, null, SOLAR_API_BASE)
      return { value: value?.result ?? null, maxAgeMs }
    },
  })
}

export function peekSolarProduction(date: string): SolarProduction | null | undefined {
  return lastJson(solarProductionPath(date))
}

// The solar file matching an aggregates path (see fetchAggregates): "2026/09" is
// daily/2026-09, "2026/weekly" weekly/2026, "annual" annual
function solarEnergyPath(path: string): string {
  const [year, period] = path.split('/')
  if (!period) return `solar-energy/${year}`
  if (/^\d{2}$/.test(period)) return `solar-energy/daily/${year}-${period}`
  return `solar-energy/${period}/${year}`
}

// `path` is an aggregates path (see fetchAggregates). Null where the API has
// nothing yet, e.g. a year before its backfill; skipped if coverage says so.
export function fetchSolarEnergy(path: string): Promise<SolarEnergy | null> {
  const solarPath = solarEnergyPath(path)
  return cachedJson(solarPath, {
    load: async () => {
      if (!(await solarHasTotals(path))) return { value: null, maxAgeMs: 0 }
      const { value, maxAgeMs } = await getJson<{ result: SolarEnergy } | null>(solarPath, null, SOLAR_API_BASE)
      return { value: value?.result ?? null, maxAgeMs }
    },
  })
}

// `path` is a month of daily totals ("2026/09"), a year of weekly or monthly
// totals ("2026/weekly", "2026/monthly"), or every year's totals ("annual").
// The API prefix-matches `nodes`, so a substation siteId returns every bus and
// generator at that site. Empty `nodes` returns every node.
export function fetchAggregates(path: string, nodes: string): Promise<AggregateResponse> {
  const query = nodes ? `?nodes=${encodeURIComponent(nodes)}` : ''
  // A month or year with nothing aggregated yet (e.g. on the 1st) 404s
  return cachedJson(`dispatch/aggregates/${path}${query}`, { notFound: { series: [], data: [] } })
}
