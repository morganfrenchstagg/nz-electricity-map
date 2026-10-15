import { describe, expect, it } from 'vitest'
import { shortUnitName, unitsByNode } from './generators'
import type { Generator, Unit } from '../types'

const unit = (node: string, name: string): Unit => ({ name, unitCode: name, node, capacity: 10, fuel: 'Hydro', fuelCode: 'hyd' })

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
