import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutageRecord } from '../api'
import type { Unit } from '../types'
import { capacityLeftAfter, maxOutageMWOf, mergeOutageSegments, outageEasesAt, unitCapacityAt, unitOutageMWAt } from './outages'
import { nzLocalMs, nzNowMs } from './time'

afterEach(() => { vi.useRealTimers() })

// An outage on 13 October 2026 (NZDT) between two times of day, as the API sends it
function outage(from: string, to: string, mw: number, block = 'ATI_STN'): OutageRecord {
  return { outageBlock: block, timeStart: `2026-10-13T${from}:00+13:00`, timeEnd: `2026-10-13T${to}:00+13:00`, mwattLost: mw }
}

// A time of day on 13 October 2026, as mergeOutageSegments reports it
function at(time: string): number {
  return nzLocalMs(`2026-10-13T${time}:00`)
}

const BEFORE_ALL = at('07:00')

describe('mergeOutageSegments', () => {
  it('passes a single outage through', () => {
    expect(mergeOutageSegments([outage('08:00', '12:00', 3)], BEFORE_ALL)).toEqual([
      { start: at('08:00'), end: at('12:00'), mw: 3 },
    ])
  })

  it('adds up overlapping outages on different blocks, then carries on with what remains', () => {
    const records = [outage('08:00', '12:00', 3, 'ATI_1'), outage('10:00', '16:00', 3, 'ATI_2')]
    expect(mergeOutageSegments(records, BEFORE_ALL)).toEqual([
      { start: at('08:00'), end: at('10:00'), mw: 3 },
      { start: at('10:00'), end: at('12:00'), mw: 6 },
      { start: at('12:00'), end: at('16:00'), mw: 3 },
    ])
  })

  it('joins back-to-back outages of the same size into one', () => {
    const records = [outage('08:00', '10:00', 3), outage('10:00', '12:00', 3)]
    expect(mergeOutageSegments(records, BEFORE_ALL)).toEqual([
      { start: at('08:00'), end: at('12:00'), mw: 3 },
    ])
  })

  it('leaves out the time between separate outages', () => {
    const records = [outage('08:00', '10:00', 3), outage('12:00', '14:00', 5)]
    expect(mergeOutageSegments(records, BEFORE_ALL)).toEqual([
      { start: at('08:00'), end: at('10:00'), mw: 3 },
      { start: at('12:00'), end: at('14:00'), mw: 5 },
    ])
  })

  it('counts overlapping outages on the same block once, at the largest', () => {
    const records = [outage('08:00', '16:00', 66, 'OHA_5'), outage('09:00', '12:00', 66, 'OHA_5'), outage('10:00', '11:00', 50, 'OHA_5')]
    expect(mergeOutageSegments(records, BEFORE_ALL)).toEqual([
      { start: at('08:00'), end: at('16:00'), mw: 66 },
    ])
  })

  it('stacks blocks no higher than the most a unit can lose', () => {
    const records = [outage('08:00', '16:00', 66, 'OHA_5'), outage('10:00', '12:00', 198, 'OHA_STN')]
    expect(mergeOutageSegments(records, BEFORE_ALL, 254)).toEqual([
      { start: at('08:00'), end: at('10:00'), mw: 66 },
      { start: at('10:00'), end: at('12:00'), mw: 254 },
      { start: at('12:00'), end: at('16:00'), mw: 66 },
    ])
  })

  it('drops what has ended, but keeps when an ongoing segment really began', () => {
    const records = [outage('08:00', '12:00', 3, 'ATI_1'), outage('10:00', '16:00', 3, 'ATI_2')]
    expect(mergeOutageSegments(records, at('11:00'))).toEqual([
      { start: at('10:00'), end: at('12:00'), mw: 6 },
      { start: at('12:00'), end: at('16:00'), mw: 3 },
    ])
  })

  it('drops a segment as soon as it ends', () => {
    expect(mergeOutageSegments([outage('08:00', '12:00', 3)], at('12:00'))).toEqual([])
  })

  it('reads each time on the NZ wall clock across the change from NZDT to NZST', () => {
    const record: OutageRecord = {
      outageBlock: 'ATI_STN',
      timeStart: '2026-04-04T22:00:00+13:00',
      timeEnd: '2026-04-05T10:00:00+12:00',
      mwattLost: 3,
    }
    expect(mergeOutageSegments([record], nzLocalMs('2026-04-04T12:00:00'))).toEqual([
      { start: nzLocalMs('2026-04-04T22:00:00'), end: nzLocalMs('2026-04-05T10:00:00'), mw: 3 },
    ])
  })

  it('treats an outage that ended an hour ago in NZ as over, given nzNowMs', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-13T01:30:00Z') // 2:30pm NZDT
    // Date.now() runs 13 hours behind this clock, so with it this would last until 2:30am tomorrow
    expect(mergeOutageSegments([outage('08:00', '13:30', 3)], nzNowMs())).toEqual([])
  })
})

