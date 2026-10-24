import { describe, expect, it } from 'vitest'
import { gridZoneTotals } from './gridZones'
import type { RecentData, Substation, Unit } from '../types'

const substation = (siteId: string, gridZone: number): Substation => ({
  siteId, description: siteId, lat: 0, long: 0, type: 'ACSTN', gridZone, island: 'north',
})

const unit = (node: string, fuel: string, fuelCode: string): Unit => ({ name: node, unitCode: node, node, capacity: 100, fuel, fuelCode })

const SUBSTATIONS = [substation('WIL', 8), substation('CPK', 8), substation('BPE', 7)]

const UNITS = new Map([
  unit('WIL0331 WWD0', 'Wind', 'WIN'),
  unit('CPK0331 MKW0', 'Wind', 'WIN'),
  unit('CPK0331 HYD0', 'Hydro', 'HYD'),
  unit('CPK0331 BAT0', 'Battery (Discharging)', 'BESS'),
  unit('CPK0331 BAT99', 'Battery (Charging)', 'BESS-C'),
  unit('BPE2201 TAP0', 'Wind', 'WIN'),
].map(u => [u.node, u]))

const data = (values: Record<string, number>): RecentData => ({
  series: Object.keys(values),
  data: [
    ['2026-10-15T15:25:00', ...Object.keys(values).map(() => 999)],
    ['2026-10-15T15:30:00', ...Object.values(values)],
  ],
  pricing: [],
})

describe('gridZoneTotals', () => {
  it("totals the zone's bus load and generation in the latest interval", () => {
    const totals = gridZoneTotals(8, data({
      'WIL0331': -120,
      'CPK0331': -80,
      'WIL0331 WWD0': 40,
      'CPK0331 MKW0': 10,
      'CPK0331 HYD0': 30,
      'BPE2201': -500, // another zone
      'BPE2201 TAP0': 200,
    }), SUBSTATIONS, UNITS)
    expect(totals).toEqual({
      demandMW: 200,
      generationMW: 80,
      byFuel: [{ fuel: 'Wind', mw: 50 }, { fuel: 'Hydro', mw: 30 }],
    })
  })

  it("counts a battery's charging as demand rather than negative generation", () => {
    const totals = gridZoneTotals(8, data({ 'CPK0331': -80, 'CPK0331 BAT0': 0, 'CPK0331 BAT99': -25 }), SUBSTATIONS, UNITS)
    expect(totals).toEqual({ demandMW: 105, generationMW: 0, byFuel: [] })
  })

  it('counts a bus sending power into the grid against demand', () => {
    const totals = gridZoneTotals(8, data({ 'WIL0331': -120, 'CPK0331': 15 }), SUBSTATIONS, UNITS)
    expect(totals?.demandMW).toBe(105)
  })

  it('has nothing to total without data', () => {
    expect(gridZoneTotals(8, null, SUBSTATIONS, UNITS)).toBeNull()
    expect(gridZoneTotals(8, { series: [], data: [], pricing: [] }, SUBSTATIONS, UNITS)).toBeNull()
  })
})
