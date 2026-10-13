import type Highcharts from 'highcharts'
import type { Generator, RecentData, Unit } from '../types'
import type { ChartRow } from './chart'
import type { OutageData } from '../hooks/useOutages'
import { isGeneratorCode, unitOfCode } from './chart'
import { fuelColour, fuelFamily, FUEL_NAME_SORT_INDEX } from './colours'
import { formatMW } from './format'
import { isCharging, unitLabel } from './generators'
import { nzNowMs } from './time'

// Outage timestamps include a timezone offset (e.g. +12:00). Chart row timestamps
// are NZ local time treated as UTC (appending 'Z'). To compare them correctly,
// strip the offset and append 'Z' so both are expressed as "local time as UTC".
function outageMs(isoString: string): number {
  return new Date(isoString.replace(/([+-]\d{2}:\d{2}|Z)$/, '') + 'Z').getTime()
}

function activeOutageMW(unitCode: string, outages: OutageData, now: number): number {
  const records = outages[unitCode] ?? []
  return records
    .filter((o) => outageMs(o.timeStart) <= now && now <= outageMs(o.timeEnd))
    .reduce((sum, o) => sum + o.mwattLost, 0)
}

// A unit that moves substation (e.g. Pātea, from Hawera to Ōhangai in 2026) is
// listed twice under the same unit code: retired at its old node and active at
// its new one. Maps each such old node to the new one.
function movedNodesOf(units: Unit[]): Record<string, string> {
  const moved: Record<string, string> = {}
  for (const unit of units) {
    if (unit.active !== false) continue
    const successors = units.filter((u) => u.active !== false && u.unitCode === unit.unitCode)
    if (successors.length === 1) moved[unit.node] = successors[0].node
  }
  return moved
}

