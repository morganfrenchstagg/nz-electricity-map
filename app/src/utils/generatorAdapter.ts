import type Highcharts from 'highcharts'
import type { Generator, RecentData, Unit } from '../types'
import type { ChartRow } from './chart'
import type { OutageData } from '../api'
import { isGeneratorCode, unitOfCode } from './chart'
import { fuelColour, fuelFamilies, FUEL_NAME_SORT_INDEX } from './colours'
import { formatMW } from './format'
import { inServiceAt, inServiceDuring, isCharging, isDecommissioned, serviceChangesBetween, unitLabel } from './generators'
import { unitCapacityAt, unitOutageMWAt } from './outages'
import { nzLocalMs, nzNowMs, outageMs } from './time'
import type { Period } from './time'

// A unit that moves substation (e.g. Pātea, from Hawera to Ōhangai in 2026) is
// listed twice under the same unit code: decommissioned at its old node and in
// service at its new one. Maps each such old node to the new one.
function movedNodesOf(units: Unit[]): Record<string, string> {
  const moved: Record<string, string> = {}
  for (const unit of units) {
    if (!isDecommissioned(unit)) continue
    const successors = units.filter((u) => !isDecommissioned(u) && u.unitCode === unit.unitCode)
    if (successors.length === 1) moved[unit.node] = successors[0].node
  }
  return moved
}

// A unit's capacity at `atMs`: none before it's commissioned or after it's
// decommissioned, and what any outage leaves in between
function capacityAt(unit: Unit, outages: OutageData | null, atMs: number): number {
  return inServiceAt(unit, atMs) ? unitCapacityAt(unit, outages, atMs) : 0
}

// The total capacity of the generating (not charging) units at `atMs`
function generatingCapacityAt(units: Unit[], outages: OutageData | null, atMs: number): number {
  return units.filter((u) => !isCharging(u)).reduce((sum, u) => sum + capacityAt(u, outages, atMs), 0)
}

// MW the charging units among `units` can draw at `atMs`. They're listed with
// negative capacity, so this is its size, for the chart to go that far below zero.
function chargeCapacityOf(units: Unit[], outages: OutageData | null, atMs: number): number {
  return units.filter(isCharging).reduce((sum, u) => sum + Math.abs(capacityAt(u, outages, atMs)), 0)
}

// Where the units' capacity can change within the chart: as their outages start
// and end, and as they come into or go out of service
function capacityChangesBetween(units: Unit[], outages: OutageData, from: number, to: number): number[] {
  const changes = serviceChangesBetween(units, from, to)
  for (const unit of units) {
    for (const rec of (outages[unit.node] ?? [])) {
      const s = outageMs(rec.timeStart)
      const e = outageMs(rec.timeEnd)
      if (s > from && s <= to) changes.push(s)
      if (e > from && e <= to) changes.push(e)
    }
  }
  return changes
}

// Over a chart with outage data, the most the units' capacity reaches; otherwise
// all of their normal maximums, as though every one was in service throughout
function peakCapacity(units: Unit[], outages: OutageData | null, rows?: ChartRow[]): number {
  if (!outages || !rows || rows.length === 0) {
    return units.filter((u) => !isCharging(u)).reduce((sum, u) => sum + u.capacity, 0)
  }
  const firstTime = nzLocalMs(rows[0].time)
  const lastTime = nzLocalMs(rows[rows.length - 1].time)
  return Math.max(...[firstTime, ...capacityChangesBetween(units, outages, firstTime, lastTime)]
    .map((t) => generatingCapacityAt(units, outages, t)))
}

