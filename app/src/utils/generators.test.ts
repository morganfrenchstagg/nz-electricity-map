import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  combinedUnitOf,
  inServiceAt,
  inServiceDuring,
  isCombinedOver,
  isCommissioning,
  isDecommissioned,
  isRetired,
  serviceChangesBetween,
  shortUnitName,
  unitLabel,
  unitsByNode,
} from './generators'
import { nzLocalMs } from './time'
import type { Generator, Unit } from '../types'

const unit = (node: string, name: string): Unit => ({
  name,
  unitCode: name,
  node,
  capacity: 10,
  fuel: 'Hydro',
  fuelCode: 'hyd',
})

const generator = (site: string, units: Unit[]): Generator => ({
  site,
  name: site,
  units,
  location: { lat: 0, long: 0 },
  gridZone: '1',
  island: 'NI',
  operator: 'Operator',
})

describe('shortUnitName', () => {
  it('drops the generator name leading a unit name', () => {
    expect(shortUnitName('Huntly Unit 5', 'Huntly')).toBe('Unit 5')
    expect(shortUnitName('Huntly BESS', 'Huntly')).toBe('BESS')
  })

  it('drops a separator after the generator name', () => {
    expect(shortUnitName('SolarZero - South Island', 'SolarZero')).toBe('South Island')
  })

  it('leaves nothing of a unit named just as its generator', () => {
    expect(shortUnitName('Tokaanu', 'Tokaanu')).toBe('')
  })

  it('keeps a unit name that only starts with the same letters', () => {
    expect(shortUnitName('Tekapo A', 'Te')).toBe('Tekapo A')
  })

  it('keeps a unit name the generator name does not lead', () => {
    expect(shortUnitName('Taranaki Combined Cycle', 'Stratford')).toBe('Taranaki Combined Cycle')
  })

  it("keeps a unit name when what's left wouldn't read as one", () => {
    expect(shortUnitName('Southdown & Southdown 5', 'Southdown')).toBe('Southdown & Southdown 5')
    expect(shortUnitName('Southdown 5', 'Southdown')).toBe('Southdown 5')
    expect(shortUnitName('Tuai, Kaitawa & Piripaua', 'Tuai')).toBe('Tuai, Kaitawa & Piripaua')
  })

  it('still shortens names left starting with a number', () => {
    expect(shortUnitName('Waipori 2A/3/4', 'Waipori')).toBe('2A/3/4')
    expect(shortUnitName('Ōtāhuhu A', 'Ōtāhuhu')).toBe('A')
  })
})

describe('isCombinedOver', () => {
  const dated = (node: string, commissioned: string, decomissioned?: string, combines?: string[]): Unit => ({
    ...unit(node, node),
    commissioned,
    decomissioned,
    combines,
  })
  // Southdown's two units were only ever metered together, and retired with their combined unit
  const swn0 = dated('SWN2201 SWN0', '1995-12-31T11:00:00.000Z', '2016-01-19T10:59:59.000Z')
  const swn5 = dated('SWN2201 SWN5', '2006-12-31T11:00:00.000Z', '2016-01-19T10:59:59.000Z')
  const southdown = dated('SWN2201 southdown', '1995-12-31T11:00:00.000Z', '2016-01-19T10:59:59.000Z', [
    swn0.node,
    swn5.node,
  ])
  // Huntly's Rankine units were metered on their own once their combined unit retired
  const hly1 = dated('HLY2201 HLY1', '1981-12-31T11:00:00.000Z')
  const huntly14 = dated('HLY2201 huntly_1_4', '1981-12-31T11:00:00.000Z', '1999-12-31T10:59:59.999Z', [hly1.node])
  const units = [swn0, swn5, southdown, hly1, huntly14]

  it('finds the unit combining another', () => {
    expect(combinedUnitOf(swn5, units)).toBe(southdown)
    expect(combinedUnitOf(southdown, units)).toBeUndefined()
  })

  it('leaves out units only in service within the unit combining them', () => {
    expect(isCombinedOver(swn0, units)).toBe(true)
    expect(isCombinedOver(swn5, units)).toBe(true)
    expect(isCombinedOver(southdown, units)).toBe(false)
  })

  it('keeps units in service after the unit combining them, over a period reaching then', () => {
    expect(isCombinedOver(hly1, units)).toBe(false)
    const in1998 = { from: nzLocalMs('1998-01-01T00:00:00'), to: nzLocalMs('1998-12-31T23:59:59') }
    expect(isCombinedOver(hly1, units, in1998)).toBe(true)
    expect(isCombinedOver(hly1, units, { from: in1998.from, to: nzLocalMs('2001-01-01T00:00:00') })).toBe(false)
  })
})

describe('unitsByNode', () => {
  it('indexes every unit across generators by its node', () => {
    const ati0 = unit('ATI2201 ATI0', 'Aratiatia 1')
    const wkm0 = unit('WKM2201 WKM0', 'Whakamaru 1')
    const wkm1 = unit('WKM2201 WKM1', 'Whakamaru 2')
    const index = unitsByNode([generator('ATI', [ati0]), generator('WKM', [wkm0, wkm1])])
    expect([...index.entries()]).toEqual([
      ['ATI2201 ATI0', ati0],
      ['WKM2201 WKM0', wkm0],
      ['WKM2201 WKM1', wkm1],
    ])
  })

  it('maps a node shared by several units to the first', () => {
    const first = unit('KPU0661 KPU0', 'First')
    const second = unit('KPU0661 KPU0', 'Second')
    expect(unitsByNode([generator('KPU', [first]), generator('KP2', [second])]).get('KPU0661 KPU0')).toBe(first)
  })

  it('handles no generators', () => {
    expect(unitsByNode([]).size).toBe(0)
  })
})

