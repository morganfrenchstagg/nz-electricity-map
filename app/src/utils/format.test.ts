import { describe, expect, it } from 'vitest'
import { formatMonthYear, formatMW, formatMWh } from './format'

describe('formatMW', () => {
  it('rounds 1000 and over to whole numbers with thousands separators', () => {
    expect(formatMW(1000)).toBe('1,000 MW')
    expect(formatMW(1234.6)).toBe('1,235 MW')
    expect(formatMW(-2500.4)).toBe('-2,500 MW')
  })

  it('shows whole numbers as they are', () => {
    expect(formatMW(250)).toBe('250 MW')
    expect(formatMW(3)).toBe('3 MW')
    expect(formatMW(0)).toBe('0 MW')
    expect(formatMW(-0)).toBe('0 MW')
  })

  it('gives 100 and over one decimal place', () => {
    expect(formatMW(123.456)).toBe('123.5 MW')
    expect(formatMW(999.94)).toBe('999.9 MW')
    expect(formatMW(-150.25)).toBe('-150.3 MW')
  })

  it('gives 5 and over two decimal places', () => {
    expect(formatMW(5.5)).toBe('5.50 MW')
    expect(formatMW(12.3456)).toBe('12.35 MW')
    expect(formatMW(-7.5)).toBe('-7.50 MW')
  })

  it('gives under 5 three decimal places', () => {
    expect(formatMW(4.25)).toBe('4.250 MW')
    expect(formatMW(0.1234)).toBe('0.123 MW')
    expect(formatMW(-0.5)).toBe('-0.500 MW')
  })
})

describe('formatMWh', () => {
  it('uses the same precision as formatMW', () => {
    expect(formatMWh(48213.7)).toBe('48,214 MWh')
    expect(formatMWh(12.3456)).toBe('12.35 MWh')
    expect(formatMWh(0)).toBe('0 MWh')
  })
})

describe('formatMonthYear', () => {
  it("gives a date's month and year", () => {
    expect(formatMonthYear('2026-03-30')).toBe('Mar 2026')
    expect(formatMonthYear('2028-12-31')).toBe('Dec 2028')
  })

  it('keeps the 1st in its own month west of UTC', () => {
    expect(formatMonthYear('2026-03-01')).toBe('Mar 2026')
  })
})