// The capacity line over the chart's rows, stepping wherever capacity changes
function capacitySteps(units: Unit[], outages: OutageData, rows: ChartRow[]): [number, number][] {
  const firstTime = nzLocalMs(rows[0].time)
  const lastTime = nzLocalMs(rows[rows.length - 1].time)
  const sortedTs = [...new Set(capacityChangesBetween(units, outages, firstTime, lastTime))].sort((a, b) => a - b)

  // Only emitting a point when capacity actually changes
  const data: [number, number][] = [[firstTime, generatingCapacityAt(units, outages, firstTime)]]
  let prev = data[0][1]
  for (const t of sortedTs) {
    const cap = generatingCapacityAt(units, outages, t)
    if (Math.abs(cap - prev) > 0.001) {
      data.push([t, cap])
      prev = cap
    }
  }
  data.push([lastTime, prev])
  return data
}

// Until a view's period is given, the units in service now
function nowPeriod(): Period {
  const now = nzNowMs()
  return { from: now, to: now }
}

// The capacity line's label. Over batteries alone, charging below zero, it's
// their discharge capacity; with other fuels in, it's capacity as usual.
function capacityLabel(units: Unit[]): string {
  return units.some(isCharging) && units.every((u) => isCharging(u) || u.fuelCode === 'BESS') ? 'Discharge' : 'Capacity'
}

// What GeneratorPanel charts for one generator, or several picked together
export interface GeneratorAdapter {
  title: string
  subtitle: string
  // Dispatch data charts the units in service during the view's period; the
  // aggregate views pass includeRetired to chart every unit's history.
  getCodes(recent: RecentData, includeRetired?: boolean): string[]
  labelFor(code: string): string
  colourFor(code: string): string
  yAxisOptions(effectiveCodes?: Set<string>, rows?: ChartRow[]): Highcharts.YAxisOptions
  // Several generators' units are named in a legend
  showLegend: boolean
  capacityMW(effectiveCodes: Set<string>): number
  normalCapacityMW(effectiveCodes: Set<string>): number
  unitOutageMW(code: string): number
  capacitySeries(rows: ChartRow[], effectiveCodes: Set<string>): Highcharts.SeriesOptionsType | null
  subtitleFuels: { label: string; colour: string }[]
  // Node codes (or prefixes) to request from the aggregates API, retired units' included
  queryNodes: string[]
  // Old nodes of units that moved, mapped to their current node. The aggregate
  // views add their history into the current node's series (foldMovedNodes).
  movedNodes: Record<string, string>
}

