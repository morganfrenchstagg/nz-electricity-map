import { describe, expect, it } from 'vitest'
import type { RecentData } from '../types'
import { appendRecent, newestTimestamp, RECENT_INTERVALS } from './recentDispatch'

const series = ['ATI2201 ATI0', 'ALB0331']

const held: RecentData = {
  series,
  data: [['2026-10-14T21:55:00', 48, -20], ['2026-10-14T22:00:00', 50, -21]],
  pricing: [['2026-10-14T21:55:00', 110, 115], ['2026-10-14T22:00:00', 120.5, 125]],
}

describe('newestTimestamp', () => {
  it('is the last row held', () => {
    expect(newestTimestamp(held)).toBe('2026-10-14T22:00:00')
  })

  it('is undefined when nothing is held', () => {
    expect(newestTimestamp({ series: [], data: [], pricing: [] })).toBeUndefined()
  })
})

describe('appendRecent', () => {
  it('adds the intervals after the newest one held', () => {
    const added = {
      series,
      data: [['2026-10-14T22:05:00', 52, -22]],
      pricing: [['2026-10-14T22:05:00', 118, 124]],
    }
    expect(appendRecent(held, added)).toEqual({
      series,
      data: [...held.data, ['2026-10-14T22:05:00', 52, -22]],
      pricing: [...held.pricing, ['2026-10-14T22:05:00', 118, 124]],
    })
  })

  it('gives back the held data itself when there is nothing new, so it is not re-charted', () => {
    expect(appendRecent(held, { series, data: [], pricing: [] })).toBe(held)
  })

  it('only adds rows newer than those held, in case the API sent every interval', () => {
    const added = {
      series,
      data: [...held.data, ['2026-10-14T22:05:00', 52, -22]],
      pricing: [...held.pricing, ['2026-10-14T22:05:00', 118, 124]],
    }
    expect(appendRecent(held, added)).toEqual({
      series,
      data: [...held.data, ['2026-10-14T22:05:00', 52, -22]],
      pricing: [...held.pricing, ['2026-10-14T22:05:00', 118, 124]],
    })
    expect(appendRecent(held, held)).toBe(held)
  })

  it(`drops the oldest intervals past the ${RECENT_INTERVALS} the API holds`, () => {
    const timestamps = Array.from({ length: RECENT_INTERVALS }, (_, i) => new Date(Date.UTC(2026, 9, 14, 0, i * 5)).toISOString().slice(0, 19))
    const full = { series, data: timestamps.map(ts => [ts, 50, -20]), pricing: timestamps.map(ts => [ts, 100, 105]) }
    const added = {
      series,
      data: [['2026-10-17T00:00:00', 60, -30], ['2026-10-17T00:05:00', 61, -31]],
      pricing: [['2026-10-17T00:00:00', 90, 95], ['2026-10-17T00:05:00', 91, 96]],
    }

    const appended = appendRecent(full, added)!

    expect(appended.data).toHaveLength(RECENT_INTERVALS)
    expect(appended.data.slice(0, 1)).toEqual([['2026-10-14T00:10:00', 50, -20]])
    expect(appended.data.slice(-2)).toEqual(added.data)
    expect(appended.pricing).toHaveLength(RECENT_INTERVALS)
    expect(appended.pricing.slice(-2)).toEqual(added.pricing)
  })

  it('keeps every interval while there are fewer than the API holds, even over 3 days apart', () => {
    // the API holds a fixed number of intervals rather than 3 days' worth, so any it missed leave it reaching back further
    const added = { series, data: [['2026-10-20T00:00:00', 60, -30]], pricing: [['2026-10-20T00:00:00', 90, 95]] }
    expect(appendRecent(held, added)?.data.map(row => row[0])).toEqual([
      '2026-10-14T21:55:00',
      '2026-10-14T22:00:00',
      '2026-10-20T00:00:00',
    ])
  })

  describe('the HVDC', () => {
    const hvdcSeries = ['northFlow', 'southFlow', 'northLimit', 'southLimit']
    const hvdc = { series: hvdcSeries, data: [['2026-10-14T21:30:00', 600, 0, 1200, -650]] }
    const newerHvdc = { series: hvdcSeries, data: [...hvdc.data, ['2026-10-14T22:00:00', 550, 0, 1200, -650]] }
    const heldWithHvdc = { ...held, hvdc }

    it('replaces the HVDC held with the last day sent alongside new intervals', () => {
      const added = { series, data: [['2026-10-14T22:05:00', 52, -22]], pricing: [['2026-10-14T22:05:00', 118, 124]], hvdc: newerHvdc }
      expect(appendRecent(heldWithHvdc, added)?.hvdc).toBe(newerHvdc)
    })

    it('takes a newer HVDC sent without new intervals, as em6 publishes after the dispatch', () => {
      const appended = appendRecent(heldWithHvdc, { series, data: [], pricing: [], hvdc: newerHvdc })
      expect(appended).toEqual({ ...held, hvdc: newerHvdc })
    })

    it('gives back the held data itself when neither has anything new', () => {
      expect(appendRecent(heldWithHvdc, { series, data: [], pricing: [], hvdc: { ...hvdc } })).toBe(heldWithHvdc)
    })

    it('keeps the HVDC held when the API sends none', () => {
      const added = { series, data: [['2026-10-14T22:05:00', 52, -22]], pricing: [['2026-10-14T22:05:00', 118, 124]] }
      expect(appendRecent(heldWithHvdc, added)?.hvdc).toBe(hvdc)
      expect(appendRecent(held, added)).not.toHaveProperty('hvdc')
    })
  })

  it.each([
    ['a node is added', [...series, 'ARI1101 ARI0']],
    ['the nodes are reordered', [...series].reverse()],
    ['the API has nothing', []],
  ])('is null when %s, as the held columns no longer line up', (_, newSeries) => {
    expect(appendRecent(held, { series: newSeries, data: [], pricing: [] })).toBeNull()
  })
})
