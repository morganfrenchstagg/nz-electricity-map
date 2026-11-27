import { describe, expect, it } from 'vitest'
import type { RecentData } from '../types'
import { appendRecent, REFETCHED_INTERVALS, refetchSince, RECENT_INTERVALS } from './recentDispatch'

const series = ['ATI2201 ATI0', 'ALB0331']

const held: RecentData = {
  series,
  data: [
    ['2026-10-14T21:55:00', 48, -20],
    ['2026-10-14T22:00:00', 50, -21],
  ],
  pricing: [
    ['2026-10-14T21:55:00', 110, 115],
    ['2026-10-14T22:00:00', 120.5, 125],
  ],
}

// The 5-minute intervals from 14 October 2026 00:00, as NZ times
const intervals = (count: number) =>
  Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 14, 0, i * 5)).toISOString().slice(0, 19))

describe('refetchSince', () => {
  it(`is the interval before the newest ${REFETCHED_INTERVALS} held`, () => {
    const timestamps = intervals(20)
    const recent = { series, data: timestamps.map((ts) => [ts, 50, -20]), pricing: [] }
    expect(refetchSince(recent)).toBe(timestamps[20 - 1 - REFETCHED_INTERVALS])
  })

  it(`is the oldest interval held when there are no more than ${REFETCHED_INTERVALS}`, () => {
    expect(refetchSince(held)).toBe('2026-10-14T21:55:00')
  })

  it('is undefined when nothing is held', () => {
    expect(refetchSince({ series: [], data: [], pricing: [] })).toBeUndefined()
  })
})

