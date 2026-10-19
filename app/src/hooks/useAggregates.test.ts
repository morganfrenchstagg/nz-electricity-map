import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentData } from '../types'
import { aggregatePeriodOf, aggregateWindow, DAILY_RANGE_DAYS, foldMovedNodes, MONTHLY_RANGE_MONTHS, sumQuarters, WEEKLY_RANGE_WEEKS, yesterdayNZ } from './useAggregates'
import { daysBetween } from './useDispatchData'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('yesterdayNZ', () => {
  it('is the day before NZ today', () => {
    vi.setSystemTime('2026-10-13T10:59:00Z') // 11:59pm NZDT on the 13th
    expect(yesterdayNZ()).toBe('2026-10-12')
  })

  it("moves on at NZ midnight, while it's still the day before in UTC", () => {
    vi.setSystemTime('2026-10-13T11:00:00Z') // midnight NZDT on the 14th
    expect(yesterdayNZ()).toBe('2026-10-13')
  })

  it('moves on at NZ midnight during NZST', () => {
    vi.setSystemTime('2026-07-01T11:59:00Z') // 11:59pm NZST on the 1st
    expect(yesterdayNZ()).toBe('2026-06-30')
    vi.setSystemTime('2026-07-01T12:00:00Z') // midnight NZST on the 2nd
    expect(yesterdayNZ()).toBe('2026-07-01')
  })
})

describe('aggregatePeriodOf', () => {
  it('is the period each of an aggregate view\'s totals covers', () => {
    expect(aggregatePeriodOf({ kind: 'last30' })).toBe('daily')
    expect(aggregatePeriodOf({ kind: 'lastYear' })).toBe('weekly')
    expect(aggregatePeriodOf({ kind: '5y' })).toBe('monthly')
    expect(aggregatePeriodOf({ kind: 'all', aggregation: 'annual' })).toBe('annual')
    expect(aggregatePeriodOf({ kind: 'all', aggregation: 'quarterly' })).toBe('quarterly')
  })

  it('is null for the views that chart dispatch data', () => {
    expect(aggregatePeriodOf({ kind: 'today' })).toBeNull()
    expect(aggregatePeriodOf({ kind: 'date', date: '2026-10-13' })).toBeNull()
  })
})

