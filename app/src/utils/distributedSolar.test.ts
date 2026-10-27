import { describe, expect, it } from 'vitest'
import type { SolarEnergy, SolarProduction } from '../api'
import { distributedSolarAt, distributedSolarCapacities, distributedSolarEnergy, shortOfDaysNote } from './distributedSolar'
import { nzLocalMs } from './time'

const everyGxp = () => true

// A day's estimate at two GXPs, from its first 15-minute instant (in UTC) on
function day(date: string, firstTime: string, isl: number[], bln: number[], capacity = { isl: 50, bln: 40 }): SolarProduction {
  const start = Date.parse(firstTime)
  return {
    date,
    profileTimes: isl.map((_, i) => new Date(start + i * 15 * 60 * 1000).toISOString()),
    gxps: [
      { gxp: 'ISL', distributedMw: capacity.isl, profileMw: isl },
      { gxp: 'BLN', distributedMw: capacity.bln, profileMw: bln },
    ],
  }
}

// Noon to 12:45pm NZDT on 26 October 2026
const noon = day('2026-10-26', '2026-10-25T23:00:00.000Z', [10, 13, 16, 16], [90, 117, 144, 144])
const at = (time: string) => nzLocalMs(`2026-10-26T${time}`)

describe('distributedSolarAt', () => {
  it('sums the GXPs at the estimate’s points, in NZ time', () => {
    expect(distributedSolarAt([noon], [at('12:00:00'), at('12:15:00')], everyGxp)).toEqual([100, 130])
  })

  it('interpolates between the points', () => {
    expect(distributedSolarAt([noon], [at('12:05:00'), at('12:10:00'), at('12:20:00')], everyGxp)).toEqual([110, 120, 140])
  })

  it('only counts the GXPs kept', () => {
    expect(distributedSolarAt([noon], [at('12:05:00')], (gxp) => gxp === 'ISL')).toEqual([11])
  })

  it('holds the last point for 15 minutes, and is null outside that', () => {
    expect(distributedSolarAt([noon], [at('11:55:00'), at('12:55:00'), at('13:00:00')], everyGxp)).toEqual([null, 160, null])
  })

  it('runs on from yesterday into today', () => {
    // 11:30pm to 11:45pm on the 25th, and midnight to 12:15am on the 26th
    const yesterday = day('2026-10-25', '2026-10-25T10:30:00.000Z', [0, 2], [0, 2])
    const today = day('2026-10-26', '2026-10-25T11:00:00.000Z', [5, 8], [5, 8])
    expect(distributedSolarAt([yesterday, today], [nzLocalMs('2026-10-25T23:50:00'), at('00:05:00')], everyGxp)).toEqual([6, 12])
  })

  it('isn’t interpolated across a gap between days', () => {
    // 11:30pm to 11:45pm on the 24th, and midnight to 12:15am on the 26th
    const before = day('2026-10-24', '2026-10-24T10:30:00.000Z', [0, 2], [0, 2])
    const today = day('2026-10-26', '2026-10-25T11:00:00.000Z', [6, 8], [6, 8])
    expect(distributedSolarAt([before, today], [nzLocalMs('2026-10-24T23:50:00'), nzLocalMs('2026-10-25T12:00:00')], everyGxp)).toEqual([4, null])
  })
})

describe('distributedSolarCapacities', () => {
  it('is each day’s own, at the GXPs kept', () => {
    const lastMonth = day('2026-09-30', '2026-09-29T23:00:00.000Z', [0], [0], { isl: 45, bln: 30 })
    expect(distributedSolarCapacities([lastMonth, noon], everyGxp)).toEqual(new Map([['2026-09-30', 75], ['2026-10-26', 90]]))
    expect(distributedSolarCapacities([lastMonth, noon], (gxp) => gxp === 'BLN')).toEqual(new Map([['2026-09-30', 30], ['2026-10-26', 40]]))
  })
})

describe('distributedSolarEnergy', () => {
  // A week's daily totals, with ISL and BLN in the order the API sends them
  const week: SolarEnergy = {
    series: ['BLN', 'ISL'],
    data: [
      { from: '2026-10-19', to: '2026-10-19', days: 1, totalMwh: 30, mwh: [20, 10] },
      { from: '2026-10-20', to: '2026-10-20', days: 1, totalMwh: 40, mwh: [25, 15] },
    ],
  }

  it('sums the GXPs kept in each period, by the day it starts', () => {
    const mwh = (gxp: (gxp: string) => boolean) => [...distributedSolarEnergy([week], gxp, '2026-10-26')].map(([from, { mwh }]) => [from, mwh])
    expect(mwh(everyGxp)).toEqual([['2026-10-19', 30], ['2026-10-20', 40]])
    expect(mwh((gxp) => gxp === 'ISL')).toEqual([['2026-10-19', 10], ['2026-10-20', 15]])
  })

  it('counts the days each period could have, up to yesterday', () => {
    const months: SolarEnergy = {
      series: ['ISL'],
      data: [
        // The backfill starts on 8 April
        { from: '2026-04-01', to: '2026-04-30', days: 23, totalMwh: 600, mwh: [600] },
        { from: '2026-05-01', to: '2026-05-31', days: 31, totalMwh: 700, mwh: [700] },
        // This month, up to yesterday the 26th
        { from: '2026-10-01', to: '2026-10-31', days: 26, totalMwh: 1100, mwh: [1100] },
      ],
    }
    const energy = distributedSolarEnergy([months], everyGxp, '2026-10-26')
    expect(energy).toEqual(new Map([
      ['2026-04-01', { mwh: 600, days: 23, ofDays: 30 }],
      ['2026-05-01', { mwh: 700, days: 31, ofDays: 31 }],
      ['2026-10-01', { mwh: 1100, days: 26, ofDays: 26 }],
    ]))
    expect([...energy.values()].map(shortOfDaysNote)).toEqual(['Distributed solar estimated for 23 of 30 days', null, null])
  })

  it('leaves out a period with no days estimated yet', () => {
    const today: SolarEnergy = { series: ['ISL'], data: [{ from: '2026-10-27', to: '2026-10-27', days: 0, totalMwh: 0, mwh: [0] }] }
    expect(distributedSolarEnergy([today], everyGxp, '2026-10-26')).toEqual(new Map())
  })
})
