import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Highcharts from 'highcharts'
import type { OutageData, OutageRecord } from '../api'
import type { Generator, RecentData, Unit } from '../types'
import type { ChartRow } from './chart'
import { fuelColour } from './colours'
import { createGeneratorAdapter, createMultiGeneratorAdapter } from './generatorAdapter'
import { nzLocalMs } from './time'
import type { Period } from './time'

const FUEL_CODES: Record<string, string> = {
  Hydro: 'HYD', Wind: 'WIN', Solar: 'SOL', 'Battery (Discharging)': 'BESS', 'Battery (Charging)': 'BESS-C',
}

// In service since EMI's register began, as most units are, unless given other dates
function unit(node: string, name: string, fuel: string, capacity: number, extra: Partial<Unit> = {}): Unit {
  return { node, name, unitCode: node.split(' ')[1], capacity, fuel, fuelCode: FUEL_CODES[fuel], commissioned: '1899-12-31T12:30:00.000Z', ...extra }
}

function generator(site: string, name: string, units: Unit[], extra: Partial<Generator> = {}): Generator {
  return { site, name, units, location: { lat: -38.4, long: 176 }, gridZone: '5', island: 'NI', operator: 'Mercury', ...extra }
}

// Two units of 42 MW normally, 50 MW installed. Outages come off the installed figure.
const ATI = generator('ATI', 'Ātiamuri', [
  unit('ATI2201 ATI1', 'Unit 2', 'Hydro', 42, { installedCapacity: 50 }),
  unit('ATI2201 ATI0', 'Unit 1', 'Hydro', 42, { installedCapacity: 50 }),
])
const ATI_UNITS = new Set(['ATI2201 ATI0', 'ATI2201 ATI1'])
const UNIT_1 = new Set(['ATI2201 ATI0'])
const TAP = generator('TAP', 'Te Āpiti', [unit('WDV1101 TAP0', 'Te Āpiti', 'Wind', 90)], { operator: 'Meridian' })
// A battery's charging unit is listed with negative capacity, as it draws power
const BAT = generator('BAT', 'Rotohiko', [
  unit('BAT0331 BAT0', 'Battery', 'Battery (Discharging)', 100),
  unit('BAT0331 BAT1', 'Battery', 'Battery (Charging)', -80),
])
const BAT_UNITS = new Set(['BAT0331 BAT0', 'BAT0331 BAT1'])
// A battery beside a solar farm, as at Ruakākā
const HYB = generator('HYB', 'Hybrid', [
  unit('HYB0331 HYB0', 'Solar', 'Solar', 20),
  unit('HYB0331 HYB1', 'Battery', 'Battery (Discharging)', 10),
  unit('HYB0331 HYB2', 'Battery', 'Battery (Charging)', -10),
])
// The first unit moved substation at 2pm on 25 June 2026 (NZST); the second retired outright then
const MOVED_AT = '2026-06-25T02:00:00.000Z'
const PTA = generator('PTA', 'Pātea', [
  unit('HWA1101 PTA0', 'Pātea', 'Hydro', 31, { decomissioned: '2026-06-25T01:59:59.999Z' }),
  unit('HWA1101 PTA1', 'Pātea 2', 'Hydro', 10, { decomissioned: '2026-06-25T01:59:59.999Z' }),
  unit('OHA0331 PTA0', 'Pātea', 'Hydro', 31, { commissioned: MOVED_AT }),
])
const PTA_UNITS = new Set(PTA.units.map((u) => u.node))

// A day in NZ, as periodOf has it for a picked date
function day(date: string): Period {
  const from = nzLocalMs(`${date}T00:00:00`)
  return { from, to: from + 24 * 60 * 60 * 1000 - 1 }
}

// An outage on 13 October 2026 (NZDT) between two times of day, as the API sends it
function outage(from: string, to: string, mw: number, block = 'ATI_STN'): OutageRecord {
  return { outageBlock: block, timeStart: `2026-10-13T${from}:00+13:00`, timeEnd: `2026-10-13T${to}:00+13:00`, mwattLost: mw }
}

