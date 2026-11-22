import { describe, expect, it } from 'vitest'
import type { Generator, Substation, Unit } from '../types'
import {
  annualFigures, changeOn, demandSummary, firstYear, generatorsSummary, gwh, lastFullYear, currentYear, ordinal, parseStats,
  pct, stationFigures, stationSummary, substationDemand, substationsSummary, sumNodes, yearLabel,
} from './annualStats'
import type { AnnualAggregates } from './annualStats'

function unit(overrides: Partial<Unit>): Unit {
  return { name: 'Unit', unitCode: 'U', node: 'XXX2201 U', capacity: 100, fuel: 'Hydro', fuelCode: 'HYD', commissioned: '1971-09-01T12:00:00.000Z', ...overrides }
}

function generator(site: string, name: string, units: Unit[]): Generator {
  return { site, name, operator: 'Operator', gridZone: 'SI', island: 'SI', location: { lat: 0, long: 0 }, units }
}

const manapouri = generator('MAN', 'Manapōuri', [unit({ node: 'MAN2201 MAN0', capacity: 800 })])
// A gas unit and a battery, whose charging unit draws power rather than generating it
const huntly = generator('HLY', 'Huntly', [
  unit({ node: 'HLY2201 HLY5', fuel: 'Gas', fuelCode: 'GAS', capacity: 403 }),
  unit({ node: 'HLY2201 HLY11', fuel: 'Battery (Discharging)', fuelCode: 'BESS', capacity: 100 }),
  unit({ node: 'HLY2201 HLY91', fuel: 'Battery (Charging)', fuelCode: 'BESS-C', capacity: -100 }),
])
const otahuhu = generator('OTA', 'Ōtāhuhu', [unit({ node: 'OTA2201 OTB', fuel: 'Gas', fuelCode: 'GAS', decomissioned: '2015-09-30T12:00:00.000Z' })])
const generators = [manapouri, huntly, otahuhu]

const substation = (siteId: string, description: string): Substation => ({ siteId, description, lat: 0, long: 0, type: 'ACSTN', gridZone: 1, island: 'north' })

// From August 1997, then 2014 to 2026, the year so far. MWh at each node:
// generators' positive, buses' negative where power was taken from them.
const YEARS = [1997, ...Array.from({ length: 13 }, (_, i) => 2014 + i)]
const SERIES: Record<string, (year: number) => number> = {
  'MAN2201 MAN0': (y) => ({ 1997: 2_000_000, 2015: 5_500_000, 2025: 4_552_000, 2026: 4_000_000 })[y] ?? 4_500_000,
  'HLY2201 HLY5': () => 2_000_000,
  'HLY2201 HLY11': (y) => ({ 2025: 10_000, 2026: 50_000 })[y] ?? 0,
  'HLY2201 HLY91': (y) => ({ 2025: -12_000, 2026: -60_000 })[y] ?? 0,
  'OTA2201 OTB': (y) => ({ 1997: 100_000, 2014: 100_000, 2015: 150_000 })[y] ?? 0,
  // A node the definitions don't have
  'XYZ2201 XYZ0': (y) => (y === 2025 ? 100_000 : 0),
  'HLY0331': (y) => ({ 2015: -300_000, 2025: -320_000 })[y] ?? -310_000,
  'OTA0221': () => -1_000_000,
}
const aggregates: AnnualAggregates = {
  series: Object.keys(SERIES),
  data: YEARS.map((y) => [`${y}-01-01`, ...Object.values(SERIES).map((mwh) => mwh(y))]),
}
const stats = parseStats(aggregates, 2026)
const figures = annualFigures(aggregates, generators, 2026)
const index = (year: number) => YEARS.indexOf(year)

describe('parseStats', () => {
  it('treats the first year, from August, and the current one as partial', () => {
    expect(stats.years).toEqual(YEARS)
    expect([...stats.partial]).toEqual([1997, 2026])
    expect(stats.years[lastFullYear(stats)]).toBe(2025)
    expect(stats.years[currentYear(stats)]).toBe(2026)
    expect(yearLabel(stats, 0)).toBe('1997 (Aug–Dec)')
    expect(yearLabel(stats, index(2026))).toBe('2026 so far')
    expect(yearLabel(stats, index(2025))).toBe('2025')
  })

  it('counts a node once however many units name it', () => {
    expect(sumNodes(stats, ['MAN2201 MAN0', 'MAN2201 MAN0'])[index(2025)]).toBe(4552)
  })

  it('starts a station\'s years at its first with any generation', () => {
    expect(firstYear([0, 0.01, 3, 4])).toBe(2)
    expect(firstYear([0, 0])).toBe(2)
  })
})

