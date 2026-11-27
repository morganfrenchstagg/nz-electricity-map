import { describe, expect, it } from 'vitest'
import { generatorPopupHtml, hvdcPopupHtml } from './mapPopups'
import { nzLocalMs } from '../utils/time'
import type { Generator, RecentData, Unit } from '../types'

const unit = (
  node: string,
  name: string,
  fuel: string,
  fuelCode: string,
  capacity: number,
  extra: Partial<Unit> = {},
): Unit => ({
  node,
  name,
  unitCode: node.split(' ')[1],
  capacity,
  fuel,
  fuelCode,
  commissioned: '1899-12-31T12:30:00.000Z',
  ...extra,
})

// A battery in service while the solar farm beside it is still being commissioned, as at Ruakākā
// (under another site code, as the under-construction list also has Ruakākā's solar farm)
const RUK: Generator = {
  site: 'TST',
  name: 'Ruakākā',
  location: { lat: -35.8, long: 174.4 },
  gridZone: '1',
  island: 'NI',
  operator: 'Meridian',
  units: [
    unit('BRB0331 RUK0', 'Ruakākā Battery', 'Battery (Discharging)', 'BESS', 100),
    unit('BRB0331 RUS0', 'Ruakākā Solar', 'Solar', 'SOL', 130, { commissioned: undefined }),
  ],
}
const DATA: RecentData = {
  series: ['BRB0331 RUK0', 'BRB0331 RUS0'],
  data: [['2026-10-13T14:30:00', 40, 60]],
  pricing: [],
}
const NOW = { from: nzLocalMs('2026-10-13T00:00:00'), to: nzLocalMs('2026-10-13T14:30:00') }
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// Stratford's peaker is still running, but Taranaki Combined Cycle retired at 7:30pm on 5 September 2025
const SFD: Generator = {
  site: 'SFD',
  name: 'Stratford',
  location: { lat: -39.3, long: 174.3 },
  gridZone: '1',
  island: 'NI',
  operator: 'Contact',
  units: [
    unit('SFD2201 SFD21', 'Stratford Peaker 1', 'Gas', 'GAS', 100),
    unit('SFD2201 SPL0', 'Taranaki Combined Cycle', 'Gas', 'GAS', 377, { decomissioned: '2025-09-05T07:30:00.000Z' }),
  ],
}
// Pātea moved from Hāwera's substation to Ōhangai's at 2pm on 25 June 2026
const PTA: Generator = {
  site: 'PTA',
  name: 'Pātea',
  location: { lat: -39.7, long: 174.5 },
  gridZone: '1',
  island: 'NI',
  operator: 'Trustpower',
  units: [
    unit('HWA1101 PTA1', 'Pātea Unit 1', 'Hydro', 'HYD', 10, { decomissioned: '2026-06-25T01:59:59.999Z' }),
    unit('OHG1101 PTA1', 'Pātea Unit 1', 'Hydro', 'HYD', 10, { commissioned: '2026-06-25T02:00:00.000Z' }),
  ],
}
// Southdown's two gas units were only metered together, as a combined unit, and all
// three retired in January 2016. Its battery came after them.
const SWN: Generator = {
  site: 'SWN',
  name: 'Southdown',
  location: { lat: -36.9, long: 174.8 },
  gridZone: '1',
  island: 'NI',
  operator: 'Mercury',
  units: [
    unit('SWN2201 SWN1', 'Southdown Battery', 'Battery (Discharging)', 'BESS', 1, {
      commissioned: '2016-12-31T11:00:00.000Z',
      decomissioned: '2022-05-23T06:59:59.000Z',
    }),
    unit('SWN2201 SWN0', 'Southdown', 'Gas', 'GAS', 130, {
      commissioned: '1995-12-31T11:00:00.000Z',
      decomissioned: '2016-01-19T10:59:59.000Z',
    }),
    unit('SWN2201 SWN5', 'Southdown 5', 'Gas', 'GAS', 50, {
      commissioned: '2006-12-31T11:00:00.000Z',
      decomissioned: '2016-01-19T10:59:59.000Z',
    }),
    unit('SWN2201 southdown', 'Southdown & Southdown 5', 'Gas', 'GAS', 0, {
      commissioned: '1995-12-31T11:00:00.000Z',
      decomissioned: '2016-01-19T10:59:59.000Z',
      combines: ['SWN2201 SWN0', 'SWN2201 SWN5'],
    }),
  ],
}
// The 1y and All views' periods, as the map shows them
const LAST_YEAR = { from: nzLocalMs('2025-10-13T00:00:00'), to: NOW.to }
const ALL = { from: nzLocalMs('2020-10-01T00:00:00'), to: NOW.to }
const latest = (node: string, mw: number): RecentData => ({
  series: [node],
  data: [['2026-10-13T14:30:00', mw]],
  pricing: [],
})

