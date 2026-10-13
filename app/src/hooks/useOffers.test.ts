import { describe, expect, it } from 'vitest'
import { tradingPeriodLabel } from './useOffers'

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