// At 2:30pm, Unit 1 is 20 MW down until 4pm, and Unit 2 goes fully out from 3pm to 5pm
const ATI_OUTAGES: OutageData = {
  'ATI2201 ATI0': [outage('12:00', '16:00', 20)],
  'ATI2201 ATI1': [outage('15:00', '17:00', 50)],
}

// A time of day on 13 October 2026, as the chart's x values are
function at(time: string): number {
  return nzLocalMs(`2026-10-13T${time}:00`)
}

// Chart rows at the given times of day on 13 October 2026; only the first and last matter
function rows(...times: string[]): ChartRow[] {
  return times.map((t) => ({ time: `2026-10-13T${t}:00` }))
}

function dataFor(series: string[]): RecentData {
  return { series, data: [], pricing: [] }
}

function stepPoints(series: Highcharts.SeriesOptionsType | null) {
  return (series as Highcharts.SeriesLineOptions).data!.map((p) => {
    const { x, y } = p as Highcharts.PointOptionsObject
    return [x, y] as const
  })
}

function plotLines(options: Highcharts.YAxisOptions) {
  return (options.plotLines ?? []).map((l) => [l.value, l.label?.text] as const)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-13T01:30:00Z') // 2:30pm NZDT
})
afterEach(() => { vi.useRealTimers() })

// The two adapters share these rules. Each adapter reads the time once, when it's created.
describe.each([
  ['createGeneratorAdapter', (outages: OutageData | null) => createGeneratorAdapter(ATI, outages)],
  ['createMultiGeneratorAdapter', (outages: OutageData | null) => createMultiGeneratorAdapter([ATI], outages)],
])('%s outages', (_, adapterFor) => {
  it("is the units' normal maximum without outage data", () => {
    const adapter = adapterFor(null)
    expect(adapter.capacityMW(ATI_UNITS)).toBe(84)
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(0)
  })

  it('takes an ongoing outage off the installed capacity, not the normal maximum', () => {
    const adapter = adapterFor(ATI_OUTAGES)
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(20)
    expect(adapter.unitOutageMW('ATI2201 ATI1')).toBe(0)
    expect(adapter.capacityMW(UNIT_1)).toBe(30)
    expect(adapter.capacityMW(ATI_UNITS)).toBe(72)
    expect(adapter.normalCapacityMW(ATI_UNITS)).toBe(84)
  })

  it('adds up overlapping outages on different blocks, up to the installed capacity', () => {
    const adapter = adapterFor({ 'ATI2201 ATI0': [outage('12:00', '16:00', 30, 'ATI_1'), outage('14:00', '15:00', 30)] })
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(50)
    expect(adapter.capacityMW(UNIT_1)).toBe(0)
  })

  it('counts overlapping outages on the same block once, at the largest', () => {
    const adapter = adapterFor({ 'ATI2201 ATI0': [outage('12:00', '16:00', 30), outage('14:00', '15:00', 20), outage('13:00', '17:00', 30)] })
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(30)
    expect(adapter.capacityMW(UNIT_1)).toBe(20)
  })

  it("ignores outages that haven't started or have ended, on NZ time", () => {
    const adapter = adapterFor({ 'ATI2201 ATI0': [outage('08:00', '13:30', 20), outage('15:00', '16:00', 20)] })
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(0)
    expect(adapter.capacityMW(UNIT_1)).toBe(42)
  })

  it('counts an outage from its start, but not at its end', () => {
    vi.setSystemTime('2026-10-12T23:00:00Z') // noon NZDT
    expect(adapterFor(ATI_OUTAGES).unitOutageMW('ATI2201 ATI0')).toBe(20)
    vi.setSystemTime('2026-10-13T03:00:00Z') // 4pm NZDT
    const adapter = adapterFor(ATI_OUTAGES)
    expect(adapter.unitOutageMW('ATI2201 ATI0')).toBe(0)
    expect(adapter.capacityMW(UNIT_1)).toBe(42)
  })

  it('steps the capacity line at each outage change within the chart', () => {
    const series = adapterFor(ATI_OUTAGES).capacitySeries(rows('14:00', '18:00'), ATI_UNITS)
    expect(stepPoints(series)).toEqual([
      [at('14:00'), 72], [at('15:00'), 30], [at('16:00'), 42], [at('17:00'), 84], [at('18:00'), 84],
    ])
  })

  it('steps for the units shown, and only where their capacity changes', () => {
    const outages = { ...ATI_OUTAGES, 'ATI2201 ATI0': [outage('12:00', '16:00', 20), outage('16:00', '17:00', 20)] }
    const series = adapterFor(outages).capacitySeries(rows('14:00', '18:00'), UNIT_1)
    expect(stepPoints(series)).toEqual([[at('14:00'), 30], [at('17:00'), 42], [at('18:00'), 42]])
  })

  it('labels the end of the capacity line', () => {
    const series = adapterFor(ATI_OUTAGES).capacitySeries(rows('14:00', '18:00'), ATI_UNITS) as Highcharts.SeriesLineOptions
    const labels = series.data!.map((p) => (p as Highcharts.PointOptionsObject).dataLabels as Highcharts.DataLabelsOptions)
    expect(labels.map((l) => l.enabled)).toEqual([false, false, false, false, true])
    expect(labels[4].format).toBe('Capacity: 84 MW')
  })

  it('has no capacity line without outage data, rows or units', () => {
    expect(adapterFor(null).capacitySeries(rows('14:00', '18:00'), ATI_UNITS)).toBeNull()
    expect(adapterFor(ATI_OUTAGES).capacitySeries([], ATI_UNITS)).toBeNull()
    expect(adapterFor(ATI_OUTAGES).capacitySeries(rows('14:00', '18:00'), new Set())).toBeNull()
  })
})

