import { describe, expect, it } from 'vitest'
import { tradingPeriodDispatch, tradingPeriodLabel } from './useOffers'
import type { RecentData } from '../types'

// Some ICU versions put a narrow no-break space before am/pm
function label(tp: number, date: string): string {
  return tradingPeriodLabel(tp, date).replace(/\s/g, ' ')
}

describe('tradingPeriodLabel', () => {
  it('counts half hours from NZ midnight, whatever timezone the browser is in', () => {
    expect(label(1, '2026-10-13')).toBe('12:00 am–12:30 am')
    expect(label(29, '2026-10-13')).toBe('2:00 pm–2:30 pm')
    expect(label(48, '2026-10-13')).toBe('11:30 pm–12:00 am')
  })

  it('takes the offers API\'s "YYYYMMDD" dates', () => {
    expect(label(29, '20261013')).toBe('2:00 pm–2:30 pm')
  })

  it('skips the hour the clocks go forward, leaving 46 periods', () => {
    expect(label(4, '2026-09-27')).toBe('1:30 am–3:00 am')
    expect(label(5, '2026-09-27')).toBe('3:00 am–3:30 am')
    expect(label(46, '2026-09-27')).toBe('11:30 pm–12:00 am')
  })

  it('repeats the hour the clocks go back, making 50 periods', () => {
    expect(label(5, '2026-04-05')).toBe('2:00 am–2:30 am')
    expect(label(6, '2026-04-05')).toBe('2:30 am–2:00 am')
    expect(label(7, '2026-04-05')).toBe('2:00 am–2:30 am')
    expect(label(50, '2026-04-05')).toBe('11:30 pm–12:00 am')
  })
})

// A day's dispatch for `series`, with a row of MW and prices at each time
function dispatchOf(series: string[], rows: [string, number[], (number | null)[]][]): RecentData {
  return {
    series,
    data: rows.map(([time, mw]) => [time, ...mw]),
    pricing: rows.map(([time, , prices]) => [time, ...prices]),
  }
}

describe('tradingPeriodDispatch', () => {
  const series = ['ABC2201 ABC0', 'ABC2201 ABC1', 'XYZ2201 XYZ0']

  it('averages the MW and price over the period\'s intervals, leaving out the next period', () => {
    const dispatch = dispatchOf(series, [
      ['2026-10-13T14:00:00', [100, 0, 0], [50, 50, 10]],
      ['2026-10-13T14:25:00', [200, 0, 0], [70, 70, 10]],
      ['2026-10-13T14:30:00', [999, 0, 0], [999, 999, 10]],
    ])
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC0'], '20261013', 29)).toEqual({ mw: 150, price: 60 })
  })

  it('totals the units\' MW, weighting their nodes\' prices by it', () => {
    const dispatch = dispatchOf(series, [
      ['2026-10-13T14:00:00', [30, 10, 60], [40, 40, 100]],
    ])
    expect(tradingPeriodDispatch(dispatch, series, '20261013', 29)).toEqual({ mw: 100, price: 76 })
  })

  it('averages the prices evenly when nothing generated, and counts power drawn as nothing', () => {
    const dispatch = dispatchOf(series, [
      ['2026-10-13T14:00:00', [0, -20, 0], [40, 40, 100]],
    ])
    expect(tradingPeriodDispatch(dispatch, series, '20261013', 29)).toEqual({ mw: 0, price: 60 })
  })

  it('prices a unit missing from the dispatch at its bus', () => {
    const dispatch = dispatchOf(['ABC2201', 'ABC2201 ABC0'], [
      ['2026-10-13T14:00:00', [0, 50], [25, 25]],
    ])
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC9'], '20261013', 29)).toEqual({ mw: 0, price: 25 })
  })

  it('skips codes missing from the dispatch and prices that are null', () => {
    const dispatch = dispatchOf(series, [
      ['2026-10-13T14:00:00', [50, 0, 0], [null, 40, 40]],
      ['2026-10-13T14:05:00', [50, 0, 0], [30, 40, 40]],
    ])
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC0', 'NEW2201 NEW0'], '20261013', 29)).toEqual({ mw: 50, price: 30 })
  })

  it('has no price when none of the nodes were priced', () => {
    const dispatch = dispatchOf(series, [['2026-10-13T14:00:00', [50, 0, 0], [null, null, null]]])
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC0'], '20261013', 29)).toEqual({ mw: 50, price: null })
  })

  it('is null when the dispatch has none of the period\'s intervals', () => {
    const dispatch = dispatchOf(series, [['2026-10-13T14:30:00', [50, 0, 0], [40, 40, 40]]])
    expect(tradingPeriodDispatch(dispatch, series, '20261013', 29)).toBeNull()
  })

  it('finds the period after the hour the clocks skip', () => {
    const dispatch = dispatchOf(series, [
      ['2026-09-27T01:55:00', [10, 0, 0], [10, 10, 10]],
      ['2026-09-27T03:00:00', [80, 0, 0], [20, 20, 20]],
    ])
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC0'], '2026-09-27', 4)).toEqual({ mw: 10, price: 10 })
    expect(tradingPeriodDispatch(dispatch, ['ABC2201 ABC0'], '2026-09-27', 5)).toEqual({ mw: 80, price: 20 })
  })
})
