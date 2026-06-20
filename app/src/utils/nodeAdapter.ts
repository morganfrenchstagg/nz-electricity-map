import type Highcharts from 'highcharts'
import type { Generator, RecentData, Substation } from '../types'
import type { ChartRow } from './chart'
import { substationCodes } from './chart'
import { fuelColour, voltageColour } from './colours'

function codeVoltageColour(code: string): string {
  if (code.length >= 4) {
    const kv = parseInt(code.slice(-4, -1), 10)
    return voltageColour(kv)
  }
  return voltageColour(NaN)
}

export interface NodeAdapter {
  title: string
  subtitle: string
  chartType: 'area' | 'line'
  getCodes(recent: RecentData): string[]
  labelFor(code: string): string
  colourFor(code: string, index: number): string
  transformValue(val: number): number
  yAxisOptions(): Highcharts.YAxisOptions
  extraSeries(rows: ChartRow[], codes: string[]): Highcharts.SeriesOptionsType[]
  stacking(numCodes: number): Highcharts.OptionsStackingValue | undefined
  showUnitSelector(numCodes: number): boolean
}

export function createGeneratorAdapter(generator: Generator): NodeAdapter {
  const activeUnits = generator.units.filter((u) => u.active !== false)
  const totalCapacity = activeUnits.reduce((sum, u) => sum + u.capacity, 0)

  return {
    title: generator.name,
    subtitle: generator.operator,
    chartType: 'area',

    getCodes(recent) {
      return activeUnits
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((u) => u.node)
        .filter((c) => recent.series.includes(c))
    },

    labelFor(code) {
      const unit = generator.units.find((u) => u.node === code)
      return unit ? unit.name : (code.includes(' ') ? code.split(' ')[1] : code)
    },

    colourFor(code, index) {
      const unit = generator.units.find((u) => u.node === code)
      return unit ? fuelColour(unit.fuel) : SUBSTATION_COLOURS[index % SUBSTATION_COLOURS.length]
    },

    transformValue(val) { return val },

    yAxisOptions() {
      return {
        title: { text: 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
        softMin: 0,
        softMax: totalCapacity + 1,
        plotLines: [{
          value: totalCapacity,
          color: '#999999',
          width: 1,
          dashStyle: 'Dash',
          label: {
            text: `Capacity: ${totalCapacity} MW`,
            style: { color: '#999999', fontSize: '10px' },
            align: 'right',
            x: -4,
          },
          zIndex: 3,
        }],
      }
    },

    extraSeries(_rows, _codes) { return [] },

    stacking(numCodes) { return numCodes > 1 ? 'normal' : undefined },

    showUnitSelector(numCodes) { return numCodes > 1 },
  }
}

export function createSubstationAdapter(substation: Substation, allGenerators: Generator[]): NodeAdapter {
  return {
    title: `${substation.description} Substation`,
    subtitle: substation.siteId,
    chartType: 'line',

    getCodes(recent) {
      return substationCodes(recent, substation.siteId)
    },

    labelFor(code) {
      if (code.includes(' ')) {
        for (const gen of allGenerators) {
          const unit = gen.units.find((u) => u.node === code)
          if (unit) return unit.name
        }
      }
      if (code.length >= 4) {
        const suffix = code.slice(-4)
        const voltage = parseInt(suffix.slice(0, 3), 10)
        const unit = parseInt(suffix.slice(3), 10)
        return `${voltage}kV - ${unit}`
      }
      return code.includes(' ') ? code.split(' ')[1] : code
    },

    colourFor(code, _index) {
      if (code.includes(' ')) {
        for (const gen of allGenerators) {
          const unit = gen.units.find((u) => u.node === code)
          if (unit) return fuelColour(unit.fuel)
        }
      }
      return codeVoltageColour(code)
    },

    transformValue(val) { return -val },

    yAxisOptions() {
      return {
        title: { text: 'Load (MW)', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
        softMin: 0,
        plotLines: [],
      }
    },

    extraSeries(rows, codes) {
      if (!codes.some((c) => c.includes(' '))) return []
      return [{
        type: 'line',
        name: 'Net',
        color: '#222222',
        lineWidth: 2,
        zIndex: 5,
        data: rows.map((row) => [
          new Date((row.time as string) + 'Z').getTime(),
          codes.reduce((sum, code) => sum + (-(row[code] as number)), 0),
        ]),
        marker: { enabled: false },
        animation: false,
      }]
    },

    stacking(_numCodes) { return undefined },

    showUnitSelector(_numCodes) { return false },
  }
}