// What GeneratorPanel charts for one generator, or several picked together
export interface GeneratorAdapter {
  title: string
  subtitle: string
  // Dispatch data charts active units only; the aggregate views pass
  // includeRetired to chart every unit's history.
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

export function createGeneratorAdapter(generator: Generator, outages: OutageData | null): GeneratorAdapter {
  // Current time in the same "local time as UTC" convention used by outageMs,
  // so comparisons with outage timestamps are consistent.
  const now = nzNowMs()
  const activeUnits = generator.units.filter((u) => u.active !== false)
  const movedNodes = movedNodesOf(generator.units)
  // Moved units are charted under their current node only
  const historyUnits = generator.units.filter((u) => !(u.node in movedNodes))

  // Returns the available capacity for a unit at a given chart-timeline timestamp.
  // Without active outages: MSGC (u.capacity).
  // With active outages: installedCapacity - totalLost (outages are calculated
  // against installed capacity, not MSGC).
  function unitCapacityAt(unit: { node: string; capacity: number; installedCapacity?: number }, atMs: number): number {
    if (!outages) return unit.capacity
    const records = outages[unit.node] ?? []
    const lost = records
      .filter((r) => outageMs(r.timeStart) <= atMs && atMs < outageMs(r.timeEnd))
      .reduce((s, r) => s + r.mwattLost, 0)
    if (lost <= 0) return unit.capacity
    return Math.max(0, (unit.installedCapacity ?? unit.capacity) - lost)
  }

  const subtitleFuels = [...new Set(activeUnits.map((u) => fuelFamily(u.fuel)))]
    .sort((a, b) => (FUEL_NAME_SORT_INDEX[a] ?? 99) - (FUEL_NAME_SORT_INDEX[b] ?? 99))
    .map((label) => ({ label, colour: fuelColour(label) }))

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
      const adjusted = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, now), 0)

      // softMax = maximum capacity the generator reaches over the chart period.
      // Collect all outage-event timestamps within the chart window plus firstTime,
      // evaluate totalCap at each, take the max.
      let softMaxCap = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + u.capacity, 0) // MSGC as default
      if (outages && rows && rows.length > 0) {
        const firstTime = new Date((rows[0].time as string) + 'Z').getTime()
        const lastTime = new Date((rows[rows.length - 1].time as string) + 'Z').getTime()
        const checkTs = new Set<number>([firstTime])
        for (const unit of units) {
          for (const rec of (outages[unit.node] ?? [])) {
            const s = outageMs(rec.timeStart)
            const e = outageMs(rec.timeEnd)
            if (s > firstTime && s <= lastTime) checkTs.add(s)
            if (e > firstTime && e <= lastTime) checkTs.add(e)
          }
        }
        softMaxCap = 0
        for (const t of checkTs) {
          const cap = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, t), 0)
          if (cap > softMaxCap) softMaxCap = cap
        }
      }
      const chargeCapacity = units.filter(isCharging).reduce((sum, u) => sum + unitCapacityAt(u, now), 0)

      const capacityPlotLines: Highcharts.YAxisPlotLinesOptions[] = []
      if (!outages) {
        if (adjusted > 0) {
          capacityPlotLines.push({
            value: adjusted,
            color: '#222222',
            width: 1,
            dashStyle: 'Solid',
            label: {
              text: `${chargeCapacity > 0 ? 'Discharge' : 'Capacity'}: ${formatMW(adjusted)}`,
              style: { color: '#222222', fontSize: 'var(--font-size-2xs)' },
              align: 'right',
              x: -4,
            },
            zIndex: 3,
          })
        }
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
      }

      return {
        title: { text: 'MW' },
        softMin: chargeCapacity > 0 ? -(chargeCapacity + 1) : 0,
        softMax: softMaxCap + 1,
        // when outage data is loaded, the step-line series replaces the static plotLine
        gridLineDashStyle: 'Dash',
        plotLines: capacityPlotLines,
      }
    },

    showLegend: false,
    capacityMW(effectiveCodes) {
      return activeUnits
        .filter((u) => effectiveCodes.has(u.node) && !isCharging(u))
        .reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
    },

    normalCapacityMW(effectiveCodes) {
      return activeUnits
        .filter((u) => effectiveCodes.has(u.node) && !isCharging(u))
        .reduce((sum, u) => sum + u.capacity, 0)
    },

    unitOutageMW(code) {
      if (!outages) return 0
      return activeOutageMW(code, outages, now)
    },

    capacitySeries(rows, effectiveCodes) {
      if (!outages || rows.length === 0) return null

      const units = activeUnits.filter((u) => effectiveCodes.has(u.node))
      if (units.length === 0) return null

      const firstTime = new Date((rows[0].time as string) + 'Z').getTime()
      const lastTime = new Date((rows[rows.length - 1].time as string) + 'Z').getTime()

      function totalCapAt(atMs: number): number {
        return units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, atMs), 0)
      }

      // Collect unique timestamps within the chart window where any unit's outage state changes.
      const timestamps = new Set<number>()
      for (const unit of units) {
        for (const rec of (outages[unit.node] ?? [])) {
          const s = outageMs(rec.timeStart)
          const e = outageMs(rec.timeEnd)
          if (s > firstTime && s <= lastTime) timestamps.add(s)
          if (e > firstTime && e <= lastTime) timestamps.add(e)
        }
      }
      const sortedTs = Array.from(timestamps).sort((a, b) => a - b)

      // Build step data, only emitting a point when capacity actually changes.
      const data: [number, number][] = [[firstTime, totalCapAt(firstTime)]]
      let prev = data[0][1]
      for (const t of sortedTs) {
        const cap = totalCapAt(t)
        if (Math.abs(cap - prev) > 0.001) {
          data.push([t, cap])
          prev = cap
        }
      }
      data.push([lastTime, prev])

      const lastIndex = data.length - 1
      return {
        type: 'line',
        name: 'Capacity',
        data: data.map((point, i) => ({
          x: point[0],
          y: point[1],
          dataLabels: i === lastIndex ? {
            enabled: true,
            format: `Capacity: ${formatMW(point[1] as number)}`,
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

export function createMultiGeneratorAdapter(generators: Generator[], outages: OutageData | null): GeneratorAdapter {
  const now = nzNowMs()

  const allUnits = generators.flatMap(g => g.units)
  const allActiveUnits = allUnits.filter(u => u.active !== false)
  const movedNodes = Object.assign({}, ...generators.map(g => movedNodesOf(g.units))) as Record<string, string>

  function unitCapacityAt(unit: { node: string; capacity: number; installedCapacity?: number }, atMs: number): number {
    if (!outages) return unit.capacity
    const records = outages[unit.node] ?? []
    const lost = records
      .filter((r) => outageMs(r.timeStart) <= atMs && atMs < outageMs(r.timeEnd))
      .reduce((s, r) => s + r.mwattLost, 0)
    if (lost <= 0) return unit.capacity
    return Math.max(0, (unit.installedCapacity ?? unit.capacity) - lost)
  }

  const genNameFor = (code: string) => {
    for (const generator of generators) {
      if (generator.units.some(u => u.node === code)) return generator.name
    }
    return null
  }

  const subtitleFuels = [...new Set(allActiveUnits.map(u => fuelFamily(u.fuel)))]
    .sort((a, b) => (FUEL_NAME_SORT_INDEX[a] ?? 99) - (FUEL_NAME_SORT_INDEX[b] ?? 99))
    .map(label => ({ label, colour: fuelColour(label) }))

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
      const adjusted = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
      let softMaxCap = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + u.capacity, 0)
      if (outages && rows && rows.length > 0) {
        const firstTime = new Date((rows[0].time as string) + 'Z').getTime()
        const lastTime = new Date((rows[rows.length - 1].time as string) + 'Z').getTime()
        const checkTs = new Set<number>([firstTime])
        for (const unit of units) {
          for (const rec of (outages[unit.node] ?? [])) {
            const s = outageMs(rec.timeStart), e = outageMs(rec.timeEnd)
            if (s > firstTime && s <= lastTime) checkTs.add(s)
            if (e > firstTime && e <= lastTime) checkTs.add(e)
          }
        }
        softMaxCap = 0
        for (const t of checkTs) {
          const cap = units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, t), 0)
          if (cap > softMaxCap) softMaxCap = cap
        }
      }
      const chargeCapacity = units.filter(isCharging).reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
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
      return allActiveUnits
        .filter(u => effectiveCodes.has(u.node) && !isCharging(u))
        .reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
    },

    normalCapacityMW(effectiveCodes) {
      return allActiveUnits
        .filter(u => effectiveCodes.has(u.node) && !isCharging(u))
        .reduce((sum, u) => sum + u.capacity, 0)
    },

    unitOutageMW(code) {
      if (!outages) return 0
      return activeOutageMW(code, outages, now)
    },

    capacitySeries(rows, effectiveCodes) {
      if (!outages || rows.length === 0) return null
      const units = allActiveUnits.filter(u => effectiveCodes.has(u.node))
      if (units.length === 0) return null
      const firstTime = new Date((rows[0].time as string) + 'Z').getTime()
      const lastTime = new Date((rows[rows.length - 1].time as string) + 'Z').getTime()
      function totalCapAt(atMs: number) {
        return units.filter(u => !isCharging(u)).reduce((sum, u) => sum + unitCapacityAt(u, atMs), 0)
      }
      const timestamps = new Set<number>()
      for (const unit of units) {
        for (const rec of (outages[unit.node] ?? [])) {
          const s = outageMs(rec.timeStart), e = outageMs(rec.timeEnd)
          if (s > firstTime && s <= lastTime) timestamps.add(s)
          if (e > firstTime && e <= lastTime) timestamps.add(e)
        }
      }
      const data: [number, number][] = [[firstTime, totalCapAt(firstTime)]]
      let prev = data[0][1]
      for (const t of Array.from(timestamps).sort((a, b) => a - b)) {
        const cap = totalCapAt(t)
        if (Math.abs(cap - prev) > 0.001) { data.push([t, cap]); prev = cap }
      }
      data.push([lastTime, prev])
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
