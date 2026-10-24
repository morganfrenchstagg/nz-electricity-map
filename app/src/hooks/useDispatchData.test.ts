import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentData } from '../types'
import { datesBetween, daysBetween, isAggregateMode, isLiveMode, mergeData, MAX_RANGE_DAYS, periodMode, periodOf } from './useDispatchData'
import { nzLocalMs } from '../utils/time'

describe('datesBetween', () => {
  it('includes both ends', () => {
    expect(datesBetween('2026-10-13', '2026-10-13')).toEqual(['2026-10-13'])
    expect(datesBetween('2025-12-30', '2026-01-02')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
  })

  it('steps one calendar day at a time across daylight saving changes', () => {
    // NZ's clocks go forward on 27 September 2026, and New York's go back on 1 November
    expect(datesBetween('2026-09-26', '2026-09-28')).toEqual(['2026-09-26', '2026-09-27', '2026-09-28'])
    expect(datesBetween('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it(`stops at ${MAX_RANGE_DAYS} days, the most that's fetched`, () => {
    const dates = datesBetween('2026-01-01', '2026-03-01')
    expect(dates).toHaveLength(MAX_RANGE_DAYS)
    expect(dates[dates.length - 1]).toBe('2026-01-31')
  })

  it('is empty when the range ends before it starts', () => {
    expect(datesBetween('2026-10-13', '2026-10-12')).toEqual([])
  })
})

describe('daysBetween', () => {
  it('counts both ends', () => {
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(3)
  })

  it(`counts past ${MAX_RANGE_DAYS} days, unlike datesBetween`, () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(MAX_RANGE_DAYS)
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(MAX_RANGE_DAYS + 1)
  })

  it('counts whole days across daylight saving changes', () => {
    expect(daysBetween('2026-09-20', '2026-10-03')).toBe(14)
    expect(daysBetween('2026-10-25', '2026-11-07')).toBe(14)
  })
})

describe('periodMode', () => {
  it('starts 90d on daily totals', () => {
    expect(periodMode('last90')).toEqual({ kind: 'last90', aggregation: 'daily' })
  })

  it('starts 1y, 5y and All on their coarsest totals', () => {
    expect(periodMode('lastYear')).toEqual({ kind: 'lastYear', aggregation: 'weekly' })
    expect(periodMode('5y')).toEqual({ kind: '5y', aggregation: 'monthly' })
    expect(periodMode('all')).toEqual({ kind: 'all', aggregation: 'annual' })
  })

  it('takes the totals given when they are one of the view\'s choices', () => {
    expect(periodMode('last90', 'weekly')).toEqual({ kind: 'last90', aggregation: 'weekly' })
    expect(periodMode('lastYear', 'daily')).toEqual({ kind: 'lastYear', aggregation: 'daily' })
    expect(periodMode('5y', 'weekly')).toEqual({ kind: '5y', aggregation: 'weekly' })
    expect(periodMode('all', 'monthly')).toEqual({ kind: 'all', aggregation: 'monthly' })
    expect(periodMode('all', 'quarterly')).toEqual({ kind: 'all', aggregation: 'quarterly' })
  })

  it("falls back to the default for another view's totals", () => {
    expect(periodMode('lastYear', 'quarterly')).toEqual({ kind: 'lastYear', aggregation: 'weekly' })
    expect(periodMode('5y', 'daily')).toEqual({ kind: '5y', aggregation: 'monthly' })
    expect(periodMode('last90', 'monthly')).toEqual({ kind: 'last90', aggregation: 'daily' })
    expect(periodMode('all', 'weekly')).toEqual({ kind: 'all', aggregation: 'annual' })
  })

  it('leaves the other views without totals to choose', () => {
    expect(periodMode('today', 'daily')).toEqual({ kind: 'today' })
    expect(periodMode('recent')).toEqual({ kind: 'recent' })
  })
})

describe('isAggregateMode', () => {
  it('is true for the views that chart MWh totals', () => {
    expect(isAggregateMode({ kind: 'last90', aggregation: 'weekly' })).toBe(true)
    expect(isAggregateMode({ kind: 'last90', aggregation: 'daily' })).toBe(true)
    expect(isAggregateMode({ kind: 'lastYear', aggregation: 'weekly' })).toBe(true)
    expect(isAggregateMode({ kind: 'lastYear', aggregation: 'daily' })).toBe(true)
    expect(isAggregateMode({ kind: '5y', aggregation: 'monthly' })).toBe(true)
    expect(isAggregateMode({ kind: '5y', aggregation: 'weekly' })).toBe(true)
    expect(isAggregateMode({ kind: 'all', aggregation: 'annual' })).toBe(true)
    expect(isAggregateMode({ kind: 'all', aggregation: 'quarterly' })).toBe(true)
    expect(isAggregateMode({ kind: 'all', aggregation: 'monthly' })).toBe(true)
  })

  it('is false for the views that chart dispatch data', () => {
    expect(isAggregateMode({ kind: 'recent' })).toBe(false)
    expect(isAggregateMode({ kind: 'today' })).toBe(false)
    expect(isAggregateMode({ kind: 'date', date: '2026-10-13' })).toBe(false)
    expect(isAggregateMode({ kind: 'range', from: '2026-10-01', to: '2026-10-13' })).toBe(false)
  })
})

describe('isLiveMode', () => {
  it('is true for Today and 3d, the views kept up to date', () => {
    expect(isLiveMode({ kind: 'today' })).toBe(true)
    expect(isLiveMode({ kind: 'recent' })).toBe(true)
  })

  it('is false for past days and aggregates', () => {
    expect(isLiveMode({ kind: 'date', date: '2026-10-13' })).toBe(false)
    expect(isLiveMode({ kind: 'range', from: '2026-10-01', to: '2026-10-13' })).toBe(false)
    expect(isLiveMode({ kind: 'last90', aggregation: 'weekly' })).toBe(false)
    expect(isLiveMode({ kind: 'lastYear', aggregation: 'weekly' })).toBe(false)
    expect(isLiveMode({ kind: '5y', aggregation: 'monthly' })).toBe(false)
    expect(isLiveMode({ kind: 'all', aggregation: 'annual' })).toBe(false)
  })
})

describe('mergeData', () => {
  const day1: RecentData = {
    series: ['A', 'B'],
    data: [['2026-10-12T23:55:00', 1, 2]],
    pricing: [['2026-10-12T23:55:00', 10, 20]],
  }
  const day2: RecentData = {
    series: ['B', 'C'],
    data: [['2026-10-13T00:00:00', 3, 4]],
    pricing: [['2026-10-13T00:00:00', 30, 40]],
  }

  it('returns a single day as it is', () => {
    expect(mergeData([day1])).toBe(day1)
  })

  it("lines up each day's series, with 0 MW and no price where a day lacks one", () => {
    expect(mergeData([day1, day2])).toEqual({
      series: ['A', 'B', 'C'],
      data: [
        ['2026-10-12T23:55:00', 1, 2, 0],
        ['2026-10-13T00:00:00', 0, 3, 4],
      ],
      pricing: [
        ['2026-10-12T23:55:00', 10, 20, null],
        ['2026-10-13T00:00:00', null, 30, 40],
      ],
    })
  })

  it('sorts the rows by time, whatever order the days come in', () => {
    const merged = mergeData([day2, day1])
    expect(merged.data.map(row => row[0])).toEqual(['2026-10-12T23:55:00', '2026-10-13T00:00:00'])
    expect(merged.pricing.map(row => row[0])).toEqual(['2026-10-12T23:55:00', '2026-10-13T00:00:00'])
  })

  it('merges days without pricing, such as aggregates', () => {
    const merged = mergeData([{ ...day1, pricing: [] }, { ...day2, pricing: [] }])
    expect(merged.data).toHaveLength(2)
    expect(merged.pricing).toEqual([])
  })
})

describe('periodOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-13T01:30:00Z') // 2:30pm NZDT
  })
  afterEach(() => { vi.useRealTimers() })

  const now = () => nzLocalMs('2026-10-13T14:30:00')

  it('covers the last three days for 3d, and since midnight for Today', () => {
    expect(periodOf({ kind: 'recent' })).toEqual({ from: nzLocalMs('2026-10-10T14:30:00'), to: now() })
    expect(periodOf({ kind: 'today' })).toEqual({ from: nzLocalMs('2026-10-13T00:00:00'), to: now() })
  })

  it('covers the whole of a picked day or range, in NZ time', () => {
    expect(periodOf({ kind: 'date', date: '2025-09-05' })).toEqual({ from: nzLocalMs('2025-09-05T00:00:00'), to: nzLocalMs('2025-09-06T00:00:00') - 1 })
    expect(periodOf({ kind: 'range', from: '2025-09-01', to: '2025-09-05' })).toEqual({ from: nzLocalMs('2025-09-01T00:00:00'), to: nzLocalMs('2025-09-06T00:00:00') - 1 })
  })

  it("covers the aggregate views' charts through to now, as the map shows live data under them", () => {
    expect(periodOf({ kind: 'last90', aggregation: 'weekly' })).toEqual({ from: nzLocalMs('2026-07-20T00:00:00'), to: now() })
    expect(periodOf({ kind: 'last90', aggregation: 'daily' })).toEqual({ from: nzLocalMs('2026-07-20T00:00:00'), to: now() })
    expect(periodOf({ kind: 'lastYear', aggregation: 'weekly' })).toEqual({ from: nzLocalMs('2025-10-20T00:00:00'), to: now() })
    expect(periodOf({ kind: 'lastYear', aggregation: 'daily' })).toEqual({ from: nzLocalMs('2025-10-20T00:00:00'), to: now() })
    expect(periodOf({ kind: '5y', aggregation: 'monthly' })).toEqual({ from: nzLocalMs('2021-11-01T00:00:00'), to: now() })
    expect(periodOf({ kind: '5y', aggregation: 'weekly' })).toEqual({ from: nzLocalMs('2021-11-01T00:00:00'), to: now() })
    expect(periodOf({ kind: 'all', aggregation: 'annual' })).toEqual({ from: nzLocalMs('2009-01-01T00:00:00'), to: now() })
    expect(periodOf({ kind: 'all', aggregation: 'quarterly' })).toEqual({ from: nzLocalMs('2009-01-01T00:00:00'), to: now() })
    expect(periodOf({ kind: 'all', aggregation: 'monthly' })).toEqual({ from: nzLocalMs('2009-01-01T00:00:00'), to: now() })
  })
})
