import { describe, expect, it } from 'vitest'
import type { RecentData } from '../types'
import { averageMW, firstDayGenerated, generationRecords, lastDayGenerated, lastMonthStart } from './generationRecords'

function data(series: string[], rows: (string | number)[][]): RecentData {
  return { series, data: rows, pricing: [] }
}

// Two units, the second commissioned in 2024, and a battery's charging unit
const monthly = data(
  ['ABC2201 ABC1', 'ABC2201 ABC2', 'ABC2201 ABC9'],
  [
    ['2023-11-01', -2, 0, 0],
    ['2023-12-01', 300, 0, -50],
    ['2024-01-01', 500, 0, 0],
    ['2024-02-01', 400, 600, 0],
    ['2024-03-01', 0, 900, 0],
    ['2025-01-01', 200, 200, 0],
    ['2025-02-01', 0, 0, 0],
  ],
)

describe('generationRecords', () => {
  it('finds the first and last months generated in, and the best month and year', () => {
    expect(generationRecords(monthly, ['ABC2201 ABC1', 'ABC2201 ABC2'])).toEqual({
      firstMonth: '2023-12-01',
      lastMonth: '2025-01-01',
      bestMonth: { month: '2024-02-01', mwh: 1000 },
      bestYear: { year: '2024', mwh: 2400 },
    })
  })

  it('keeps to the codes given', () => {
    const records = generationRecords(monthly, ['ABC2201 ABC2'])
    expect(records?.firstMonth).toBe('2024-02-01')
    expect(records?.bestMonth).toEqual({ month: '2024-03-01', mwh: 900 })
  })

  it('gives the earlier of two months that tie the record', () => {
    expect(
      generationRecords(
        data(
          ['A'],
          [
            ['2020-01-01', 5],
            ['2020-02-01', 5],
          ],
        ),
        ['A'],
      )?.bestMonth.month,
    ).toBe('2020-01-01')
  })

  it('has none for codes that never generated', () => {
    expect(generationRecords(monthly, ['ABC2201 ABC9'])).toBeNull()
    expect(generationRecords(monthly, [])).toBeNull()
  })
})

describe('first and last days', () => {
  const daily = data(
    ['A', 'B'],
    [
      ['2024-02-01', 0, 0],
      ['2024-02-02', 0, 3],
      ['2024-02-03', 1, 0],
      ['2024-02-04', 0, 0],
    ],
  )

  it('finds the first and last days the codes generated on', () => {
    expect(firstDayGenerated(daily, ['A', 'B'])).toBe('2024-02-02')
    expect(firstDayGenerated(daily, ['A'])).toBe('2024-02-03')
    expect(lastDayGenerated(daily, ['A', 'B'])).toBe('2024-02-03')
    expect(lastDayGenerated(daily, ['B'])).toBe('2024-02-02')
    expect(firstDayGenerated(data([], []), ['A'])).toBeNull()
  })

  it("doesn't reorder the rows it's given", () => {
    lastDayGenerated(daily, ['A'])
    expect(daily.data[0][0]).toBe('2024-02-01')
  })
})

describe('averageMW', () => {
  const later = Date.parse('2030-01-01T00:00:00Z')

  it('spreads a month over its hours', () => {
    // February 2024 has 29 days
    expect(averageMW('2024-02-01', 29 * 24 * 100, later)).toBe(100)
    expect(averageMW('2023-12-01', 31 * 24 * 50, later)).toBe(50)
  })

  it('spreads the month so far over its hours so far', () => {
    expect(averageMW('2026-11-01', 240 * 10, Date.parse('2026-11-11T00:00:00Z'))).toBe(10)
  })
})

describe('lastMonthStart', () => {
  it('gives the first day of the month before, across a year', () => {
    expect(lastMonthStart('2026-11-25')).toBe('2026-10-01')
    expect(lastMonthStart('2026-01-05')).toBe('2025-12-01')
  })
})