describe('createGeneratorAdapter', () => {
  it('names the generator and its operators', () => {
    expect(createGeneratorAdapter(ATI, null)).toMatchObject({ title: 'Ātiamuri', subtitle: 'Mercury', showLegend: false })
    expect(createGeneratorAdapter({ ...ATI, secondaryOperator: 'Contact' }, null).subtitle).toBe('Mercury / Contact')
  })

  it('lists each fuel once, counting a battery as one', () => {
    expect(createGeneratorAdapter(HYB, null).subtitleFuels).toEqual([
      { label: 'Battery', colour: fuelColour('Battery') },
      { label: 'Solar', colour: fuelColour('Solar') },
    ])
  })

  it('charts the units in service that have data, by fuel then name', () => {
    const adapter = createGeneratorAdapter(ATI, null)
    expect(adapter.getCodes(dataFor(['ATI2201 ATI1', 'WKM2201 WKM0', 'ATI2201 ATI0']))).toEqual(['ATI2201 ATI0', 'ATI2201 ATI1'])
    expect(adapter.getCodes(dataFor(['ATI2201 ATI1']))).toEqual(['ATI2201 ATI1'])
  })

  it('charts a moved unit under its current node, and retired units only in their history', () => {
    const adapter = createGeneratorAdapter(PTA, null)
    const data = dataFor(['HWA1101 PTA0', 'HWA1101 PTA1', 'OHA0331 PTA0'])
    expect(adapter.movedNodes).toEqual({ 'HWA1101 PTA0': 'OHA0331 PTA0' })
    expect(adapter.queryNodes).toEqual(['HWA1101 PTA0', 'HWA1101 PTA1', 'OHA0331 PTA0'])
    expect(adapter.getCodes(data)).toEqual(['OHA0331 PTA0'])
    expect(adapter.getCodes(data, true)).toEqual(['OHA0331 PTA0', 'HWA1101 PTA1'])
    // Whose offers are under whichever node the unit had at the time
    expect(adapter.unitCodes).toEqual(['HWA1101 PTA0', 'OHA0331 PTA0', 'HWA1101 PTA1'])
  })

  it('charts the units in service at any time in its period', () => {
    const data = dataFor(['HWA1101 PTA0', 'HWA1101 PTA1', 'OHA0331 PTA0'])
    expect(createGeneratorAdapter(PTA, null, day('2026-06-24')).getCodes(data)).toEqual(['HWA1101 PTA0', 'HWA1101 PTA1'])
    // The day it moved, it has both nodes' data
    expect(createGeneratorAdapter(PTA, null, day('2026-06-25')).getCodes(data)).toEqual(['HWA1101 PTA0', 'OHA0331 PTA0', 'HWA1101 PTA1'])
    expect(createGeneratorAdapter(PTA, null, day('2026-06-26')).getCodes(data)).toEqual(['OHA0331 PTA0'])
  })

  it('counts the capacity of the units in service at the end of its period', () => {
    expect(createGeneratorAdapter(PTA, null, day('2026-06-24')).capacityMW(PTA_UNITS)).toBe(41)
    const movingDay = createGeneratorAdapter(PTA, null, day('2026-06-25'))
    expect(movingDay.capacityMW(PTA_UNITS)).toBe(31)
    expect(movingDay.normalCapacityMW(PTA_UNITS)).toBe(31)
    expect(plotLines(movingDay.yAxisOptions(PTA_UNITS))).toEqual([[31, 'Capacity: 31 MW']])
  })

  it('counts no outage on a unit out of service', () => {
    const outages = { 'HWA1101 PTA0': [{ outageBlock: 'PTA_1', timeStart: '2026-06-25T00:00:00+12:00', timeEnd: '2026-06-27T00:00:00+12:00', mwattLost: 31 }] }
    expect(createGeneratorAdapter(PTA, outages, day('2026-06-25')).unitOutageMW('HWA1101 PTA0')).toBe(0)
  })

  it('steps the capacity line as units come into and go out of service', () => {
    const afternoon = [{ time: '2026-06-25T12:00:00' }, { time: '2026-06-25T16:00:00' }]
    const series = createGeneratorAdapter(PTA, {}, day('2026-06-25')).capacitySeries(afternoon, PTA_UNITS)
    const ms = (time: string) => nzLocalMs(`2026-06-25T${time}:00`)
    expect(stepPoints(series)).toEqual([[ms('12:00'), 41], [ms('14:00'), 31], [ms('16:00'), 31]])
    // And reaches as high as the units in service ever were
    expect(createGeneratorAdapter(PTA, {}, day('2026-06-25')).yAxisOptions(PTA_UNITS, afternoon).softMax).toBe(42)
  })

  it("leaves out a unit still being commissioned, which has no commissioning date yet", () => {
    const RUK = generator('RUK', 'Ruakākā', [
      unit('BRB0331 RUK0', 'Battery', 'Battery (Discharging)', 100),
      unit('BRB0331 RUS0', 'Solar', 'Solar', 130, { commissioned: undefined }),
    ])
    const adapter = createGeneratorAdapter(RUK, null)
    expect(adapter.getCodes(dataFor(['BRB0331 RUK0', 'BRB0331 RUS0']))).toEqual(['BRB0331 RUK0'])
    expect(adapter.capacityMW(new Set(['BRB0331 RUK0', 'BRB0331 RUS0']))).toBe(100)
  })

  it("charts a unit still being commissioned once it's dispatching in the live views, without its capacity", () => {
    const RUK = generator('RUK', 'Ruakākā', [
      unit('BRB0331 RUK0', 'Battery', 'Battery (Discharging)', 100),
      unit('BRB0331 RUS0', 'Solar', 'Solar', 130, { commissioned: undefined }),
    ])
    const units = new Set(['BRB0331 RUK0', 'BRB0331 RUS0'])
    const adapter = createGeneratorAdapter(RUK, {}, undefined, true)
    expect(adapter.getCodes(dataFor(['BRB0331 RUK0', 'BRB0331 RUS0']))).toEqual(['BRB0331 RUK0', 'BRB0331 RUS0'])
    expect(adapter.labelFor('BRB0331 RUS0')).toBe('Solar (commissioning)')
    expect(adapter.capacityMW(units)).toBe(100)
    expect(adapter.normalCapacityMW(units)).toBe(100)
    expect(stepPoints(adapter.capacitySeries(rows('14:00', '18:00'), units))).toEqual([[at('14:00'), 100], [at('18:00'), 100]])
    // Not until it's dispatching
    expect(adapter.getCodes(dataFor(['BRB0331 RUK0']))).toEqual(['BRB0331 RUK0'])
    // Nor together with other generators outside the live views
    expect(createMultiGeneratorAdapter([RUK, TAP], null).getCodes(dataFor(['BRB0331 RUS0', 'WDV1101 TAP0']))).toEqual(['WDV1101 TAP0'])
    expect(createMultiGeneratorAdapter([RUK, TAP], null, undefined, true).getCodes(dataFor(['BRB0331 RUS0', 'WDV1101 TAP0']))).toEqual(['BRB0331 RUS0', 'WDV1101 TAP0'])
  })

  it("names a generator's fuels for a day before it was in service", () => {
    expect(createGeneratorAdapter(PTA, null, day('1990-01-01')).subtitleFuels).toEqual([{ label: 'Hydro', colour: fuelColour('Hydro') }])
  })

  it("labels units by name, marking a battery's charging", () => {
    const adapter = createGeneratorAdapter(BAT, null)
    expect(adapter.labelFor('BAT0331 BAT0')).toBe('Battery')
    expect(adapter.labelFor('BAT0331 BAT1')).toBe('Battery (charging)')
    // Codes it doesn't know: a generator's unit, or the code itself
    expect(adapter.labelFor('XYZ2201 XYZ0')).toBe('XYZ0')
    expect(adapter.labelFor('XYZ2201')).toBe('XYZ2201')
  })

  it('colours units by fuel', () => {
    const adapter = createGeneratorAdapter(ATI, null)
    expect(adapter.colourFor('ATI2201 ATI0')).toBe(fuelColour('Hydro'))
    expect(adapter.colourFor('XYZ2201 XYZ0')).toBe('')
  })

  describe('yAxisOptions', () => {
    it('draws a capacity line without outage data', () => {
      const options = createGeneratorAdapter(ATI, null).yAxisOptions(ATI_UNITS, rows('14:00', '18:00'))
      expect(plotLines(options)).toEqual([[84, 'Capacity: 84 MW']])
      expect(options).toMatchObject({ softMin: 0, softMax: 85 })
    })

    it("leaves capacity to the step line once outages load, and fits the line's highest point", () => {
      const adapter = createGeneratorAdapter(ATI, ATI_OUTAGES)
      const wholeAfternoon = adapter.yAxisOptions(ATI_UNITS, rows('14:00', '18:00'))
      expect(plotLines(wholeAfternoon)).toEqual([])
      expect(wholeAfternoon.softMax).toBe(85)
      // Before Unit 2 comes back at 5pm, the most is 72 MW, at 2pm
      expect(adapter.yAxisOptions(ATI_UNITS, rows('14:00', '16:30')).softMax).toBe(73)
    })

    it("draws a battery's discharge and charge capacity either side of 0", () => {
      const adapter = createGeneratorAdapter(BAT, null)
      const options = adapter.yAxisOptions(undefined, rows('14:00', '18:00'))
      expect(plotLines(options)).toEqual([[100, 'Discharge: 100 MW'], [-80, 'Charge: 80 MW']])
      expect(options.softMin).toBe(-81)
      // Charging draws power, so it isn't capacity
      expect(adapter.capacityMW(BAT_UNITS)).toBe(100)
    })

    it("keeps a battery's charge line once outages load, as the step line leaves charging out", () => {
      const adapter = createGeneratorAdapter(BAT, {})
      const options = adapter.yAxisOptions(BAT_UNITS, rows('14:00', '18:00'))
      expect(plotLines(options)).toEqual([[-80, 'Charge: 80 MW']])
      expect(options).toMatchObject({ softMin: -81, softMax: 101 })
      expect(stepPoints(adapter.capacitySeries(rows('14:00', '18:00'), BAT_UNITS))).toEqual([[at('14:00'), 100], [at('18:00'), 100]])
    })

    it('takes an outage on charging off the charge line', () => {
      const options = createGeneratorAdapter(BAT, { 'BAT0331 BAT1': [outage('12:00', '16:00', 30, 'BAT_1')] }).yAxisOptions(BAT_UNITS, rows('14:00', '18:00'))
      expect(plotLines(options)).toEqual([[-50, 'Charge: 50 MW']])
    })

    it('only charts discharge capacity as such for batteries alone', () => {
      expect(plotLines(createGeneratorAdapter(HYB, null).yAxisOptions(undefined, rows('14:00', '18:00'))))
        .toEqual([[30, 'Capacity: 30 MW'], [-10, 'Charge: 10 MW']])
      // Without its charging unit, a battery's discharge is all it has
      expect(plotLines(createGeneratorAdapter(BAT, null).yAxisOptions(new Set(['BAT0331 BAT0']), rows('14:00', '18:00'))))
        .toEqual([[100, 'Capacity: 100 MW']])
    })

    it('labels the step line as discharge for a battery', () => {
      const series = createGeneratorAdapter(BAT, {}).capacitySeries(rows('14:00', '18:00'), BAT_UNITS) as Highcharts.SeriesLineOptions
      expect(((series.data![1] as Highcharts.PointOptionsObject).dataLabels as Highcharts.DataLabelsOptions).format).toBe('Discharge: 100 MW')
    })
  })

  it("counts no outage on a battery's charging unit when it has none", () => {
    expect(createGeneratorAdapter(BAT, {}).unitOutageMW('BAT0331 BAT1')).toBe(0)
    // So it doesn't offset an outage on another unit, as GeneratorPanel adds them up
    const adapter = createGeneratorAdapter(BAT, { 'BAT0331 BAT0': [outage('12:00', '16:00', 40, 'BAT_0')] })
    expect([...BAT_UNITS].reduce((sum, code) => sum + adapter.unitOutageMW(code), 0)).toBe(40)
  })
})

