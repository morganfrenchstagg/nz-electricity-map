import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dateRangeError } from './useDateRangePicker'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-14T01:00:00Z') // 2pm NZDT on the 14th
})
afterEach(() => { vi.useRealTimers() })

describe('dateRangeError', () => {
  it('allows a day or range of complete days', () => {
    expect(dateRangeError('', '')).toBeNull()
    expect(dateRangeError('2026-10-13', '')).toBeNull()
    expect(dateRangeError('2009-01-01', '2009-01-31')).toBeNull()
  })

  it('rules out days before the data starts', () => {
    expect(dateRangeError('2008-12-31', '')).toBe('Data starts on 1 January 2009')
    expect(dateRangeError('2008-12-31', '2009-01-05')).toBe('Data starts on 1 January 2009')
  })

  it('rules out today, which has its own view, and later', () => {
    expect(dateRangeError('2026-10-14', '')).toBe('Dates must be before today')
    expect(dateRangeError('2026-10-01', '2026-10-14')).toBe('Dates must be before today')
  })

  it('rules out a range that ends before it starts', () => {
    expect(dateRangeError('2026-10-05', '2026-10-01')).toBe('End date must be after start date')
  })

  it('rules out a range longer than 31 days', () => {
    expect(dateRangeError('2026-09-01', '2026-10-01')).toBeNull()
    expect(dateRangeError('2026-09-01', '2026-10-02')).toBe('Range exceeds 31 days (32 selected)')
  })
})