describe('generatorPopupHtml', () => {
  it("lists a unit still being commissioned once it's dispatching in the live views, as though in full outage", () => {
    const html = generatorPopupHtml(RUK, DATA, null, NOW, true, [])
    // Its capacity is struck out for none, as an outage would leave it
    expect(text(html)).toContain('Solar (commissioning) 60 MW / 130 MW 0 MW (0%)')
    expect(html).toContain('<s style="color:var(--color-text-faint)">130 MW</s>')
    // Its generation counts towards the total, but not its capacity
    expect(text(html)).toContain('Total 100 MW / 230 MW 100 MW (100%)')
  })

  it('leaves it out of past days, and out of the live views until it dispatches', () => {
    expect(text(generatorPopupHtml(RUK, DATA, null, NOW, false, []))).not.toContain('Solar')
    const batteryOnly = { ...DATA, series: ['BRB0331 RUK0'], data: [['2026-10-13T14:30:00', 40]] }
    expect(text(generatorPopupHtml(RUK, batteryOnly, null, NOW, true, []))).not.toContain('Solar')
  })

  it('lists a unit retired by the end of the period without capacity', () => {
    const html = text(generatorPopupHtml(SFD, latest('SFD2201 SFD21', 50), null, ALL, false, []))
    expect(html).toContain('Taranaki Combined Cycle (retired) —')
    expect(html).not.toContain('377 MW')
    expect(html).toContain('Total 50 MW / 100 MW (50%)')
  })

  it('lists a unit that moved node at its new node only', () => {
    const html = text(generatorPopupHtml(PTA, latest('OHG1101 PTA1', 8), null, LAST_YEAR, false, []))
    expect(html.match(/Unit 1/g)).toHaveLength(1)
    expect(html).toContain('Unit 1 8 MW / 10 MW (80%)')
    expect(html).not.toContain('retired')
  })
})

describe('generatorPopupHtml with combined units', () => {
  const ANNUAL = { from: nzLocalMs('1997-01-01T00:00:00'), to: NOW.to }

  it('lists a combined unit in place of the units it combines, by its full name', () => {
    const html = text(generatorPopupHtml(SWN, null, null, ANNUAL, false, []))
    expect(html).toContain('Southdown & Southdown 5 (retired) —')
    expect(html).toContain('Battery (retired) —')
    expect(html.match(/\(retired\)/g)).toHaveLength(2)
    // With every unit retired, there's no total to give
    expect(html).not.toContain('Total')
  })

  it('gives a combined unit in service the capacity of the units it combines, counted once', () => {
    const in2010 = { from: nzLocalMs('2010-06-01T00:00:00'), to: nzLocalMs('2010-06-01T12:00:00') }
    const html = text(generatorPopupHtml(SWN, latest('SWN2201 southdown', 90), null, in2010, false, []))
    expect(html).toContain('Southdown & Southdown 5 90 MW / 180 MW (50%)')
    expect(html).not.toContain('130 MW')
  })

  it('finds units it combines at other sites', () => {
    const TUI: Generator = {
      ...SWN,
      site: 'TUI',
      name: 'Tuai',
      units: [
        unit('TUI1101 TUI0', 'Tuai', 'Hydro', 'HYD', 62),
        unit('TUI1101 waikaremoana', 'Tuai, Kaitawa & Piripaua', 'Hydro', 'HYD', 0, {
          combines: ['TUI1101 TUI0', 'TUI1101 KTW0'],
        }),
      ],
    }
    const ktw0 = unit('TUI1101 KTW0', 'Kaitawa', 'Hydro', 'HYD', 36)
    const html = text(
      generatorPopupHtml(TUI, latest('TUI1101 waikaremoana', 49), null, NOW, false, [], new Map([[ktw0.node, ktw0]])),
    )
    expect(html).toContain('Tuai, Kaitawa & Piripaua 49 MW / 98 MW (50%)')
    expect(html).not.toContain('62 MW')
  })

  it('names a unit named just as its generator when others beside it are named', () => {
    const in2010 = { from: nzLocalMs('2010-06-01T00:00:00'), to: nzLocalMs('2010-06-01T12:00:00') }
    const separate = { ...SWN, units: SWN.units.filter((u) => !u.combines) }
    const html = text(generatorPopupHtml(separate, null, null, in2010, false, []))
    expect(html).toContain('Southdown — / 130 MW')
    expect(html).toContain('Southdown 5 — / 50 MW')
  })
})

describe('hvdcPopupHtml', () => {
  // The bar's halves, south then north, by how far each is filled, and how far striped
  const fills = (html: string) =>
    [...html.matchAll(/<div style="width:([\d.]+)%;background:#8c8c8c/g)].map((m) => Number(m[1]))
  const stripes = (html: string) =>
    [...html.matchAll(/<div style="width:([\d.]+)%;background:repeating/g)].map((m) => Number(m[1]))

  it('measures a flow north against the north limit, on the right of the bar', () => {
    const html = hvdcPopupHtml({ mw: 600.4, inLimit: 1200, outLimit: 850 })
    expect(text(html)).toContain(' 600 MW / 1,200 MW (50%)')
    expect(fills(html)).toEqual([0, 50])
    expect(html).not.toContain('<s ')
  })

  it('measures a flow south against the south limit, on the left of the bar', () => {
    const html = hvdcPopupHtml({ mw: -425, inLimit: 1200, outLimit: 850 })
    expect(text(html)).toContain(' 425 MW / 850 MW (50%)')
    expect(fills(html)).toEqual([50, 0])
  })

  it("strikes out a way's capacity for a lower limit, as for an outage, and stripes the rest of its half", () => {
    const html = hvdcPopupHtml({ mw: -325, inLimit: 1000, outLimit: 650 })
    expect(text(html)).toContain(' 325 MW / 850 MW 650 MW (50%)')
    expect(html).toContain(
      '<s style="color:var(--color-text-faint)">850 MW</s> <span style="color:var(--color-danger)">650 MW</span>',
    )
    // Each half is scaled to its capacity, to fit the cut to it in beside the flow
    expect(fills(html).map(Math.round)).toEqual([38, 0])
    expect(stripes(html).map(Math.round)).toEqual([24, 17])
  })

  it('leaves the bar empty either side of zero with no transfer', () => {
    const html = hvdcPopupHtml({ mw: 0.3, inLimit: 1200, outLimit: 850 })
    expect(text(html)).toContain(' 0 MW')
    expect(text(html)).not.toContain('%')
    expect(fills(html)).toEqual([0, 0])
  })
})
