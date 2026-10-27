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

describe('fetchSolarEnergy', () => {
  it('fetches the solar API’s file for the same periods as an aggregates path', async () => {
    const paths = ['2026/09', '2026/weekly', '2026/monthly', 'annual']
    for (const _ of paths) responses.push({ result: { series: [], data: [] } } as unknown as RecentData)

    for (const path of paths) await api.fetchSolarEnergy(path)
    expect(requested.map((url) => `${url.origin}${url.pathname}`)).toEqual([
      'https://nz-solar-stats-api.morgan6725.workers.dev/solar-energy/daily/2026-09',
      'https://nz-solar-stats-api.morgan6725.workers.dev/solar-energy/weekly/2026',
      'https://nz-solar-stats-api.morgan6725.workers.dev/solar-energy/monthly/2026',
      'https://nz-solar-stats-api.morgan6725.workers.dev/solar-energy/annual',
    ])
  })
})
