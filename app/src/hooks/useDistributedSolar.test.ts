import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solarDatesOf, solarEnergyQuarters } from './useDistributedSolar'

describe('solarDatesOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-25T23:30:00Z') // 12:30pm NZDT on the 26th
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is today for the Today view, and each day 3d reaches back over', () => {
    expect(solarDatesOf({ kind: 'today' })).toEqual(['2026-10-26'])
    expect(solarDatesOf({ kind: 'recent' })).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])
  })

  it('is each day of a past day or range', () => {
    expect(solarDatesOf({ kind: 'date', date: '2026-10-01' })).toEqual(['2026-10-01'])
    expect(solarDatesOf({ kind: 'range', from: '2026-09-29', to: '2026-10-02' })).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('reaches back as far as a view does, leaving the API to 404 a day it has no estimate for', () => {
    expect(solarDatesOf({ kind: 'date', date: '2025-10-26' })).toEqual(['2025-10-26'])
  })

  it('is today for the aggregate views, for their period so far', () => {
    expect(solarDatesOf({ kind: 'last90', aggregation: 'daily' })).toEqual(['2026-10-26'])
    expect(solarDatesOf({ kind: 'all', aggregation: 'annual' })).toEqual(['2026-10-26'])
  })
})

describe('solarEnergyQuarters', () => {
  it('sums each quarter’s months, GXP by GXP, across years’ files, running to the quarter’s last day', () => {
    const lastYear = {
      series: ['ISL', 'BLN'],
      data: [
        { from: '2025-11-01', to: '2025-11-30', days: 30, totalMwh: 3, mwh: [2, 1] },
        { from: '2025-12-01', to: '2025-12-31', days: 31, totalMwh: 5, mwh: [3, 2] },
      ],
    }
    const thisYear = {
      series: ['BLN', 'ISL'],
      data: [
        { from: '2026-01-01', to: '2026-01-31', days: 31, totalMwh: 7, mwh: [3, 4] },
        { from: '2026-02-01', to: '2026-02-28', days: 28, totalMwh: 11, mwh: [5, 6] },
        { from: '2026-04-01', to: '2026-04-30', days: 30, totalMwh: 13, mwh: [6, 7] },
      ],
    }
    expect(solarEnergyQuarters([lastYear, thisYear])).toEqual({
      series: ['ISL', 'BLN'],
      data: [
        { from: '2025-10-01', to: '2025-12-31', days: 61, totalMwh: 8, mwh: [5, 3] },
        { from: '2026-01-01', to: '2026-03-31', days: 59, totalMwh: 18, mwh: [10, 8] },
        { from: '2026-04-01', to: '2026-06-30', days: 30, totalMwh: 13, mwh: [7, 6] },
      ],
    })
  })
})