describe('annualFigures', () => {
  it('totals the grid\'s generation without batteries charging, and with nodes the definitions lack', () => {
    // 2025: Manapōuri's 4,552, Huntly's 2,000 and 10 discharged, and the unknown node's 100
    expect(figures.total[index(2025)]).toBe(6662)
  })

  it('ranks the stations that generated in the latest full year', () => {
    expect([...figures.rankBySite]).toEqual([['MAN', 1], ['HLY', 2]])
    expect([...stationFigures(stats, generators).rank.values()]).toEqual([1, 2])
  })
})

describe('stationSummary', () => {
  it('gives the latest full year with its share, the best full year and the year so far', () => {
    expect(generatorsSummary(figures, [manapouri])).toEqual({
      latest: { year: 2025, gwh: 4552, share: 4552 / 6662 },
      // 1997's partial year doesn't count, however large
      best: { year: 2015, gwh: 5500 },
      soFar: { year: 2026, gwh: 4000 },
      rank: 1,
    })
  })

  it('leaves out a battery\'s charging', () => {
    expect(generatorsSummary(figures, [huntly]).latest?.gwh).toBe(2010)
    expect(generatorsSummary(figures, [huntly]).soFar?.gwh).toBe(2050)
  })

  it('gives a retired station only its best year', () => {
    expect(generatorsSummary(figures, [otahuhu])).toEqual({ latest: null, best: { year: 2015, gwh: 150 }, soFar: null, rank: null })
  })

  it('sums stations picked together, without a rank', () => {
    const both = generatorsSummary(figures, [manapouri, huntly])
    expect(both.latest).toEqual({ year: 2025, gwh: 6562, share: 6562 / 6662 })
    expect(both.rank).toBeNull()
  })

  it('has no best year until a station has two full years', () => {
    const values = stats.years.map((y) => (y >= 2025 ? 10 : 0))
    expect(stationSummary(stats, values, figures.total, false).best).toBeNull()
  })
})

describe('demandSummary', () => {
  it('gives a substation\'s demand in the latest full year, and its change on ten years before', () => {
    expect(substationDemand(stats, 'HLY')[index(2025)]).toBe(320)
    expect(substationsSummary(figures, [substation('HLY', 'Huntly')])).toEqual({
      latest: { year: 2025, gwh: 320 },
      change: { year: 2015, fraction: 320 / 300 - 1 },
    })
  })

  it('sums substations picked together, each counted once', () => {
    const hly = substation('HLY', 'Huntly'), ota = substation('OTA', 'Ōtāhuhu')
    expect(substationsSummary(figures, [hly, ota, ota])?.latest.gwh).toBe(1320)
  })

  it('has nothing for a substation with no demand, and no change without ten years before', () => {
    expect(substationsSummary(figures, [substation('MAN', 'Manapōuri')])).toBeNull()
    expect(demandSummary(stats, stats.years.map((y) => (y >= 2020 ? 50 : 0)))?.change).toBeNull()
  })
})

describe('formatting', () => {
  it('writes GWh, shares and ranks as the built pages do', () => {
    expect(gwh(4552.4)).toBe('4,552 GWh')
    expect(gwh(12.34)).toBe('12.3 GWh')
    expect(pct(0.6833)).toBe('68.3%')
    expect(pct(0.0001)).toBe('under 0.1%')
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 113].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '113th'])
  })

  it('says how much demand changed', () => {
    expect(changeOn({ year: 2015, fraction: 0.0667 })).toBe('up 6.7% on 2015')
    expect(changeOn({ year: 2015, fraction: -0.04 })).toBe('down 4% on 2015')
    expect(changeOn({ year: 2015, fraction: 0.001 })).toBe('about the same as in 2015')
  })
})
