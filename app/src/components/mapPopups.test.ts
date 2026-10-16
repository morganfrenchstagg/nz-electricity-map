import { describe, expect, it } from 'vitest'
import { generatorPopupHtml } from './mapPopups'
import { nzLocalMs } from '../utils/time'
import type { Generator, RecentData, Unit } from '../types'

const unit = (node: string, name: string, fuel: string, fuelCode: string, capacity: number, extra: Partial<Unit> = {}): Unit =>
  ({ node, name, unitCode: node.split(' ')[1], capacity, fuel, fuelCode, commissioned: '1899-12-31T12:30:00.000Z', ...extra })

// A battery in service while the solar farm beside it is still being commissioned, as at Ruakākā
// (under another site code, as the under-construction list also has Ruakākā's solar farm)
const RUK: Generator = {
  site: 'TST', name: 'Ruakākā', location: { lat: -35.8, long: 174.4 }, gridZone: '1', island: 'NI', operator: 'Meridian',
  units: [
    unit('BRB0331 RUK0', 'Ruakākā Battery', 'Battery (Discharging)', 'BESS', 100),
    unit('BRB0331 RUS0', 'Ruakākā Solar', 'Solar', 'SOL', 130, { commissioned: undefined }),
  ],
}
const DATA: RecentData = { series: ['BRB0331 RUK0', 'BRB0331 RUS0'], data: [['2026-10-13T14:30:00', 40, 60]], pricing: [] }
const NOW = { from: nzLocalMs('2026-10-13T00:00:00'), to: nzLocalMs('2026-10-13T14:30:00') }
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// Stratford's peaker is still running, but Taranaki Combined Cycle retired at 7:30pm on 5 September 2025
const SFD: Generator = {
  site: 'SFD', name: 'Stratford', location: { lat: -39.3, long: 174.3 }, gridZone: '1', island: 'NI', operator: 'Contact',
  units: [
    unit('SFD2201 SFD21', 'Stratford Peaker 1', 'Gas', 'GAS', 100),
    unit('SFD2201 SPL0', 'Taranaki Combined Cycle', 'Gas', 'GAS', 377, { decomissioned: '2025-09-05T07:30:00.000Z' }),
  ],
}
// Pātea moved from Hāwera's substation to Ōhangai's at 2pm on 25 June 2026
const PTA: Generator = {
  site: 'PTA', name: 'Pātea', location: { lat: -39.7, long: 174.5 }, gridZone: '1', island: 'NI', operator: 'Trustpower',
  units: [
    unit('HWA1101 PTA1', 'Pātea Unit 1', 'Hydro', 'HYD', 10, { decomissioned: '2026-06-25T01:59:59.999Z' }),
    unit('OHG1101 PTA1', 'Pātea Unit 1', 'Hydro', 'HYD', 10, { commissioned: '2026-06-25T02:00:00.000Z' }),
  ],
}
// The 1y and All views' periods, as the map shows them
const LAST_YEAR = { from: nzLocalMs('2025-10-13T00:00:00'), to: NOW.to }
const ALL = { from: nzLocalMs('2020-10-01T00:00:00'), to: NOW.to }
const latest = (node: string, mw: number): RecentData => ({ series: [node], data: [['2026-10-13T14:30:00', mw]], pricing: [] })

describe('generatorPopupHtml', () => {
  it("lists a unit still being commissioned once it's dispatching in the live views, as though in full outage", () => {
    const html = generatorPopupHtml(RUK, DATA, null, NOW, true)
    // Its capacity is struck out for none, as an outage would leave it
    expect(text(html)).toContain('Solar (commissioning) 60 MW / 130 MW 0 MW (0%)')
    expect(html).toContain('<s style="color:var(--color-text-faint)">130 MW</s>')
    // Its generation counts towards the total, but not its capacity
    expect(text(html)).toContain('Total 100 MW / 230 MW 100 MW (100%)')
  })

  it('leaves it out of past days, and out of the live views until it dispatches', () => {
    expect(text(generatorPopupHtml(RUK, DATA, null, NOW, false))).not.toContain('Solar')
    const batteryOnly = { ...DATA, series: ['BRB0331 RUK0'], data: [['2026-10-13T14:30:00', 40]] }
    expect(text(generatorPopupHtml(RUK, batteryOnly, null, NOW, true))).not.toContain('Solar')
  })

  it('lists a unit retired by the end of the period without capacity', () => {
    const html = text(generatorPopupHtml(SFD, latest('SFD2201 SFD21', 50), null, ALL, false))
    expect(html).toContain('Taranaki Combined Cycle (retired) —')
    expect(html).not.toContain('377 MW')
    expect(html).toContain('Total 50 MW / 100 MW (50%)')
  })

  it('lists a unit that moved node at its new node only', () => {
    const html = text(generatorPopupHtml(PTA, latest('OHG1101 PTA1', 8), null, LAST_YEAR, false))
    expect(html.match(/Unit 1/g)).toHaveLength(1)
    expect(html).toContain('Unit 1 8 MW / 10 MW (80%)')
    expect(html).not.toContain('retired')
  })
})
