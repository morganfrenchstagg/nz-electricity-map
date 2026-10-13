import { describe, expect, it } from 'vitest'
import { chartReach, extractChartData, totalMWh, withGaps } from './chart'
import type { ChartRow } from './chart'

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

describe('chartReach', () => {
  it('is the largest total at a time when stacked', () => {
    expect(chartReach([[100, 200], [300, 400], [50, 50]], true)).toBe(700)
  })

  it('stacks positive and negative values apart', () => {
    expect(chartReach([[3000, -500, 2000]], true)).toBe(5000)
    expect(chartReach([[100, -400, -300]], true)).toBe(700)
  })

  it('is the largest single value when not stacked', () => {
    expect(chartReach([[100, 200], [300, -400]], false)).toBe(400)
  })

  it('is zero with nothing to chart', () => {
    expect(chartReach([], true)).toBe(0)
    expect(chartReach([[], []], false)).toBe(0)
  })
})

describe('totalMWh', () => {
  // A row at a time of day on 13 October 2026
  const row = (time: string, values: Record<string, number>): ChartRow => ({ time: `2026-10-13T${time}:00`, ...values })

  it('integrates MW over time', () => {
    // 60 MW every 5 minutes from 2pm to 3pm
    const times = Array.from({ length: 13 }, (_, i) => new Date(Date.UTC(2026, 9, 13, 14, i * 5)).toISOString().slice(11, 16))
    expect(totalMWh(times.map((t) => row(t, { A: 60 })), ['A'], false)).toBeCloseTo(60)
    // A ramp from 0 to 12 MW over 5 minutes averages 6 MW
    expect(totalMWh([row('14:00', { A: 0 }), row('14:05', { A: 12 })], ['A'], false)).toBeCloseTo(0.5)
  })

  it('totals only the codes given', () => {
    const rows = [row('14:00', { A: 60, B: 30 }), row('14:05', { A: 60, B: 30 })]
    expect(totalMWh(rows, ['A'], false)).toBeCloseTo(5)
    expect(totalMWh(rows, ['A', 'B'], false)).toBeCloseTo(7.5)
  })

  it('skips gaps that withGaps breaks the line at, rather than bridging them', () => {
    const rows = [row('14:00', { A: 60 }), row('14:05', { A: 60 }), row('15:00', { A: 60 }), row('15:05', { A: 60 })]
    expect(totalMWh(rows, ['A'], false)).toBeCloseTo(10)
    expect(totalMWh([row('14:00', { A: 60 }), row('14:20', { A: 60 })], ['A'], false)).toBeCloseTo(20)
  })

  it('counts across midnight', () => {
    const rows = [row('23:55', { A: 60 }), { time: '2026-10-14T00:00:00', A: 60 }]
    expect(totalMWh(rows, ['A'], false)).toBeCloseTo(5)
  })

  it('sums aggregate rows, which are already MWh', () => {
    const rows = [row('00:00', { A: 100, B: 50 }), { time: '2026-10-14T00:00:00', A: 200, B: 0 }]
    expect(totalMWh(rows, ['A', 'B'], true)).toBe(350)
    expect(totalMWh(rows.slice(0, 1), ['A'], true)).toBe(100)
  })

  it('is null with nothing to total', () => {
    expect(totalMWh([row('14:00', { A: 60 }), row('14:05', { A: 60 })], [], false)).toBeNull()
    expect(totalMWh([row('14:00', { A: 60 })], ['A'], false)).toBeNull()
    expect(totalMWh([], ['A'], true)).toBeNull()
  })
})
