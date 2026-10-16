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
})