// `period` is the view's (see periodOf), in the same "local time as UTC" convention
// used by outageMs, so comparisons with outage timestamps are consistent. Capacity
// is read at its end, beside the latest dispatch.
export function createGeneratorAdapter(generator: Generator, outages: OutageData | null, period = nowPeriod()): GeneratorAdapter {
  const at = period.to
  const activeUnits = generator.units.filter((u) => inServiceDuring(u, period))
  const movedNodes = movedNodesOf(generator.units)
  // Moved units are charted under their current node only
  const historyUnits = generator.units.filter((u) => !(u.node in movedNodes))

  // A generator opened for a day before it was built still names its fuels
  const subtitleFuels = fuelFamilies((activeUnits.length > 0 ? activeUnits : generator.units).map((u) => u.fuel))

  return {
    title: generator.name,
    subtitle: generator.operator + (generator.secondaryOperator ? ` / ${generator.secondaryOperator}` : ''),

    getCodes(recent, includeRetired = false) {
      return (includeRetired ? historyUnits : activeUnits)
        .slice()
        .sort((a, b) => {
          const fi = (FUEL_NAME_SORT_INDEX[a.fuel] ?? 99) - (FUEL_NAME_SORT_INDEX[b.fuel] ?? 99)
          return fi !== 0 ? fi : a.name.localeCompare(b.name)
        })
        .map((u) => u.node)
        .filter((c) => recent.series.includes(c))
    },

    labelFor(code) {
      const unit = generator.units.find((u) => u.node === code)
      if (!unit) return isGeneratorCode(code) ? unitOfCode(code) : code
      return unitLabel(unit)
    },

    colourFor(code) {
      const unit = generator.units.find((u) => u.node === code)
      return unit ? fuelColour(unit.fuel) : ''
    },

    subtitleFuels,
    queryNodes: generator.units.map((u) => u.node),
    movedNodes,

    yAxisOptions(effectiveCodes, rows) {
      const units = effectiveCodes
        ? activeUnits.filter((u) => effectiveCodes.has(u.node))
        : activeUnits
      const adjusted = generatingCapacityAt(units, outages, at)

      // softMax = maximum capacity the generator reaches over the chart period
      const softMaxCap = peakCapacity(units, outages, rows)
      const chargeCapacity = chargeCapacityOf(units, outages, at)

      const capacityPlotLines: Highcharts.YAxisPlotLinesOptions[] = []
      // When outage data is loaded, capacitySeries' step line replaces this one
      if (!outages && adjusted > 0) {
        capacityPlotLines.push({
          value: adjusted,
          color: '#222222',
          width: 1,
          dashStyle: 'Solid',
          label: {
            text: `${capacityLabel(units)}: ${formatMW(adjusted)}`,
            style: { color: '#222222', fontSize: 'var(--font-size-2xs)' },
            align: 'right',
            x: -4,
          },
          zIndex: 3,
        })
      }
      // The step line leaves out charging, so its line is drawn either way
      if (chargeCapacity > 0) {
        capacityPlotLines.push({
          value: -chargeCapacity,
          color: '#222222',
          width: 1,
          dashStyle: 'Solid',
          label: {
            text: `Charge: ${formatMW(chargeCapacity)}`,
            style: { color: '#222222', fontSize: 'var(--font-size-2xs)' },
            align: 'right',
            x: -4,
          },
          zIndex: 3,
        })
      }

      return {
        title: { text: 'MW' },
        softMin: chargeCapacity > 0 ? -(chargeCapacity + 1) : 0,
        softMax: softMaxCap + 1,
        gridLineDashStyle: 'Dash',
        plotLines: capacityPlotLines,
      }
    },

    showLegend: false,
    capacityMW(effectiveCodes) {
      return generatingCapacityAt(activeUnits.filter((u) => effectiveCodes.has(u.node)), outages, at)
    },

    normalCapacityMW(effectiveCodes) {
      return activeUnits
        .filter((u) => effectiveCodes.has(u.node) && !isCharging(u) && inServiceAt(u, at))
        .reduce((sum, u) => sum + u.capacity, 0)
    },

    unitOutageMW(code) {
      const unit = generator.units.find((u) => u.node === code)
      return outages && unit && inServiceAt(unit, at) ? unitOutageMWAt(unit, outages, at) : 0
    },

    capacitySeries(rows, effectiveCodes) {
      if (!outages || rows.length === 0) return null

      const units = activeUnits.filter((u) => effectiveCodes.has(u.node))
      if (units.length === 0) return null

      const data = capacitySteps(units, outages, rows)
      const lastIndex = data.length - 1
      return {
        type: 'line',
        name: 'Capacity',
        data: data.map((point, i) => ({
          x: point[0],
          y: point[1],
          dataLabels: i === lastIndex ? {
            enabled: true,
            format: `${capacityLabel(units)}: ${formatMW(point[1] as number)}`,
            align: 'right',
            style: { color: '#222222', fontSize: 'var(--font-size-2xs)', fontWeight: 'normal', textOutline: 'none' },
            crop: false,
            overflow: 'allow' as const,
            x: -4,
          } : { enabled: false },
        })),
        color: '#222222',
        dashStyle: 'Solid',
        lineWidth: 2,
        step: 'left',
        marker: { enabled: false },
        animation: false,
        enableMouseTracking: false,
        showInLegend: false,
        zIndex: 3,
      } as Highcharts.SeriesLineOptions
    },
  }
}