describe('outageEasesAt', () => {
  it('is when the current outage starts to ease, past any time it gets worse', () => {
    const segments = mergeOutageSegments([outage('08:00', '16:00', 66, 'OHA_5'), outage('10:00', '12:00', 198, 'OHA_STN')], BEFORE_ALL)
    expect(outageEasesAt(segments, at('09:00'))).toBe(at('16:00'))
    expect(outageEasesAt(segments, at('11:00'))).toBe(at('12:00'))
  })

  it("ignores outages that haven't started", () => {
    const segments = mergeOutageSegments([outage('08:00', '10:00', 3, 'ATI_1'), outage('12:00', '14:00', 5, 'ATI_2')], BEFORE_ALL)
    expect(outageEasesAt(segments, at('09:00'))).toBe(at('10:00'))
    expect(outageEasesAt(segments, at('11:00'))).toBeNull()
  })
})

// A battery's charging unit is listed with negative capacity, as the API sends it
const CHARGING: Pick<Unit, 'node' | 'capacity' | 'installedCapacity'> = { node: 'HLY2201 HLY91', capacity: -100 }
// 42 MW normally, 50 MW installed
const HYDRO: Pick<Unit, 'node' | 'capacity' | 'installedCapacity'> = { node: 'ATI2201 ATI0', capacity: 42, installedCapacity: 50 }

describe('unitOutageMWAt', () => {
  it('is nothing for a charging unit without outages', () => {
    expect(unitOutageMWAt(CHARGING, {}, at('11:00'))).toBe(0)
    expect(unitOutageMWAt(CHARGING, { [CHARGING.node]: [] }, at('11:00'))).toBe(0)
  })

  it("stacks a charging unit's blocks up to the size of its capacity", () => {
    const outages = { [CHARGING.node]: [outage('08:00', '12:00', 60, 'HLY_9'), outage('10:00', '12:00', 60, 'HLY_STN')] }
    expect(unitOutageMWAt(CHARGING, outages, at('09:00'))).toBe(60)
    expect(unitOutageMWAt(CHARGING, outages, at('11:00'))).toBe(100)
  })
})

describe('unitCapacityAt', () => {
  it("is a charging unit's usual negative capacity without an outage", () => {
    expect(unitCapacityAt(CHARGING, null, at('11:00'))).toBe(-100)
    expect(unitCapacityAt(CHARGING, {}, at('11:00'))).toBe(-100)
  })

  it('takes an outage off the size of what a charging unit can draw', () => {
    const outages = { [CHARGING.node]: [outage('08:00', '12:00', 30, 'HLY_9'), outage('10:00', '12:00', 100, 'HLY_STN')] }
    expect(unitCapacityAt(CHARGING, outages, at('09:00'))).toBe(-70)
    expect(unitCapacityAt(CHARGING, outages, at('11:00'))).toBe(0)
  })

  it('takes an outage off installed capacity for a generating unit', () => {
    const outages = { [HYDRO.node]: [outage('08:00', '12:00', 20)] }
    expect(unitCapacityAt(HYDRO, outages, at('07:00'))).toBe(42)
    expect(unitCapacityAt(HYDRO, outages, at('09:00'))).toBe(30)
  })
})

describe('capacityLeftAfter', () => {
  it('keeps the sign of what a unit can do, down to nothing', () => {
    expect(capacityLeftAfter(HYDRO, 20)).toBe(30)
    expect(capacityLeftAfter(HYDRO, 80)).toBe(0)
    expect(capacityLeftAfter(CHARGING, 40)).toBe(-60)
    expect(capacityLeftAfter(CHARGING, 140)).toBe(0)
  })
})

describe('maxOutageMWOf', () => {
  it("lets a charging unit's outages through mergeOutageSegments", () => {
    const records = [outage('08:00', '12:00', 60, 'HLY_9'), outage('10:00', '12:00', 60, 'HLY_STN')]
    expect(mergeOutageSegments(records, BEFORE_ALL, maxOutageMWOf(CHARGING))).toEqual([
      { start: at('08:00'), end: at('10:00'), mw: 60 },
      { start: at('10:00'), end: at('12:00'), mw: 100 },
    ])
  })
})
