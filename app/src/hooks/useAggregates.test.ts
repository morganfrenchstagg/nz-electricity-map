import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentData } from '../types'
import { aggregatePeriodOf, aggregateWindow, foldMovedNodes, MONTHLY_RANGE_MONTHS, NINETY_DAY_RANGE_WEEKS, sumQuarters, WEEKLY_RANGE_WEEKS, yesterdayNZ } from './useAggregates'
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
    expect(aggregatePeriodOf({ kind: 'last90', aggregation: 'weekly' })).toBe('weekly')
    expect(aggregatePeriodOf({ kind: 'last90', aggregation: 'daily' })).toBe('daily')
    expect(aggregatePeriodOf({ kind: 'lastYear', aggregation: 'weekly' })).toBe('weekly')
    expect(aggregatePeriodOf({ kind: 'lastYear', aggregation: 'daily' })).toBe('daily')
    expect(aggregatePeriodOf({ kind: '5y', aggregation: 'monthly' })).toBe('monthly')
    expect(aggregatePeriodOf({ kind: '5y', aggregation: 'weekly' })).toBe('weekly')
    expect(aggregatePeriodOf({ kind: 'all', aggregation: 'annual' })).toBe('annual')
    expect(aggregatePeriodOf({ kind: 'all', aggregation: 'quarterly' })).toBe('quarterly')
    expect(aggregatePeriodOf({ kind: 'all', aggregation: 'monthly' })).toBe('monthly')
  })

  it('is null for the views that chart dispatch data', () => {
    expect(aggregatePeriodOf({ kind: 'today' })).toBeNull()
    expect(aggregatePeriodOf({ kind: 'date', date: '2026-10-13' })).toBeNull()
  })
})