export function createMultiGeneratorAdapter(generators: Generator[], outages: OutageData | null, period = nowPeriod()): GeneratorAdapter {
  const at = period.to

  const allUnits = generators.flatMap(g => g.units)
  const allActiveUnits = allUnits.filter(u => inServiceDuring(u, period))
  const movedNodes = Object.assign({}, ...generators.map(g => movedNodesOf(g.units))) as Record<string, string>

  const genNameFor = (code: string) => {
    for (const generator of generators) {
      if (generator.units.some(u => u.node === code)) return generator.name
    }
    return null
  }

  const subtitleFuels = fuelFamilies((allActiveUnits.length > 0 ? allActiveUnits : allUnits).map(u => u.fuel))

  const title = generators.length <= 2
    ? generators.map(g => g.name).join(', ')
    : `${generators[0].name} +${generators.length - 1} more`

  return {
    title,
    subtitle: [...new Set(generators.map(g => g.operator))].join(', '),
    subtitleFuels,
    queryNodes: allUnits.map(u => u.node),
    movedNodes,

    getCodes(recent, includeRetired = false) {
      // Moved units are charted under their current node only
      return (includeRetired ? allUnits.filter(u => !(u.node in movedNodes)) : allActiveUnits)
        .filter(u => recent.series.includes(u.node))
        .sort((a, b) => {
          const fi = (FUEL_NAME_SORT_INDEX[a.fuel] ?? 99) - (FUEL_NAME_SORT_INDEX[b.fuel] ?? 99)
          return fi !== 0 ? fi : a.name.localeCompare(b.name)
        })
        .map(u => u.node)
    },

    labelFor(code) {
      const unit = allUnits.find(u => u.node === code)
      if (!unit) return code
      const suffix = unitLabel(unit)
      const prefix = genNameFor(code)
      if (!prefix || prefix === unit.name) return suffix
      return `${prefix} — ${suffix}`
    },

    colourFor(code) {
      const unit = allUnits.find(u => u.node === code)
      return unit ? fuelColour(unit.fuel) : ''
    },

    yAxisOptions(effectiveCodes, rows) {
      const units = effectiveCodes ? allActiveUnits.filter(u => effectiveCodes.has(u.node)) : allActiveUnits
      const adjusted = generatingCapacityAt(units, outages, at)
      const softMaxCap = peakCapacity(units, outages, rows)
      const chargeCapacity = chargeCapacityOf(units, outages, at)
      return {
        title: { text: 'MW' },
        softMin: chargeCapacity > 0 ? -(chargeCapacity + 1) : 0,
        softMax: (adjusted > 0 ? adjusted : softMaxCap) + 1,
        gridLineDashStyle: 'Dash',
        plotLines: [],
      }
    },

    showLegend: true,

    capacityMW(effectiveCodes) {
      return generatingCapacityAt(allActiveUnits.filter(u => effectiveCodes.has(u.node)), outages, at)
    },

    normalCapacityMW(effectiveCodes) {
      return allActiveUnits
        .filter(u => effectiveCodes.has(u.node) && !isCharging(u) && inServiceAt(u, at))
        .reduce((sum, u) => sum + u.capacity, 0)
    },

    unitOutageMW(code) {
      const unit = allUnits.find(u => u.node === code)
      return outages && unit && inServiceAt(unit, at) ? unitOutageMWAt(unit, outages, at) : 0
    },

    capacitySeries(rows, effectiveCodes) {
      if (!outages || rows.length === 0) return null
      const units = allActiveUnits.filter(u => effectiveCodes.has(u.node))
      if (units.length === 0) return null
      const data = capacitySteps(units, outages, rows)
      const lastIndex = data.length - 1
      return {
        type: 'line', name: 'Capacity',
        data: data.map((point, i) => ({
          x: point[0], y: point[1],
          dataLabels: i === lastIndex
            ? { enabled: true, format: `Capacity: ${formatMW(point[1] as number)}`, align: 'right', style: { color: '#222222', fontSize: 'var(--font-size-2xs)', fontWeight: 'normal', textOutline: 'none' }, crop: false, overflow: 'allow' as const, x: -4 }
            : { enabled: false },
        })),
        color: '#222222', dashStyle: 'Solid', lineWidth: 0.5, step: 'left',
        marker: { enabled: false }, animation: false, enableMouseTracking: false,
        showInLegend: false, zIndex: 3,
      } as Highcharts.SeriesLineOptions
    },
  }
}
