import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareButtonLabel,
  compareOptions,
  customStartBounds,
  optionLabel,
  parseCompare,
  priorPeriod,
  shiftedMs,
  spanLabel,
} from './compare'
import { aggregateWindow } from '../hooks/useAggregates'
import type { DateMode } from '../hooks/useDispatchData'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-11-27T01:00:00Z') // 2pm NZDT on Friday the 27th
})
afterEach(() => {
  vi.useRealTimers()
})

const today: DateMode = { kind: 'today' }
const recent: DateMode = { kind: 'recent' }
const range: DateMode = { kind: 'range', from: '2026-11-16', to: '2026-11-20' }

describe('parseCompare', () => {
  it('reads the choices and custom starts, and nothing else', () => {
    expect(parseCompare('prev')).toBe('prev')
    expect(parseCompare('year')).toBe('year')
    expect(parseCompare('2026-11-03')).toBe('2026-11-03')
    expect(parseCompare('2008-12-31')).toBeNull()
    expect(parseCompare('soon')).toBeNull()
    expect(parseCompare(null)).toBeNull()
  })
})

describe('compareOptions', () => {
  it('offers each view the choices that suit it', () => {
    expect(compareOptions(today)).toEqual(['prev', 'week', 'year', 'custom'])
    expect(compareOptions({ kind: 'last90', aggregation: 'daily' })).toEqual(['prev', 'year'])
    expect(compareOptions({ kind: '5y', aggregation: 'monthly' })).toEqual(['prev'])
    expect(compareOptions({ kind: 'all', aggregation: 'annual' })).toEqual([])
  })
})

describe('priorPeriod', () => {
  it('compares today with a whole earlier day', () => {
    expect(priorPeriod(today, 'prev')).toMatchObject({
      mode: { kind: 'date', date: '2026-11-26' },
      shift: { days: 1 },
      label: 'Thu 26 Nov',
    })
    expect(priorPeriod(today, 'week')).toMatchObject({ mode: { kind: 'date', date: '2026-11-20' }, shift: { days: 7 } })
    // 52 weeks, so it's a Friday too
    expect(priorPeriod(today, 'year')).toMatchObject({
      mode: { kind: 'date', date: '2025-11-28' },
      label: 'Fri 28 Nov 2025',
    })
    expect(priorPeriod(today, '2026-11-03')).toMatchObject({
      option: 'custom',
      mode: { kind: 'date', date: '2026-11-03' },
      shift: { days: 24 },
    })
  })

  it('shifts the 3d view by its rolling window, over the days it covers', () => {
    expect(priorPeriod(recent, 'prev')).toMatchObject({
      mode: { kind: 'range', from: '2026-11-21', to: '2026-11-24' },
      shift: { days: 3 },
      label: '21 – 24 Nov',
    })
    expect(priorPeriod(recent, '2026-11-03')).toMatchObject({
      mode: { kind: 'range', from: '2026-11-03', to: '2026-11-06' },
    })
  })

  it('compares a range with one as long', () => {
    expect(priorPeriod(range, 'prev')).toMatchObject({
      mode: { kind: 'range', from: '2026-11-11', to: '2026-11-15' },
      shift: { days: 5 },
    })
  })

  it('fetches an aggregate view shifted back a whole window', () => {
    const daily: DateMode = { kind: 'last90', aggregation: 'daily' }
    expect(priorPeriod(daily, 'prev')).toMatchObject({
      mode: daily,
      shift: { days: 91 },
      from: '2026-06-01',
      to: '2026-08-28',
    })
    expect(priorPeriod(daily, 'year')).toMatchObject({ shift: { days: 364 }, from: '2025-09-01' })
    expect(priorPeriod({ kind: 'lastYear', aggregation: 'weekly' }, 'prev')).toMatchObject({
      from: '2024-12-02',
      to: '2025-11-30',
      label: '2 Dec 2024 – 30 Nov 2025',
    })
    expect(priorPeriod({ kind: '5y', aggregation: 'monthly' }, 'prev')).toMatchObject({
      shift: { months: 60 },
      label: 'Dec 2016 – Nov 2021',
    })
  })

  it('falls back to the period before for a choice the view lacks, and has nothing for All', () => {
    expect(priorPeriod({ kind: 'lastYear', aggregation: 'weekly' }, 'week')).toMatchObject({ option: 'prev' })
    expect(priorPeriod(today, '2026-11-27')).toMatchObject({ option: 'prev' })
    expect(priorPeriod({ kind: 'all', aggregation: 'annual' }, 'prev')).toBeNull()
    expect(priorPeriod(today, null)).toBeNull()
  })

  it("doesn't reach before the data starts", () => {
    expect(priorPeriod({ kind: 'date', date: '2009-01-01' }, 'prev')).toBeNull()
    expect(priorPeriod({ kind: 'date', date: '2009-01-05' }, 'week')).toMatchObject({
      option: 'prev',
      mode: { date: '2009-01-04' },
    })
  })
})

describe('customStartBounds', () => {
  it('ends the earlier period by yesterday, before the view starts', () => {
    expect(customStartBounds(today)).toEqual({ min: '2009-01-01', max: '2026-11-26', days: 1 })
    expect(customStartBounds(recent)).toEqual({ min: '2009-01-01', max: '2026-11-23', days: 4 })
  })
})

describe('labels', () => {
  it('names spans in this year without it', () => {
    expect(spanLabel('2026-10-28', '2026-11-03')).toBe('28 Oct – 3 Nov')
    expect(spanLabel('2024-12-30', '2025-01-02')).toBe('30 Dec 2024 – 2 Jan 2025')
  })

  it('keeps the button short', () => {
    expect(compareButtonLabel(today, priorPeriod(today, 'prev'))).toBe('vs yesterday')
    expect(compareButtonLabel(today, priorPeriod(today, '2026-11-03'))).toBe('vs 3 Nov')
    expect(compareButtonLabel(today, null)).toBe('Compare')
    expect(optionLabel(range, 'prev')).toBe('Previous 5 days')
  })
})

describe('shiftedMs', () => {
  it('moves by whole days or months', () => {
    expect(shiftedMs(Date.parse('2026-11-26T14:30:00Z'), { days: 1 })).toBe(Date.parse('2026-11-27T14:30:00Z'))
    expect(shiftedMs(Date.parse('2016-12-01T00:00:00Z'), { months: 60 })).toBe(Date.parse('2021-12-01T00:00:00Z'))
  })
})

describe('aggregateWindow', () => {
  it('keeps a shifted window as long as the view', () => {
    const mode: DateMode = { kind: '5y', aggregation: 'weekly' }
    const now = aggregateWindow(mode)
    const then = aggregateWindow(mode, { days: 261 * 7 })
    expect(new Date(then.from).getUTCDay()).toBe(1)
    expect(Date.parse(now.to) - Date.parse(now.from)).toBe(Date.parse(then.to) - Date.parse(then.from))
  })
})
