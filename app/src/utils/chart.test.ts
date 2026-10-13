import { describe, expect, it } from 'vitest'
import { extractChartData, withGaps } from './chart'

const MIN = 60 * 1000

describe('withGaps', () => {
  it('leaves 5-minute data as it is', () => {
    const points: [number, number][] = [[0, 1], [5 * MIN, 2], [10 * MIN, 3]]
    expect(withGaps(points)).toEqual(points)
  })

  it('breaks the line after a gap of over 20 minutes', () => {
    expect(withGaps([[0, 1], [5 * MIN, 2], [30 * MIN, 3]])).toEqual([
      [0, 1], [5 * MIN, 2], [5 * MIN + 1, null], [30 * MIN, 3],
    ])
  })

  it('bridges a gap of exactly 20 minutes', () => {
    expect(withGaps([[0, 1], [20 * MIN, 2]])).toEqual([[0, 1], [20 * MIN, 2]])
  })

  it('handles no points', () => {
    expect(withGaps([])).toEqual([])
  })
})

describe('extractChartData', () => {
  const recent = {
    series: ['ATI2201 ATI0', 'ATI2201 ATI1', 'WKM2201 WKM0'],
    data: [
      ['2026-10-13T14:25:00', 10, 20, 30],
      ['2026-10-13T14:30:00', 11, 21, 31],
    ],
    pricing: [],
  }

  it('keeps the requested codes the data has, in the requested order', () => {
    expect(extractChartData(recent, ['WKM2201 WKM0', 'MISSING', 'ATI2201 ATI0'])).toEqual({
      codes: ['WKM2201 WKM0', 'ATI2201 ATI0'],
      rows: [
        { time: '2026-10-13T14:25:00', 'WKM2201 WKM0': 30, 'ATI2201 ATI0': 10 },
        { time: '2026-10-13T14:30:00', 'WKM2201 WKM0': 31, 'ATI2201 ATI0': 11 },
      ],
    })
  })
})