// Commissioned at 2:00pm on 21 July 2021 and decommissioned through 7:29:59.999pm
// on 5 September 2025, both NZST
const served = (extra: Partial<Unit> = {}): Unit => ({
  ...unit('LTN2201 TUR0', 'Turitea'),
  commissioned: '2021-07-21T02:00:00.000Z',
  decomissioned: '2025-09-05T07:29:59.999Z',
  ...extra,
})
const nz = (ts: string) => nzLocalMs(ts)

describe('inServiceAt', () => {
  it('is in service from its commissioning through its decommissioning, in NZ time', () => {
    expect(inServiceAt(served(), nz('2021-07-21T13:59:59'))).toBe(false)
    expect(inServiceAt(served(), nz('2021-07-21T14:00:00'))).toBe(true)
    expect(inServiceAt(served(), nz('2025-09-05T19:29:59') + 999)).toBe(true)
    expect(inServiceAt(served(), nz('2025-09-05T19:30:00'))).toBe(false)
  })

  it('stays in service without a decommissioning date', () => {
    expect(inServiceAt(served({ decomissioned: undefined }), nz('2030-01-01T00:00:00'))).toBe(true)
  })

  it("isn't in service without a commissioning date, as it's still being commissioned", () => {
    expect(inServiceAt(served({ commissioned: undefined, decomissioned: undefined }), nz('2030-01-01T00:00:00'))).toBe(
      false,
    )
  })

  it("is in service since EMI's register began for plant that predates it", () => {
    expect(inServiceAt(served({ commissioned: '1899-12-31T12:30:00.000Z' }), nz('1996-10-01T00:00:00'))).toBe(true)
  })
})

describe('inServiceDuring', () => {
  const day = (date: string) => ({ from: nz(`${date}T00:00:00`), to: nz(`${date}T23:59:59`) })

  it('is in service for any part of the period', () => {
    expect(inServiceDuring(served(), day('2021-07-20'))).toBe(false)
    expect(inServiceDuring(served(), day('2021-07-21'))).toBe(true)
    expect(inServiceDuring(served(), day('2025-09-05'))).toBe(true)
    expect(inServiceDuring(served(), day('2025-09-06'))).toBe(false)
  })

  it("isn't in service in any period while it's still being commissioned", () => {
    expect(inServiceDuring(served({ commissioned: undefined, decomissioned: undefined }), day('2026-10-13'))).toBe(
      false,
    )
  })
})

describe('isDecommissioned', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is decommissioned once its decommissioning has passed', () => {
    vi.setSystemTime('2025-09-05T07:29:59.999Z')
    expect(isDecommissioned(served())).toBe(false)
    vi.setSystemTime('2025-09-05T07:30:00.000Z')
    expect(isDecommissioned(served())).toBe(true)
    expect(isDecommissioned(served({ decomissioned: undefined }))).toBe(false)
  })
})

describe('serviceChangesBetween', () => {
  it('finds where units come into service, and the instant after they go out', () => {
    const changes = serviceChangesBetween([served()], nz('2021-01-01T00:00:00'), nz('2026-01-01T00:00:00'))
    expect(changes).toEqual([nz('2021-07-21T14:00:00'), nz('2025-09-05T19:30:00')])
  })

  it('leaves out changes outside the window, and units still being commissioned', () => {
    expect(serviceChangesBetween([served()], nz('2022-01-01T00:00:00'), nz('2023-01-01T00:00:00'))).toEqual([])
    expect(
      serviceChangesBetween(
        [served({ commissioned: undefined, decomissioned: undefined })],
        nz('2022-01-01T00:00:00'),
        nz('2030-01-01T00:00:00'),
      ),
    ).toEqual([])
  })
})

describe('isRetired', () => {
  it('is retired once all of its units are decommissioned', () => {
    const g = generator('TUR', [served(), served({ node: 'LTN2201 TUR1', decomissioned: '2025-09-06T00:00:00.000Z' })])
    expect(isRetired(g, nz('2025-09-05T20:00:00'))).toBe(false)
    expect(isRetired(g, nz('2025-09-07T00:00:00'))).toBe(true)
  })

  it("isn't retired while a unit is still being commissioned", () => {
    const commissioning = served({ node: 'LTN2201 TUR1', commissioned: undefined, decomissioned: undefined })
    expect(isRetired(generator('TUR', [commissioning]), nz('2026-10-13T00:00:00'))).toBe(false)
    expect(isRetired(generator('TUR', [served(), commissioning]), nz('2026-10-13T00:00:00'))).toBe(false)
  })
})

describe('isCommissioning', () => {
  it("is commissioning without a commissioning date, or before it's due", () => {
    expect(
      isCommissioning(served({ commissioned: undefined, decomissioned: undefined }), nz('2030-01-01T00:00:00')),
    ).toBe(true)
    expect(isCommissioning(served(), nz('2021-07-21T13:59:59'))).toBe(true)
    expect(isCommissioning(served(), nz('2021-07-21T14:00:00'))).toBe(false)
  })
})

describe('unitLabel', () => {
  it('marks a unit still being commissioned, and a charging unit', () => {
    const commissioning = served({ name: 'Solar', commissioned: undefined, decomissioned: undefined })
    expect(unitLabel(commissioning)).toBe('Solar (commissioning)')
    expect(unitLabel({ ...commissioning, fuelCode: 'BESS-C' })).toBe('Solar (charging, commissioning)')
    expect(unitLabel(served({ name: 'Turitea', decomissioned: undefined }))).toBe('Turitea')
  })
})
