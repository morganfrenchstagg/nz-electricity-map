import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentData } from './types'

const series = ['ATI2201 ATI0']

const recent = (...rows: [string, number][]): RecentData => ({
  series,
  data: rows,
  pricing: rows.map(([ts]) => [ts, 100]),
})

let responses: RecentData[]
let requested: URL[]
let api: typeof import('./api')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-14T09:10:00Z') // 10:10pm NZDT, so the 22:00 interval's next one is overdue
  responses = []
  requested = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(new URL(url))
    return Response.json(responses.shift(), { headers: { 'Cache-Control': 'max-age=30' } })
  }))
  // a fresh copy of the module each time, so nothing is cached from the last test
  vi.resetModules()
  api = await import('./api')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// fetches dispatch/recent again, once what's cached has expired
async function refetchRecent() {
  vi.advanceTimersByTime(60 * 1000)
  return api.fetchDispatch('recent')
}

describe('fetchDispatch("recent")', () => {
  it('fetches every interval to begin with', async () => {
    responses.push(recent(['2026-10-14T21:55:00', 48], ['2026-10-14T22:00:00', 50]))

    expect(await api.fetchDispatch('recent')).toEqual(recent(['2026-10-14T21:55:00', 48], ['2026-10-14T22:00:00', 50]))
    expect(requested[0].pathname).toBe('/v1/dispatch/recent')
    expect(requested[0].search).toBe('')
  })

  it('then only fetches the intervals after the newest one held, and adds them on', async () => {
    responses.push(recent(['2026-10-14T21:55:00', 48], ['2026-10-14T22:00:00', 50]))
    await api.fetchDispatch('recent')

    responses.push(recent(['2026-10-14T22:05:00', 52]))
    const updated = await refetchRecent()

    expect(requested[1].searchParams.get('since')).toBe('2026-10-14T22:00:00')
    expect(updated).toEqual(recent(['2026-10-14T21:55:00', 48], ['2026-10-14T22:00:00', 50], ['2026-10-14T22:05:00', 52]))
    expect(api.peekDispatch('recent')).toBe(updated)
  })

  it('keeps the same data when nothing new has arrived', async () => {
    responses.push(recent(['2026-10-14T22:00:00', 50]))
    const first = await api.fetchDispatch('recent')

    responses.push(recent())
    expect(await refetchRecent()).toBe(first)
  })

  it('fetches every interval again when the nodes have changed', async () => {
    responses.push(recent(['2026-10-14T22:00:00', 50]))
    await api.fetchDispatch('recent')

    const reorganised = {
      series: ['ARI1101 ARI0', ...series],
      data: [['2026-10-14T22:00:00', 0, 50], ['2026-10-14T22:05:00', 5, 52]],
      pricing: [['2026-10-14T22:00:00', 0, 100], ['2026-10-14T22:05:00', 90, 100]],
    }
    responses.push({ ...reorganised, data: reorganised.data.slice(1), pricing: reorganised.pricing.slice(1) })
    responses.push(reorganised)

    expect(await refetchRecent()).toEqual(reorganised)
    expect(requested.map(url => url.search)).toEqual(['', '?since=2026-10-14T22%3A00%3A00', ''])
  })
})

// Serves the solar API's files by path, as their results, and 404s any other
function stubSolarApi(files: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(new URL(url))
    const path = new URL(url).pathname.slice(1)
    return path in files
      ? Response.json({ result: files[path] }, { headers: { 'Cache-Control': 'max-age=30' } })
      : new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }))
}

const solarPaths = () => requested.map((url) => url.pathname)

// Estimated up to yesterday, as at 10:10pm on 14 October
const coverage = { estimatedFrom: '2015-07-03', estimatedTo: '2026-10-13' }

