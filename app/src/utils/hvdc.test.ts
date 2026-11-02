import { describe, expect, it } from 'vitest'
import type { HvdcData } from '../types'
import { HVDC_CABLE_ANGLE, hvdcDirection, hvdcEnergyInto, hvdcInto, latestHvdcNorth, mergeHvdc } from './hvdc'

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

  it("holds rather than interpolates across a gap of more than 2 hours, e.g. days there's no HVDC for", () => {
    const gappy = {
      series,
      data: [
        ['2026-09-30T23:30:00', 600, 0, null, null],
        ['2026-10-30T14:00:00', 400, 0, 1200, -650],
      ],
    }
    const times = ['2026-09-30T23:55:00', '2026-10-01T01:30:00', '2026-10-01T01:35:00', '2026-10-30T13:55:00', '2026-10-30T14:00:00']
    expect(hvdcInto('NI', gappy, times).map(t => t?.mw)).toEqual([600, 600, undefined, undefined, 400])
  })

  it('has no limits where em6 has none, as before October 2026', () => {
    const metered = { series, data: [['2025-06-15T00:00:00', 0, 250, null, null]] }
    expect(hvdcInto('SI', metered, ['2025-06-15T00:00:00'])).toEqual([{ mw: 250, inLimit: 0, outLimit: 0 }])
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

describe('hvdcEnergyInto', () => {
  // An aggregate view's periods, with the MWh sent each way
  const totals: HvdcData = {
    series: ['northFlow', 'southFlow'],
    data: [
      ['2025-01-01T00:00:00', 266864, 7750],
      ['2025-02-01T00:00:00', 79686, 48194],
    ],
  }

  it("brings what was sent north into the North Island, and takes what was sent south out of it, as it's flowed both ways", () => {
    expect(hvdcEnergyInto('NI', totals, ['2025-01-01T00:00:00', '2025-02-01T00:00:00'])).toEqual([
      { in: 266864, out: 7750 },
      { in: 79686, out: 48194 },
    ])
  })

  it('brings what was sent south into the South Island, and takes what was sent north out of it', () => {
    expect(hvdcEnergyInto('SI', totals, ['2025-01-01T00:00:00'])).toEqual([{ in: 7750, out: 266864 }])
  })

  it('has nothing for a period without a total, or without the HVDC', () => {
    expect(hvdcEnergyInto('NI', totals, ['2025-03-01T00:00:00'])).toEqual([null])
    expect(hvdcEnergyInto('NI', undefined, ['2025-01-01T00:00:00'])).toEqual([null])
  })
})

describe('mergeHvdc', () => {
  const day1: HvdcData = { series, data: [['2026-10-30T23:30:00', 385, 0, 1200, -650]] }
  const day2: HvdcData = { series, data: [['2026-10-31T00:00:00', 400, 0, 1200, -650]] }

  it("joins the days' half hours, in time order", () => {
    expect(mergeHvdc([day2, day1])).toEqual({ series, data: [...day1.data, ...day2.data] })
  })

  it("lines up each day's series by name, with null where a day lacks one", () => {
    const metered = { series: ['northFlow', 'southFlow'], data: [['2025-06-15T00:00:00', 0, 250]] }
    expect(mergeHvdc([metered, day1])).toEqual({
      series: ['northFlow', 'southFlow', 'northLimit', 'southLimit'],
      data: [['2025-06-15T00:00:00', 0, 250, null, null], ['2026-10-30T23:30:00', 385, 0, 1200, -650]],
    })
  })

  it('leaves out days without any, giving a single day as it is', () => {
    expect(mergeHvdc([day1, undefined, { series: [], data: [] }])).toBe(day1)
    expect(mergeHvdc([undefined, { series: [], data: [] }])).toBeUndefined()
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
