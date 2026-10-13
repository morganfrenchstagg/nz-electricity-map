import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nzLocalMs, nzMidnightMs, nzNowMs, outageMs } from './time'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('nzLocalMs', () => {
  it('reads a dispatch timestamp as UTC', () => {
    expect(nzLocalMs('2026-10-13T14:30:00')).toBe(Date.UTC(2026, 9, 13, 14, 30))
  })
})

describe('nzNowMs', () => {
  it('is NZ wall-clock time during NZDT (UTC+13)', () => {
    vi.setSystemTime('2026-10-13T01:30:00Z') // 2:30pm NZDT
    expect(nzNowMs()).toBe(nzLocalMs('2026-10-13T14:30:00'))
  })

  it('is NZ wall-clock time during NZST (UTC+12)', () => {
    vi.setSystemTime('2026-07-01T02:30:00Z') // 2:30pm NZST
    expect(nzNowMs()).toBe(nzLocalMs('2026-07-01T14:30:00'))
  })

  it("is on NZ's date while UTC is still on the day before", () => {
    vi.setSystemTime('2026-10-13T11:30:00Z') // 12:30am NZDT on the 14th
    expect(nzNowMs()).toBe(nzLocalMs('2026-10-14T00:30:00'))
  })

  it('makes the latest dispatch row minutes old, not hours in the future', () => {
    vi.setSystemTime('2026-10-13T01:37:00Z') // 2:37pm NZDT
    expect(nzNowMs() - nzLocalMs('2026-10-13T14:30:00')).toBe(7 * 60 * 1000)
  })
})

describe('nzMidnightMs', () => {
  it('is 11am UTC the day before during NZDT', () => {
    expect(nzMidnightMs('2026-10-13')).toBe(Date.parse('2026-10-12T11:00:00Z'))
  })

  it('is noon UTC the day before during NZST', () => {
    expect(nzMidnightMs('2026-07-01')).toBe(Date.parse('2026-06-30T12:00:00Z'))
  })

  it('is on the offset in force at midnight on the days the clocks change', () => {
    // Forward at 2am NZST on 27 September, back at 3am NZDT on 5 April
    expect(nzMidnightMs('2026-09-27')).toBe(Date.parse('2026-09-26T12:00:00Z'))
    expect(nzMidnightMs('2026-09-28')).toBe(Date.parse('2026-09-27T11:00:00Z'))
    expect(nzMidnightMs('2026-04-05')).toBe(Date.parse('2026-04-04T11:00:00Z'))
    expect(nzMidnightMs('2026-04-06')).toBe(Date.parse('2026-04-05T12:00:00Z'))
  })
})

describe('outageMs', () => {
  it("drops an outage timestamp's offset to give its NZ wall-clock time", () => {
    const wallClock = nzLocalMs('2026-10-13T14:30:00')
    expect(outageMs('2026-10-13T14:30:00+13:00')).toBe(wallClock)
    expect(outageMs('2026-10-13T14:30:00+12:00')).toBe(wallClock)
    expect(outageMs('2026-10-13T14:30:00Z')).toBe(wallClock)
    expect(outageMs('2026-10-13T14:30:00')).toBe(wallClock)
  })

  it('compares with nzNowMs on the same clock', () => {
    vi.setSystemTime('2026-10-13T01:30:00Z') // 2:30pm NZDT
    expect(outageMs('2026-10-13T13:30:00+13:00')).toBeLessThan(nzNowMs())
    expect(outageMs('2026-10-13T15:30:00+13:00')).toBeGreaterThan(nzNowMs())
  })
})