describe('appendRecent', () => {
  const since = '2026-10-14T21:55:00'

  it('adds the intervals after the newest one held', () => {
    const added = {
      series,
      data: [held.data[1], ['2026-10-14T22:05:00', 52, -22]],
      pricing: [held.pricing[1], ['2026-10-14T22:05:00', 118, 124]],
    }
    expect(appendRecent(held, added, since)).toEqual({
      series,
      data: [...held.data, ['2026-10-14T22:05:00', 52, -22]],
      pricing: [...held.pricing, ['2026-10-14T22:05:00', 118, 124]],
    })
  })

  it('takes the values the API now has for the intervals held after since', () => {
    // An interval the API has since revised
    const added = {
      series,
      data: [
        ['2026-10-14T22:00:00', 49, -21],
        ['2026-10-14T22:05:00', 52, -22],
      ],
      pricing: [
        ['2026-10-14T22:00:00', 120.5, 125],
        ['2026-10-14T22:05:00', 118, 124],
      ],
    }
    expect(appendRecent(held, added, since)?.data).toEqual([held.data[0], ...added.data])
  })

  it('fills in an interval the API had skipped when it was last fetched', () => {
    const gappy = {
      series,
      data: [held.data[0], ['2026-10-14T22:05:00', 52, -22]],
      pricing: [held.pricing[0], ['2026-10-14T22:05:00', 118, 124]],
    }
    const added = {
      series,
      data: [held.data[1], ['2026-10-14T22:05:00', 52, -22]],
      pricing: [held.pricing[1], ['2026-10-14T22:05:00', 118, 124]],
    }
    expect(appendRecent(gappy, added, since)?.data.map((row) => row[0])).toEqual([
      '2026-10-14T21:55:00',
      '2026-10-14T22:00:00',
      '2026-10-14T22:05:00',
    ])
  })

  it('gives back the held data itself when nothing has changed, so it is not re-charted', () => {
    const added = { series, data: [[...held.data[1]]], pricing: [[...held.pricing[1]]] }
    expect(appendRecent(held, added, since)).toBe(held)
    expect(appendRecent(held, { series, data: [], pricing: [] }, '2026-10-14T22:00:00')).toBe(held)
  })

  it('only takes rows after since, in case the API sent every interval', () => {
    const added = {
      series,
      data: [['2026-10-14T21:55:00', 0, 0], held.data[1], ['2026-10-14T22:05:00', 52, -22]],
      pricing: [['2026-10-14T21:55:00', 0, 0], held.pricing[1], ['2026-10-14T22:05:00', 118, 124]],
    }
    expect(appendRecent(held, added, since)).toEqual({
      series,
      data: [...held.data, ['2026-10-14T22:05:00', 52, -22]],
      pricing: [...held.pricing, ['2026-10-14T22:05:00', 118, 124]],
    })
    expect(appendRecent(held, held, since)).toBe(held)
  })

  it(`drops the oldest intervals past the ${RECENT_INTERVALS} the API holds`, () => {
    const timestamps = intervals(RECENT_INTERVALS)
    const full = {
      series,
      data: timestamps.map((ts) => [ts, 50, -20]),
      pricing: timestamps.map((ts) => [ts, 100, 105]),
    }
    const added = {
      series,
      data: [
        ['2026-10-17T00:00:00', 60, -30],
        ['2026-10-17T00:05:00', 61, -31],
      ],
      pricing: [
        ['2026-10-17T00:00:00', 90, 95],
        ['2026-10-17T00:05:00', 91, 96],
      ],
    }

    const appended = appendRecent(full, added, timestamps[timestamps.length - 1])!

    expect(appended.data).toHaveLength(RECENT_INTERVALS)
    expect(appended.data.slice(0, 1)).toEqual([['2026-10-14T00:10:00', 50, -20]])
    expect(appended.data.slice(-2)).toEqual(added.data)
    expect(appended.pricing).toHaveLength(RECENT_INTERVALS)
    expect(appended.pricing.slice(-2)).toEqual(added.pricing)
  })

  it('keeps every interval while there are fewer than the API holds, even over 3 days apart', () => {
    // The API holds a fixed count of intervals, not 3 days' worth, so gaps let it reach further back
    const added = {
      series,
      data: [held.data[1], ['2026-10-20T00:00:00', 60, -30]],
      pricing: [held.pricing[1], ['2026-10-20T00:00:00', 90, 95]],
    }
    expect(appendRecent(held, added, since)?.data.map((row) => row[0])).toEqual([
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
    const unchanged = { series, data: [held.data[1]], pricing: [held.pricing[1]] }

    it('replaces the HVDC held with the last day sent alongside new intervals', () => {
      const added = {
        series,
        data: [held.data[1], ['2026-10-14T22:05:00', 52, -22]],
        pricing: [held.pricing[1], ['2026-10-14T22:05:00', 118, 124]],
        hvdc: newerHvdc,
      }
      expect(appendRecent(heldWithHvdc, added, since)?.hvdc).toBe(newerHvdc)
    })

    it('takes a newer HVDC sent without new intervals, as em6 publishes after the dispatch', () => {
      const appended = appendRecent(heldWithHvdc, { ...unchanged, hvdc: newerHvdc }, since)
      expect(appended).toEqual({ ...held, hvdc: newerHvdc })
    })

    it('gives back the held data itself when neither has anything new', () => {
      expect(appendRecent(heldWithHvdc, { ...unchanged, hvdc: { ...hvdc } }, since)).toBe(heldWithHvdc)
    })

    it('keeps the HVDC held when the API sends none', () => {
      const added = {
        series,
        data: [held.data[1], ['2026-10-14T22:05:00', 52, -22]],
        pricing: [held.pricing[1], ['2026-10-14T22:05:00', 118, 124]],
      }
      expect(appendRecent(heldWithHvdc, added, since)?.hvdc).toBe(hvdc)
      expect(appendRecent(held, added, since)).not.toHaveProperty('hvdc')
    })
  })

  it.each([
    ['a node is added', [...series, 'ARI1101 ARI0']],
    ['the nodes are reordered', [...series].reverse()],
    ['the API has nothing', []],
  ])('is null when %s, as the held columns no longer line up', (_, newSeries) => {
    expect(appendRecent(held, { series: newSeries, data: [], pricing: [] }, since)).toBeNull()
  })
})
