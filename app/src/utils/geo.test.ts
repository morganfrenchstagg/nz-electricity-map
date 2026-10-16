import { describe, expect, it } from 'vitest'
import { generatorsToGeoJson, underConstructionToGeoJson } from './geo'
import { nzLocalMs } from './time'
import type { Generator, Unit } from '../types'
import type { UnderConstructionNode } from '../../../frontend/old/utilities/underConstruction'

const unit = (node: string, capacity: number, extra: Partial<Unit> = {}): Unit =>
  ({ name: node, unitCode: node.split(' ')[1], node, capacity, fuel: 'Wind', fuelCode: 'WIN', ...extra })

const generator = (site: string, units: Unit[]): Generator => ({
  site, name: site, units, location: { lat: -40, long: 175 }, gridZone: '1', island: 'NI', operator: 'Operator',
})

// Kaiwera Downs' second stage came into service at noon on 1 April 2026 (NZDT)
const KWD = generator('KWD', [
  unit('GOR0331 KWD0', 43, { commissioned: '2023-08-10T02:00:00.000Z' }),
  unit('KIW2201 KWE0', 155, { commissioned: '2026-03-31T23:30:00.000Z' }),
])
// Taranaki Combined Cycle stopped at 7:30pm on 5 September 2025 (NZST)
const TCC = generator('TCC', [unit('SFD2201 SPL0', 350, { decomissioned: '2025-09-05T07:30:00.000Z' })])

const day = (date: string) => ({ from: nzLocalMs(`${date}T00:00:00`), to: nzLocalMs(`${date}T23:59:59`) })
const sites = (collection: GeoJSON.FeatureCollection) => collection.features.map((f) => [f.properties!.site, f.properties!.totalCapacityMW])

describe('generatorsToGeoJson', () => {
  it('maps the generators in service during the period, counting the capacity of their units in service', () => {
    expect(sites(generatorsToGeoJson([KWD, TCC], day('2025-09-05')))).toEqual([['KWD', 43], ['TCC', 350]])
    expect(sites(generatorsToGeoJson([KWD, TCC], day('2025-09-06')))).toEqual([['KWD', 43]])
    expect(sites(generatorsToGeoJson([KWD, TCC], day('2026-04-01')))).toEqual([['KWD', 198]])
  })

  it('leaves off generators not yet in service', () => {
    expect(sites(generatorsToGeoJson([KWD], day('2023-08-09')))).toEqual([])
  })
})

describe('underConstructionToGeoJson', () => {
  const node = { name: 'Taranaki', site: 'TCC', fuel: 'Gas', operator: 'Contact', status: 'Consented' } as UnderConstructionNode

  it('maps a site under construction itself once its generator is off the map', () => {
    expect(underConstructionToGeoJson([node], [TCC], day('2025-09-05')).features).toHaveLength(0)
    expect(underConstructionToGeoJson([node], [TCC], day('2025-09-06')).features).toHaveLength(1)
  })
})
