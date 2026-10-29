import { describe, expect, it } from 'vitest'
import type { SolarEnergy, SolarProduction } from '../api'
import { distributedSolarAt, distributedSolarCapacities, distributedSolarEnergy, observedSolar, solarPeriodNote, solarSoFar } from './distributedSolar'
import { nzLocalMs } from './time'

const everyGxp = () => true

// A day's estimate at two GXPs, from its first 15-minute instant (in UTC) on,
// observed throughout unless `observedUntil` is given
function day(date: string, firstTime: string, isl: number[], bln: number[], capacity = { isl: 50, bln: 40 }, observedUntil?: string | null): SolarProduction {
  const start = Date.parse(firstTime)
  const profileTimes = isl.map((_, i) => new Date(start + i * 15 * 60 * 1000).toISOString())
  return {
    date,
    profileTimes,
    observedUntil: observedUntil === undefined ? profileTimes[profileTimes.length - 1] : observedUntil,
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

describe('observedSolar', () => {
  // The estimate charted at each of `times` (in NZ), with the forecast left out
  function charted(days: SolarProduction[], times: string[]) {
    const ms = times.map((time) => nzLocalMs(time))
    return observedSolar(days, ms, distributedSolarAt(days, ms, everyGxp))
  }

  it('stops where the newest day turns to the forecast', () => {
    // Observed until 12:15pm NZDT
    const today = day('2026-10-26', '2026-10-25T23:00:00.000Z', [10, 13, 16, 16], [90, 117, 144, 144], undefined, '2026-10-25T23:15:00.000Z')
    expect(charted([today], ['2026-10-26T12:00:00', '2026-10-26T12:15:00', '2026-10-26T12:20:00', '2026-10-26T12:30:00'])).toEqual([100, 130, null, null])
  })

  it('has nothing for a day with no readings', () => {
    const today = day('2026-10-26', '2026-10-25T23:00:00.000Z', [10, 13], [90, 117], undefined, null)
    expect(charted([today], ['2026-10-26T12:00:00', '2026-10-26T12:15:00'])).toEqual([null, null])
  })

  it('runs on through a night forecast as none, into the next day’s readings', () => {
    // 11:15pm to 11:45pm on the 25th, observed until 11:15pm, then midnight to
    // 12:15am on the 26th, observed throughout
    const yesterday = day('2026-10-25', '2026-10-25T10:15:00.000Z', [0, 0, 0], [0, 0, 0], undefined, '2026-10-25T10:15:00.000Z')
    const today = day('2026-10-26', '2026-10-25T11:00:00.000Z', [0, 0], [0, 0])
    expect(charted([yesterday, today], ['2026-10-25T23:15:00', '2026-10-25T23:30:00', '2026-10-26T00:00:00'])).toEqual([0, 0, 0])
  })

  it('leaves out a forecast of sun before the newest reading', () => {
    // Observed until 12:15pm on the 25th, then all of the 26th
    const yesterday = day('2026-10-25', '2026-10-24T23:00:00.000Z', [10, 13, 16], [90, 117, 144], undefined, '2026-10-24T23:15:00.000Z')
    const today = day('2026-10-26', '2026-10-25T23:00:00.000Z', [10], [90])
    expect(charted([yesterday, today], ['2026-10-25T12:15:00', '2026-10-25T12:30:00', '2026-10-26T12:00:00'])).toEqual([130, null, 100])
  })

  it('leaves out a night forecast as none after the newest reading', () => {
    // Observed until 11:15pm on the 25th, with no readings yet on the 26th
    const yesterday = day('2026-10-25', '2026-10-25T10:15:00.000Z', [0, 0, 0], [0, 0, 0], undefined, '2026-10-25T10:15:00.000Z')
    const today = day('2026-10-26', '2026-10-25T11:00:00.000Z', [0], [0], undefined, null)
    expect(charted([yesterday, today], ['2026-10-25T23:15:00', '2026-10-25T23:30:00', '2026-10-26T00:00:00'])).toEqual([0, null, null])
  })
})

describe('solarSoFar', () => {
  it('sums today’s MW at each 5-minute time up to now into MWh', () => {
    // 100, 110, 120 ... 160 MW from 12:00 to 12:30, for 5 minutes each
    expect(solarSoFar([noon], '2026-10-26', at('12:30:00'), everyGxp)).toEqual({ mwh: 910 / 12 })
  })

  it('only counts the GXPs kept', () => {
    expect(solarSoFar([noon], '2026-10-26', at('12:30:00'), (gxp) => gxp === 'ISL')).toEqual({ mwh: 91 / 12 })
  })

  it('leaves out the forecast when asked, and says where it stops', () => {
    // Observed until 12:15pm NZDT
    const today = day('2026-10-26', '2026-10-25T23:00:00.000Z', [10, 13, 16, 16], [90, 117, 144, 144], undefined, '2026-10-25T23:15:00.000Z')
    expect(solarSoFar([today], '2026-10-26', at('12:30:00'), everyGxp, true)).toEqual({ mwh: 460 / 12, until: at('12:15:00') })
  })

  it('is null without an estimate for today at the GXPs kept', () => {
    expect(solarSoFar([noon], '2026-10-27', nzLocalMs('2026-10-27T12:30:00'), everyGxp)).toBeNull()
    expect(solarSoFar([noon], '2026-10-26', at('12:30:00'), (gxp) => gxp === 'HAY')).toBeNull()
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
    const mwh = (gxp: (gxp: string) => boolean) => [...distributedSolarEnergy([week], gxp, '2026-10-26', null)].map(([from, { mwh }]) => [from, mwh])
    expect(mwh(everyGxp)).toEqual([['2026-10-19', 30], ['2026-10-20', 40]])
    expect(mwh((gxp) => gxp === 'ISL')).toEqual([['2026-10-19', 10], ['2026-10-20', 15]])
  })

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

  it('adds today so far to the period it falls in, charting a period short of days from those it has', () => {
    expect(distributedSolarEnergy([months], everyGxp, '2026-10-27', { mwh: 50 })).toEqual(new Map([
      ['2026-04-01', { mwh: 600, days: 23 }],
      ['2026-05-01', { mwh: 700, days: 31 }],
      ['2026-10-01', { mwh: 1150, days: 27 }],
    ]))
  })

  it('leaves the period so far as it is without today’s estimate', () => {
    expect(distributedSolarEnergy([months], everyGxp, '2026-10-27', null).get('2026-10-01')).toEqual({ mwh: 1100, days: 26 })
  })

  it('keys a period starting today by today', () => {
    expect(distributedSolarEnergy([week], everyGxp, '2026-10-21', { mwh: 12 }).get('2026-10-21')).toEqual({ mwh: 12, days: 1 })
  })

  it('notes where today’s share stops, when the forecast is left out, and nothing otherwise', () => {
    const energy = distributedSolarEnergy([months], everyGxp, '2026-10-27', { mwh: 50, until: nzLocalMs('2026-10-27T12:00:00') })
    expect(solarPeriodNote(energy.get('2026-10-01'))).toBe('Today\'s embedded solar estimated up to 12:00 PM, from satellite readings')
    expect(solarPeriodNote(energy.get('2026-04-01'))).toBeNull()
  })

  it('leaves out a period with no days estimated yet', () => {
    const today: SolarEnergy = { series: ['ISL'], data: [{ from: '2026-10-27', to: '2026-10-27', days: 0, totalMwh: 0, mwh: [0] }] }
    expect(distributedSolarEnergy([today], everyGxp, '2026-10-27', null)).toEqual(new Map())
  })
})
