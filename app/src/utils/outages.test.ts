import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutageRecord } from '../api'
import { mergeOutageSegments } from './outages'
import { nzLocalMs, nzNowMs } from './time'

afterEach(() => { vi.useRealTimers() })

// An outage on 13 October 2026 (NZDT) between two times of day, as the API sends it
function outage(from: string, to: string, mw: number): OutageRecord {
  return { outageBlock: 'ATI_STN', timeStart: `2026-10-13T${from}:00+13:00`, timeEnd: `2026-10-13T${to}:00+13:00`, mwattLost: mw }
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

  it('adds up overlapping outages, then carries on with what remains', () => {
    const records = [outage('08:00', '12:00', 3), outage('10:00', '16:00', 3)]
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

  it('drops what has ended, but keeps when an ongoing segment really began', () => {
    const records = [outage('08:00', '12:00', 3), outage('10:00', '16:00', 3)]
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
