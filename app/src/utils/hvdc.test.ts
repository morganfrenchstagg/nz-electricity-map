import { describe, expect, it } from 'vitest'
import type { HvdcData } from '../types'
import { HVDC_CABLE_ANGLE, hvdcDirection, hvdcInto, latestHvdcNorth } from './hvdc'

const series = ['northFlow', 'southFlow', 'northLimit', 'southLimit']

// Flowing north, then easing off to flow south
const hvdc: HvdcData = {
  series,
  data: [
    ['2026-10-28T20:00:00', 600, 0, 1200, -650],
    ['2026-10-28T20:30:00', 300, 0, 1100, -660],
    ['2026-10-28T21:00:00', 0, 300, 1100, -660],
  ],
}

describe('hvdcInto', () => {
  it('brings the flow north into the North Island, and takes it out of the South Island', () => {
    expect(hvdcInto('NI', hvdc, ['2026-10-28T20:00:00'])).toEqual([{ mw: 600, inLimit: 1200, outLimit: 650 }])
    expect(hvdcInto('SI', hvdc, ['2026-10-28T20:00:00'])).toEqual([{ mw: -600, inLimit: 650, outLimit: 1200 }])
  })

  it('interpolates the flow between half hours, with the limits of the half hour before', () => {
    const times = ['2026-10-28T20:05:00', '2026-10-28T20:15:00', '2026-10-28T20:25:00', '2026-10-28T20:30:00', '2026-10-28T20:45:00']
    expect(hvdcInto('NI', hvdc, times)).toEqual([
      { mw: 550, inLimit: 1200, outLimit: 650 },
      { mw: 450, inLimit: 1200, outLimit: 650 },
      { mw: 350, inLimit: 1200, outLimit: 650 },
      { mw: 300, inLimit: 1100, outLimit: 660 },
      { mw: 0, inLimit: 1100, outLimit: 660 },
    ])
  })

  it('takes the flow south out of the North Island and into the South Island', () => {
    expect(hvdcInto('NI', hvdc, ['2026-10-28T21:00:00'])[0]?.mw).toBe(-300)
    expect(hvdcInto('SI', hvdc, ['2026-10-28T21:00:00'])[0]?.mw).toBe(300)
  })

  it('takes the south flow as flowing south whatever its sign', () => {
    const signed = { series, data: [['2026-10-28T21:00:00', 0, -300, 1100, -660]] }
    expect(hvdcInto('NI', signed, ['2026-10-28T21:00:00'])[0]?.mw).toBe(-300)
  })

  it('has nothing before the first half hour', () => {
    expect(hvdcInto('NI', hvdc, ['2026-10-28T19:55:00', '2026-10-28T20:00:00']).map(t => t?.mw)).toEqual([undefined, 600])
  })

  it('holds the last half hour for the dispatch since, for up to 2 hours', () => {
    const times = ['2026-10-28T21:35:00', '2026-10-28T23:00:00', '2026-10-28T23:05:00']
    expect(hvdcInto('SI', hvdc, times).map(t => t?.mw)).toEqual([300, 300, undefined])
  })

  it('skips half hours em6 has no flows for', () => {
    const gappy = {
      series,
      data: [
        ['2026-10-28T20:00:00', 600, 0, 1200, -650],
        ['2026-10-28T20:30:00', null, null, 1200, -650],
        ['2026-10-28T21:00:00', 400, 0, 1200, -650],
      ],
    }
    expect(hvdcInto('NI', gappy, ['2026-10-28T20:30:00'])[0]?.mw).toBe(500)
  })

  it('is 0 rather than -0 flowing out of the South Island with no flow', () => {
    expect(Object.is(hvdcInto('SI', hvdc, ['2026-10-28T20:45:00'])[0]?.mw, 0)).toBe(true)
  })

  it('has nothing without the HVDC', () => {
    expect(hvdcInto('NI', undefined, ['2026-10-28T20:00:00'])).toEqual([null])
    expect(hvdcInto('NI', { series: [], data: [] }, ['2026-10-28T20:00:00'])).toEqual([null])
  })
})

describe('latestHvdcNorth', () => {
  const recent = (times: string[]) => ({ series: [], data: times.map(t => [t]), pricing: [], hvdc })

  it("is the HVDC's transfer north at the newest interval", () => {
    expect(latestHvdcNorth(recent(['2026-10-28T20:00:00', '2026-10-28T20:15:00']))).toEqual({ mw: 450, inLimit: 1200, outLimit: 650 })
  })

  it('has nothing without intervals, or without the HVDC, as on past days', () => {
    expect(latestHvdcNorth(null)).toBeNull()
    expect(latestHvdcNorth(recent([]))).toBeNull()
    expect(latestHvdcNorth({ ...recent(['2026-10-28T20:15:00']), hvdc: undefined })).toBeNull()
  })
})

describe('hvdcDirection', () => {
  const limits = { inLimit: 1200, outLimit: 650 }

  it('is north for a flow into the North Island, and south out of it', () => {
    expect(hvdcDirection({ mw: 600, ...limits })).toBe('north')
    expect(hvdcDirection({ mw: -300, ...limits })).toBe('south')
  })

  it('has none without a MW flowing, or without a transfer', () => {
    expect(hvdcDirection({ mw: 0.4, ...limits })).toBeNull()
    expect(hvdcDirection({ mw: -0.4, ...limits })).toBeNull()
    expect(hvdcDirection(null)).toBeNull()
  })
})

describe('HVDC_CABLE_ANGLE', () => {
  it('has the cables running a little north of east, from Fighting Bay to Oteranga Bay', () => {
    expect(HVDC_CABLE_ANGLE).toBeCloseTo(2.85, 1)
  })
})