describe('aggregateWindow', () => {
  describe('90d', () => {
    it(`covers the last ${NINETY_DAY_RANGE_WEEKS} Monday-to-Sunday NZ weeks to this one, by their Mondays`, () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on Wednesday the 14th
      const window = aggregateWindow({ kind: 'last90', aggregation: 'weekly' })
      expect(window).toEqual({ from: '2026-07-20', to: '2026-10-12', paths: ['2026/weekly'] })
      expect((daysBetween(window.from, window.to) - 1) / 7 + 1).toBe(NINETY_DAY_RANGE_WEEKS)
    })

    it('fetches each week from the year its Thursday falls in', () => {
      vi.setSystemTime('2026-01-14T01:00:00Z') // 2pm NZDT on Wednesday the 14th
      expect(aggregateWindow({ kind: 'last90', aggregation: 'weekly' })).toEqual({ from: '2025-10-20', to: '2026-01-12', paths: ['2025/weekly', '2026/weekly'] })
    })
  })

  describe('90d, daily', () => {
    it('covers the same weeks as weekly, by day to today, from each month they fall in', () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on Wednesday the 14th
      expect(aggregateWindow({ kind: 'last90', aggregation: 'daily' })).toEqual({
        from: '2026-07-20',
        to: '2026-10-14',
        paths: ['2026/07', '2026/08', '2026/09', '2026/10'],
      })
    })

    it('reaches back into the year before', () => {
      vi.setSystemTime('2026-01-14T01:00:00Z') // 2pm NZDT on Wednesday the 14th
      expect(aggregateWindow({ kind: 'last90', aggregation: 'daily' })).toEqual({
        from: '2025-10-20',
        to: '2026-01-14',
        paths: ['2025/10', '2025/11', '2025/12', '2026/01'],
      })
    })
  })

  describe('1y', () => {
    it(`covers the last ${WEEKLY_RANGE_WEEKS} Monday-to-Sunday NZ weeks to this one, by their Mondays`, () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on Wednesday the 14th
      const window = aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' })
      expect(window).toEqual({ from: '2025-10-20', to: '2026-10-12', paths: ['2025/weekly', '2026/weekly'] })
      expect((daysBetween(window.from, window.to) - 1) / 7 + 1).toBe(WEEKLY_RANGE_WEEKS)
    })

    it("starts a new week from NZ's Monday, while it's still Sunday in UTC", () => {
      vi.setSystemTime('2026-10-11T10:30:00Z') // 11:30pm NZDT on Sunday the 11th
      expect(aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' }).to).toBe('2026-10-05')
      vi.setSystemTime('2026-10-11T11:30:00Z') // 12:30am NZDT on Monday the 12th
      expect(aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' }).to).toBe('2026-10-12')
    })

    it('fetches each week from the year its Thursday falls in', () => {
      // Week 1 of 2025 starts on Monday 30 December 2024
      vi.setSystemTime('2025-12-24T01:00:00Z') // 2pm NZDT on Wednesday the 24th
      expect(aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' })).toEqual({ from: '2024-12-30', to: '2025-12-22', paths: ['2025/weekly'] })
      // ...and week 1 of 2026 on Monday 29 December 2025
      vi.setSystemTime('2025-12-31T01:00:00Z') // 2pm NZDT on Wednesday the 31st
      expect(aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' })).toEqual({ from: '2025-01-06', to: '2025-12-29', paths: ['2025/weekly', '2026/weekly'] })
    })
  })

  describe('1y, daily', () => {
    it('covers the same weeks as weekly, by day to today, from each month they fall in', () => {
      vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on Wednesday the 14th
      const window = aggregateWindow({ kind: 'lastYear', aggregation: 'daily' })
      expect(window).toMatchObject({ from: '2025-10-20', to: '2026-10-14' })
      expect(window.paths).toEqual([
        '2025/10', '2025/11', '2025/12', '2026/01', '2026/02', '2026/03', '2026/04',
        '2026/05', '2026/06', '2026/07', '2026/08', '2026/09', '2026/10',
      ])
      expect(window.from).toBe(aggregateWindow({ kind: 'lastYear', aggregation: 'weekly' }).from)
    })

    it("ends on NZ's today, while it's still yesterday in UTC", () => {
      vi.setSystemTime('2026-10-11T11:30:00Z') // 12:30am NZDT on Monday the 12th
      expect(aggregateWindow({ kind: 'lastYear', aggregation: 'daily' })).toMatchObject({ from: '2025-10-20', to: '2026-10-12' })
    })
  })

  describe('5y', () => {
    it(`covers the last ${MONTHLY_RANGE_MONTHS} NZ months to this one, by their 1sts`, () => {
      vi.setSystemTime('2025-12-15T01:00:00Z') // 2pm NZDT on the 15th
      expect(aggregateWindow({ kind: '5y', aggregation: 'monthly' })).toEqual({
        from: '2021-01-01',
        to: '2025-12-01',
        paths: ['2021/monthly', '2022/monthly', '2023/monthly', '2024/monthly', '2025/monthly'],
      })
    })

    it('reaches back into a sixth year when the window starts partway through one', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      expect(aggregateWindow({ kind: '5y', aggregation: 'monthly' })).toEqual({
        from: '2021-11-01',
        to: '2026-10-01',
        paths: ['2021/monthly', '2022/monthly', '2023/monthly', '2024/monthly', '2025/monthly', '2026/monthly'],
      })
    })

    it("starts a new month from NZ's 1st, while it's still the month before in UTC", () => {
      vi.setSystemTime('2026-10-31T10:30:00Z') // 11:30pm NZDT on 31 October
      expect(aggregateWindow({ kind: '5y', aggregation: 'monthly' })).toMatchObject({ from: '2021-11-01', to: '2026-10-01' })
      vi.setSystemTime('2026-10-31T11:30:00Z') // 12:30am NZDT on 1 November
      expect(aggregateWindow({ kind: '5y', aggregation: 'monthly' })).toMatchObject({ from: '2021-12-01', to: '2026-11-01' })
    })
  })

  describe('5y, weekly', () => {
    it('covers the same months as monthly, by the weeks starting in them, to this one', () => {
      vi.setSystemTime('2025-12-15T01:00:00Z') // 2pm NZDT on Monday the 15th
      // Monthly starts on Friday 1 January 2021, so its first week on the 4th
      expect(aggregateWindow({ kind: '5y', aggregation: 'monthly' }).from).toBe('2021-01-01')
      expect(aggregateWindow({ kind: '5y', aggregation: 'weekly' })).toEqual({
        from: '2021-01-04',
        to: '2025-12-15',
        paths: ['2021/weekly', '2022/weekly', '2023/weekly', '2024/weekly', '2025/weekly'],
      })
    })

    it('starts on the first of the month when it is a Monday', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on Tuesday the 13th
      expect(aggregateWindow({ kind: '5y', aggregation: 'weekly' })).toEqual({
        from: '2021-11-01',
        to: '2026-10-12',
        paths: ['2021/weekly', '2022/weekly', '2023/weekly', '2024/weekly', '2025/weekly', '2026/weekly'],
      })
    })
  })

  describe('All, yearly', () => {
    it('covers every complete NZ year since data begins to this one, by their 1 Januarys, from the one file', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' })).toEqual({ from: '1998-01-01', to: '2026-01-01', paths: ['annual'] })
    })

    it("starts a new year from NZ's 1 January, while it's still the year before in UTC", () => {
      vi.setSystemTime('2026-12-31T10:30:00Z') // 11:30pm NZDT on 31 December
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' }).to).toBe('2026-01-01')
      vi.setSystemTime('2026-12-31T11:30:00Z') // 12:30am NZDT on 1 January
      expect(aggregateWindow({ kind: 'all', aggregation: 'annual' }).to).toBe('2027-01-01')
    })
  })

  describe('All, monthly', () => {
    it('covers every NZ month since data begins to this one, by their 1sts, from the monthly files', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      const window = aggregateWindow({ kind: 'all', aggregation: 'monthly' })
      expect(window).toMatchObject({ from: '1997-08-01', to: '2026-10-01' })
      expect(window.paths).toEqual(aggregateWindow({ kind: 'all', aggregation: 'quarterly' }).paths)
    })

    it("starts a new month from NZ's 1st, while it's still the month before in UTC", () => {
      vi.setSystemTime('2026-10-31T10:30:00Z') // 11:30pm NZDT on 31 October
      expect(aggregateWindow({ kind: 'all', aggregation: 'monthly' }).to).toBe('2026-10-01')
      vi.setSystemTime('2026-10-31T11:30:00Z') // 12:30am NZDT on 1 November
      expect(aggregateWindow({ kind: 'all', aggregation: 'monthly' }).to).toBe('2026-11-01')
    })
  })

  describe('All, quarterly', () => {
    it('covers every complete NZ calendar quarter since data begins to this one, by their first days, from the monthly files', () => {
      vi.setSystemTime('2026-10-13T01:00:00Z') // 2pm NZDT on the 13th
      const window = aggregateWindow({ kind: 'all', aggregation: 'quarterly' })
      expect(window).toMatchObject({ from: '1997-10-01', to: '2026-10-01' })
      expect(window.paths).toHaveLength(2026 - 1997 + 1)
      expect(window.paths[0]).toBe('1997/monthly')
      expect(window.paths[window.paths.length - 1]).toBe('2026/monthly')
    })

    it("starts a new quarter from NZ's 1 October, while it's still September in UTC", () => {
      vi.setSystemTime('2026-09-30T10:30:00Z') // 11:30pm NZDT on 30 September
      expect(aggregateWindow({ kind: 'all', aggregation: 'quarterly' }).to).toBe('2026-07-01')
      vi.setSystemTime('2026-09-30T11:30:00Z') // 12:30am NZDT on 1 October
      expect(aggregateWindow({ kind: 'all', aggregation: 'quarterly' }).to).toBe('2026-10-01')
    })

    it("fetches this year's monthly file from January", () => {
      vi.setSystemTime('2027-01-10T01:00:00Z') // 2pm NZDT on the 10th
      const window = aggregateWindow({ kind: 'all', aggregation: 'quarterly' })
      expect(window.to).toBe('2027-01-01')
      expect(window.paths[window.paths.length - 1]).toBe('2027/monthly')
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