describe('createMultiGeneratorAdapter', () => {
  it('names up to two generators, then counts the rest', () => {
    expect(createMultiGeneratorAdapter([ATI, TAP], null).title).toBe('Ātiamuri, Te Āpiti')
    expect(createMultiGeneratorAdapter([ATI, TAP, BAT], null).title).toBe('Ātiamuri +2 more')
  })

  it('lists each operator once, with a legend for the units', () => {
    expect(createMultiGeneratorAdapter([ATI, TAP, PTA], null)).toMatchObject({ subtitle: 'Mercury, Meridian', showLegend: true })
  })

  it('labels units with their generator, unless the unit is named after it', () => {
    const adapter = createMultiGeneratorAdapter([ATI, TAP, BAT], null)
    expect(adapter.labelFor('ATI2201 ATI0')).toBe('Ātiamuri — Unit 1')
    expect(adapter.labelFor('WDV1101 TAP0')).toBe('Te Āpiti')
    expect(adapter.labelFor('BAT0331 BAT1')).toBe('Rotohiko — Battery (charging)')
    expect(adapter.labelFor('XYZ2201 XYZ0')).toBe('XYZ2201 XYZ0')
  })

  it("charts every generator's units in service together, by fuel then name", () => {
    const adapter = createMultiGeneratorAdapter([ATI, TAP, BAT], null)
    const data = dataFor(['WDV1101 TAP0', 'ATI2201 ATI1', 'BAT0331 BAT1', 'ATI2201 ATI0', 'BAT0331 BAT0'])
    // A battery's charging sorts last, after every generating fuel
    expect(adapter.getCodes(data)).toEqual(['BAT0331 BAT0', 'ATI2201 ATI0', 'ATI2201 ATI1', 'WDV1101 TAP0', 'BAT0331 BAT1'])
    expect(adapter.unitCodes).toEqual(['BAT0331 BAT0', 'ATI2201 ATI0', 'ATI2201 ATI1', 'WDV1101 TAP0', 'BAT0331 BAT1'])
  })

  it("collects every generator's moved units", () => {
    const adapter = createMultiGeneratorAdapter([ATI, PTA], null)
    expect(adapter.movedNodes).toEqual({ 'HWA1101 PTA0': 'OHA0331 PTA0' })
    expect(adapter.getCodes(dataFor(['HWA1101 PTA0', 'HWA1101 PTA1', 'OHA0331 PTA0']), true)).toEqual(['OHA0331 PTA0', 'HWA1101 PTA1'])
  })

  it('fits the axis to the combined capacity, without capacity lines', () => {
    const options = createMultiGeneratorAdapter([ATI, TAP], null).yAxisOptions(undefined, rows('14:00', '18:00'))
    expect(plotLines(options)).toEqual([])
    expect(options).toMatchObject({ softMin: 0, softMax: 175 })
    expect(createMultiGeneratorAdapter([ATI, BAT], null).yAxisOptions().softMin).toBe(-81)
  })
})
