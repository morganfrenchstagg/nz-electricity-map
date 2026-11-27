import { describe, expect, it } from 'vitest'
import type { Generator, Substation, Unit } from '../types'
import {
  generatorCapacity,
  generatorHistoricPath,
  generatorPath,
  generatorTitle,
  isHistoricPath,
  nodeParamOfPath,
  slugify,
  stationKind,
  stationPath,
  substationPath,
} from './stationPaths'

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    name: 'U1',
    unitCode: 'X0',
    node: 'XXX2201 XXX0',
    capacity: 100,
    fuel: 'Hydro',
    fuelCode: 'HYD',
    ...overrides,
  }
}

function gen(name: string, site: string, units: Unit[] = [unit()]): Generator {
  return { site, name, units, location: { lat: -38, long: 176 }, gridZone: 'CNI', island: 'NI', operator: 'Mercury' }
}

function sub(description: string, siteId: string): Substation {
  return { siteId, description, lat: -36, long: 174, type: 'ACSTN', gridZone: 1, island: 'north' }
}

describe('slugify', () => {
  it('drops macrons and punctuation', () => {
    expect(slugify('Ngā Awa Pūrua')).toBe('nga-awa-purua')
    expect(slugify('Ōtāhuhu')).toBe('otahuhu')
    expect(slugify('Glenbrook-Ohurua')).toBe('glenbrook-ohurua')
    expect(slugify('Te Puna Mauri ō Omaru')).toBe('te-puna-mauri-o-omaru')
    expect(slugify(' Benmore AC ')).toBe('benmore-ac')
  })
})

describe('station paths', () => {
  const huntly = gen('Huntly', 'HLY')
  const ati = gen('Ātiamuri', 'ATI')
  const generators = [huntly, ati]
  const ota = sub('Ōtāhuhu', 'OTA')
  const substations = [ota]

  it('paths a station by its name', () => {
    expect(generatorPath(ati, generators)).toBe('/generator/atiamuri')
    expect(substationPath(ota, substations)).toBe('/substation/otahuhu')
    expect(stationPath({ kind: 'hvdc' }, generators, substations)).toBe('/hvdc')
  })

  it('has no path for several stations', () => {
    expect(stationPath({ kind: 'generators', generators }, generators, substations)).toBeNull()
  })

  it('adds the site code to names that slugify alike, whatever their order', () => {
    const a = gen('Te Rapa', 'TRP'),
      b = gen('Te Rāpa', 'TRB')
    expect(generatorPath(a, [a, b])).toBe('/generator/te-rapa-trp')
    expect(generatorPath(b, [b, a])).toBe('/generator/te-rapa-trb')
  })

  it('reads the node a path opens', () => {
    expect(nodeParamOfPath('/generator/huntly')).toBe('generator:huntly')
    expect(nodeParamOfPath('/generator/Huntly/')).toBe('generator:huntly')
    expect(nodeParamOfPath('/substation/otahuhu')).toBe('substation:otahuhu')
    expect(nodeParamOfPath('/hvdc')).toBe('hvdc')
    expect(nodeParamOfPath('/')).toBeNull()
    expect(nodeParamOfPath('/pipeline')).toBeNull()
    expect(nodeParamOfPath('/generator/a/b')).toBeNull()
    expect(nodeParamOfPath('/generator/%E0%A4%A')).toBeNull()
  })

  it("paths a generator at All to its history's page, and only a single generator", () => {
    expect(generatorHistoricPath(ati, generators)).toBe('/generator/atiamuri/historic')
    expect(stationPath({ kind: 'generator', generator: huntly }, generators, substations, true)).toBe(
      '/generator/huntly/historic',
    )
    expect(stationPath({ kind: 'substation', substation: ota }, generators, substations, true)).toBe(
      '/substation/otahuhu',
    )
    expect(stationPath({ kind: 'generators', generators }, generators, substations, true)).toBeNull()
  })

  it("reads a generator's history's path as its node", () => {
    expect(nodeParamOfPath('/generator/huntly/historic')).toBe('generator:huntly')
    expect(nodeParamOfPath('/generator/huntly/historic/')).toBe('generator:huntly')
    expect(isHistoricPath('/generator/huntly/historic')).toBe(true)
    expect(isHistoricPath('/generator/huntly')).toBe(false)
    expect(nodeParamOfPath('/substation/otahuhu/historic')).toBeNull()
    expect(isHistoricPath('/substation/otahuhu/historic')).toBe(false)
    expect(nodeParamOfPath('/generator/historic')).toBe('generator:historic')
  })
})

describe('capacity and kind', () => {
  it('counts a battery once, not its charging unit', () => {
    const g = gen('Rotohiko', 'RHO', [
      unit({ fuel: 'Battery (Discharging)', fuelCode: 'BESS', capacity: 35 }),
      unit({ fuel: 'Battery (Charging)', fuelCode: 'BESS-C', capacity: 35 }),
    ])
    expect(generatorCapacity(g)).toBe(35)
    expect(stationKind(g)).toBe('Battery')
  })

  it('leaves out decommissioned units, unless the station is retired', () => {
    const units = [unit({ capacity: 250 }), unit({ capacity: 50, decomissioned: '2020-01-01T00:00:00.000Z' })]
    expect(generatorCapacity(gen('A', 'AAA', units))).toBe(250)
    const retired = units.map((u) => ({ ...u, decomissioned: '2020-01-01T00:00:00.000Z' }))
    expect(generatorCapacity(gen('B', 'BBB', retired))).toBe(300)
  })

  it('names the kind from the largest unit', () => {
    const g = gen('Huntly', 'HLY', [
      unit({ fuel: 'Coal/Gas', capacity: 750 }),
      unit({ fuel: 'Battery (Discharging)', capacity: 100 }),
    ])
    expect(stationKind(g)).toBe('Power Station')
    expect(generatorTitle(g)).toBe('Huntly Power Station – Live Generation | NZ Electricity Map')
    expect(stationKind(gen('West Wind', 'WWD', [unit({ fuel: 'Wind' })]))).toBe('Wind Farm')
  })
})