describe('aggregateWindow', () => {
  describe('30d', () => {
    it(`covers the last ${DAILY_RANGE_DAYS} complete NZ days, from each month they fall in`, () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on the 14th
      const window = aggregateWindow({ kind: 'last30' })
      expect(window).toEqual({ from: '2026-09-14', to: '2026-10-13', paths: ['2026/09', '2026/10'] })
      expect(daysBetween(window.from, window.to)).toBe(DAILY_RANGE_DAYS)
    })

    it('reaches back into the year before', () => {
      vi.setSystemTime('2026-01-10T01:00:00Z') // 2pm NZDT on the 10th
      expect(aggregateWindow({ kind: 'last30' })).toEqual({ from: '2025-12-11', to: '2026-01-09', paths: ['2025/12', '2026/01'] })
    })
  })

  describe('1y', () => {
    it(`covers the last ${WEEKLY_RANGE_WEEKS} complete Monday-to-Sunday NZ weeks, by their Mondays`, () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on Wednesday the 14th
      const window = aggregateWindow({ kind: 'lastYear' })
      expect(window).toEqual({ from: '2025-10-13', to: '2026-10-05', paths: ['2025/weekly', '2026/weekly'] })
      expect((daysBetween(window.from, window.to) - 1) / 7 + 1).toBe(WEEKLY_RANGE_WEEKS)
    })

    it("counts last week complete from NZ's Monday, while it's still Sunday in UTC", () => {
      vi.setSystemTime('2026-10-11T10:30:00Z') // 11:30pm NZDT on Sunday the 11th
      expect(aggregateWindow({ kind: 'lastYear' }).to).toBe('2026-09-28')
      vi.setSystemTime('2026-10-11T11:30:00Z') // 12:30am NZDT on Monday the 12th
      expect(aggregateWindow({ kind: 'lastYear' }).to).toBe('2026-10-05')
    })

    it('fetches each week from the year its Thursday falls in', () => {
      // Week 1 of 2025 starts on Monday 30 December 2024
      vi.setSystemTime('2025-12-31T01:00:00Z') // 2pm NZDT on Wednesday the 31st
      expect(aggregateWindow({ kind: 'lastYear' })).toEqual({ from: '2024-12-30', to: '2025-12-22', paths: ['2025/weekly'] })
      // ...and week 1 of 2026 on Monday 29 December 2025
      vi.setSystemTime('2026-01-07T01:00:00Z') // 2pm NZDT on Wednesday the 7th
      expect(aggregateWindow({ kind: 'lastYear' })).toEqual({ from: '2025-01-06', to: '2025-12-29', paths: ['2025/weekly', '2026/weekly'] })
    })
  })

  describe('5y', () => {
    it(`covers the last ${MONTHLY_RANGE_MONTHS} complete NZ months, by their 1sts`, () => {
      vi.setSystemTime('2026-01-15T01:00:00Z') // 2pm NZDT on the 15th
      expect(aggregateWindow({ kind: '5y' })).toEqual({
        from: '2021-01-01',
        to: '2025-12-01',
        paths: ['2021/monthly', '2022/monthly', '2023/monthly', '2024/monthly', '2025/monthly'],
      })
    })

    it('reaches back into a sixth year when the window starts partway through one', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      expect(aggregateWindow({ kind: '5y' })).toEqual({
        from: '2021-10-01',
        to: '2026-09-01',
        paths: ['2021/monthly', '2022/monthly', '2023/monthly', '2024/monthly', '2025/monthly', '2026/monthly'],
      })
    })

    it("counts last month complete from NZ's 1st, while it's still the month before in UTC", () => {
      vi.setSystemTime('2026-10-31T10:30:00Z') // 11:30pm NZDT on 31 October
      expect(aggregateWindow({ kind: '5y' })).toMatchObject({ from: '2021-10-01', to: '2026-09-01' })
      vi.setSystemTime('2026-10-31T11:30:00Z') // 12:30am NZDT on 1 November
      expect(aggregateWindow({ kind: '5y' })).toMatchObject({ from: '2021-11-01', to: '2026-10-01' })
    })
  })

  describe('All, yearly', () => {
    it('covers every complete NZ year since data begins, by their 1 Januarys, from the one file', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' })).toEqual({ from: '2009-01-01', to: '2025-01-01', paths: ['annual'] })
    })

    it("counts last year complete from NZ's 1 January, while it's still the year before in UTC", () => {
      vi.setSystemTime('2026-12-31T10:30:00Z') // 11:30pm NZDT on 31 December
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' }).to).toBe('2025-01-01')
      vi.setSystemTime('2026-12-31T11:30:00Z') // 12:30am NZDT on 1 January
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' }).to).toBe('2026-01-01')
    })
  })

  describe('All, quarterly', () => {
    it('covers every complete NZ calendar quarter since data begins, by their first days, from the monthly files', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      const window = aggregateWindow({ kind: 'all', aggregation: 'quarterly' })
      expect(window).toMatchObject({ from: '2009-01-01', to: '2026-07-01' })
      expect(window.paths).toHaveLength(2026 - 2009 + 1)
      expect(window.paths[0]).toBe('2009/monthly')
      expect(window.paths[window.paths.length - 1]).toBe('2026/monthly')
    })

    it("counts last quarter complete from NZ's 1 October, while it's still September in UTC", () => {
      vi.setSystemTime('2026-09-30T10:30:00Z') // 11:30pm NZDT on 30 September
      expect(aggregateWindow({ kind: 'all', aggregation: 'quarterly' }).to).toBe('2026-04-01')
      vi.setSystemTime('2026-09-30T11:30:00Z') // 12:30am NZDT on 1 October
      expect(aggregateWindow({ kind: 'all', aggregation: 'quarterly' }).to).toBe('2026-07-01')
    })

    it('reaches back into last year from January', () => {
      vi.setSystemTime('2027-01-10T01:00:00Z') // 2pm NZDT on the 10th
      const window = aggregateWindow({ kind: 'all', aggregation: 'quarterly' })
      expect(window.to).toBe('2026-10-01')
      expect(window.paths[window.paths.length - 1]).toBe('2026/monthly')
    })
  })
})

describe('sumQuarters', () => {
  it('sums each calendar quarter\'s months, keyed by its first day', () => {
    expect(sumQuarters([
      ['2025-10-01', 1, 10],
      ['2025-11-01', 2, 20],
      ['2025-12-01', 3, 30],
      ['2026-01-01', 4, 40],
      ['2026-02-01', 5, 50],
    ])).toEqual([
      ['2025-10-01', 6, 60],
      ['2026-01-01', 9, 90],
    ])
  })

  it('keeps quarters apart across a gap in the data', () => {
    expect(sumQuarters([
      ['2007-12-01', 1],
      ['2020-09-01', 2],
      ['2020-10-01', 3],
    ])).toEqual([
      ['2007-10-01', 1],
      ['2020-07-01', 2],
      ['2020-10-01', 3],
    ])
  })
})

describe('foldMovedNodes', () => {
  const data: RecentData = {
    series: ['HWA1101 PTA0', 'OHA0331 PTA0', 'WKM2201 WKM0'],
    data: [
      ['2026-01-01', 5, 0, 100],
      ['2026-02-01', 2, 3, 200],
    ],
    pricing: [],
  }

  it('leaves data with no moved nodes as it is', () => {
    expect(foldMovedNodes(data, { 'ABC0001 ABC0': 'DEF0001 ABC0' })).toBe(data)
  })

  it("adds a moved unit's totals at its old node into its current node", () => {
    expect(foldMovedNodes(data, { 'HWA1101 PTA0': 'OHA0331 PTA0' })).toEqual({
      series: ['OHA0331 PTA0', 'WKM2201 WKM0'],
      data: [
        ['2026-01-01', 5, 100],
        ['2026-02-01', 5, 200],
      ],
      pricing: [],
    })
  })

  it('renames an old node whose current node has no totals yet', () => {
    const before: RecentData = { series: ['HWA1101 PTA0'], data: [['2025-01-01', 7]], pricing: [] }
    expect(foldMovedNodes(before, { 'HWA1101 PTA0': 'OHA0331 PTA0' })).toEqual({
      series: ['OHA0331 PTA0'],
      data: [['2025-01-01', 7]],
      pricing: [],
    })
  })
})
