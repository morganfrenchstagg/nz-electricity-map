import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solarDatesOf } from './useDistributedSolar'

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

  it('is nothing for the aggregate views', () => {
    expect(solarDatesOf({ kind: 'last90', aggregation: 'daily' })).toEqual([])
  })
})