describe('fetchSolarEnergy', () => {
  const energy = { series: [], data: [] }

  it('fetches the solar API’s file for the same periods as an aggregates path', async () => {
    stubSolarApi({ 'solar-energy': coverage, 'solar-energy/daily/2026-09': energy, 'solar-energy/weekly/2026': energy, 'solar-energy/monthly/2026': energy, 'solar-energy/annual': energy })

    for (const path of ['2026/09', '2026/weekly', '2026/monthly', 'annual']) expect(await api.fetchSolarEnergy(path)).toEqual(energy)
    expect(requested.map((url) => `${url.origin}${url.pathname}`)).toEqual([
      'https://api-solar.electricitymap.frenchsta.gg/solar-energy',
      'https://api-solar.electricitymap.frenchsta.gg/solar-energy/daily/2026-09',
      'https://api-solar.electricitymap.frenchsta.gg/solar-energy/weekly/2026',
      'https://api-solar.electricitymap.frenchsta.gg/solar-energy/monthly/2026',
      'https://api-solar.electricitymap.frenchsta.gg/solar-energy/annual',
    ])
  })

  it('doesn’t ask for a file without any of the days the API has estimated', async () => {
    stubSolarApi({ 'solar-energy': coverage })

    for (const path of ['2014/monthly', '2015/06', '2026/11', '2027/weekly', '2027/monthly']) expect(await api.fetchSolarEnergy(path)).toBeNull()
    for (const path of ['2015/monthly', '2015/07', '2026/10', '2015/weekly']) await api.fetchSolarEnergy(path)
    expect(solarPaths()).toEqual([
      '/solar-energy',
      '/solar-energy/monthly/2015',
      '/solar-energy/daily/2015-07',
      '/solar-energy/daily/2026-10',
      '/solar-energy/weekly/2015',
    ])
  })

  it('asks for an ISO year’s weeks from the Monday it starts on', async () => {
    // 2026's first week starts on Monday 29 December 2025
    stubSolarApi({ 'solar-energy': { ...coverage, estimatedTo: '2025-12-28' } })
    await api.fetchSolarEnergy('2026/weekly')
    expect(solarPaths()).toEqual(['/solar-energy'])

    vi.advanceTimersByTime(31 * 1000)
    stubSolarApi({ 'solar-energy': { ...coverage, estimatedTo: '2025-12-29' } })
    await api.fetchSolarEnergy('2026/weekly')
    expect(solarPaths()).toEqual(['/solar-energy', '/solar-energy', '/solar-energy/weekly/2026'])
  })

  it('doesn’t ask for anything before the API has estimated a day', async () => {
    stubSolarApi({ 'solar-energy': { estimatedFrom: null, estimatedTo: null } })
    expect(await api.fetchSolarEnergy('annual')).toBeNull()
    expect(solarPaths()).toEqual(['/solar-energy'])
  })

  it('asks anyway when it can’t tell what the API has', async () => {
    stubSolarApi({})
    expect(await api.fetchSolarEnergy('2014/monthly')).toBeNull()
    expect(solarPaths()).toEqual(['/solar-energy', '/solar-energy/monthly/2014'])
  })
})

describe('fetchSolarProduction', () => {
  const estimate = { date: '2026-10-14', profileTimes: [], observedUntil: null, gxps: [] }

  it('keeps an estimate for the max-age the solar API sends', async () => {
    responses.push({ result: estimate } as unknown as RecentData)
    await api.fetchSolarProduction('2026-10-14')
    vi.advanceTimersByTime(29 * 1000)
    expect(await api.fetchSolarProduction('2026-10-14')).toEqual(estimate)
    expect(requested).toHaveLength(1)

    responses.push({ result: estimate } as unknown as RecentData)
    vi.advanceTimersByTime(2 * 1000)
    await api.fetchSolarProduction('2026-10-14')
    expect(requested).toHaveLength(2)
  })

  it('asks for a past day the API has estimated back to', async () => {
    stubSolarApi({ 'solar-energy': coverage, 'solar-production/2015-07-03': estimate })
    expect(await api.fetchSolarProduction('2015-07-03')).toEqual(estimate)
    expect(solarPaths()).toEqual(['/solar-energy', '/solar-production/2015-07-03'])
  })

  it('asks again for a day it had no estimate for, as the 404 isn’t to be kept', async () => {
    stubSolarApi({ 'solar-energy': coverage })
    expect(await api.fetchSolarProduction('2026-10-10')).toBeNull()
    expect(await api.fetchSolarProduction('2026-10-10')).toBeNull()
    expect(solarPaths()).toEqual(['/solar-energy', '/solar-production/2026-10-10', '/solar-production/2026-10-10'])
  })

  it('doesn’t ask for a day before the first estimated, or days to come, and keeps them as having none', async () => {
    stubSolarApi({ 'solar-energy': coverage })
    expect(await api.fetchSolarProduction('2015-07-02')).toBeNull()
    expect(await api.fetchSolarProduction('2026-10-15')).toBeNull()
    expect(solarPaths()).toEqual(['/solar-energy'])
    expect(api.peekSolarProduction('2015-07-02')).toBeNull()
  })

  it('doesn’t ask for today until the production job’s first run of the day has had its 2 minutes', async () => {
    vi.setSystemTime('2026-10-14T11:01:00Z') // 12:01am NZDT on the 15th
    stubSolarApi({ 'solar-production/2026-10-15': estimate })
    expect(await api.fetchSolarProduction('2026-10-15')).toBeNull()
    expect(requested).toHaveLength(0)

    vi.setSystemTime('2026-10-14T11:02:00Z')
    expect(await api.fetchSolarProduction('2026-10-15')).toEqual(estimate)
    expect(solarPaths()).toEqual(['/solar-production/2026-10-15'])
  })
})
