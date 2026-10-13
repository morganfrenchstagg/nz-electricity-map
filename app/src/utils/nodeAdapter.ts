import type Highcharts from 'highcharts'
import type { Generator, RecentData, Substation, Unit } from '../types'
import type { ChartRow } from './chart'
import type { OutageData } from '../hooks/useOutages'
import { busLabel, substationCodes } from './chart'
import { fuelColour, voltageColour, FUEL_NAME_SORT_INDEX } from './colours'
import { formatMW } from './format'
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
  // Dispatch data charts active units only; the aggregate views pass
  // includeRetired to chart every unit's history.
  getCodes(recent: RecentData, includeRetired?: boolean): string[]
  // codes: every code being charted, for labels that depend on the others
  labelFor(code: string, codes: string[]): string
  colourFor(code: string, index: number): string
  transformValue(val: number): number
  yAxisOptions(effectiveCodes?: Set<string>, rows?: ChartRow[]): Highcharts.YAxisOptions
  // Series derived from the codes, each toggled by its own button; `visible: false` starts it off
  extraSeries(rows: ChartRow[], codes: string[]): Highcharts.SeriesOptionsType[]
  stacking(numCodes: number): Highcharts.OptionsStackingValue | undefined
  showUnitSelector(numCodes: number): boolean
  showLegend(numCodes: number): boolean
  capacityMW(effectiveCodes: Set<string>): number | null
  normalCapacityMW(effectiveCodes: Set<string>): number | null
  unitOutageMW(code: string): number
  capacitySeries(rows: ChartRow[], effectiveCodes: Set<string>): Highcharts.SeriesOptionsType | null
  subtitleFuels: { label: string; colour: string }[]
  // Node codes (or prefixes) to request from the aggregates API, retired units' included
  queryNodes: string[]
  // Old nodes of units that moved, mapped to their current node. The aggregate
  // views add their history into the current node's series (foldMovedNodes).
  movedNodes: Record<string, string>
}

export function createGeneratorAdapter(generator: Generator, outages: OutageData | null): NodeAdapter {
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

  const subtitleFuels = [...new Set(activeUnits.map((u) => {
    if (u.fuel === 'Battery (Charging)' || u.fuel === 'Battery (Discharging)') return 'Battery'
    return u.fuel
  }))]
    .sort((a, b) => (FUEL_NAME_SORT_INDEX[a] ?? 99) - (FUEL_NAME_SORT_INDEX[b] ?? 99))
    .map((label) => ({ label, colour: fuelColour(label) }))

  return {
    title: generator.name,
    subtitle: generator.operator + (generator.secondaryOperator ? ` / ${generator.secondaryOperator}` : ''),
    chartType: 'area',

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
      if (!unit) return code.includes(' ') ? code.split(' ')[1] : code
      return unit.fuel === 'Battery (Charging)' ? `${unit.name} (charging)` : unit.name
    },

    colourFor(code) {
      const unit = generator.units.find((u) => u.node === code)
      return unit ? fuelColour(unit.fuel) : ''
    },

    transformValue(val) { return val },
    subtitleFuels,
    queryNodes: generator.units.map((u) => u.node),
    movedNodes,

    yAxisOptions(effectiveCodes, rows) {
      const units = effectiveCodes
        ? activeUnits.filter((u) => effectiveCodes.has(u.node))
        : activeUnits
      const adjusted = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, now), 0)

      // softMax = maximum capacity the generator reaches over the chart period.
      // Collect all outage-event timestamps within the chart window plus firstTime,
      // evaluate totalCap at each, take the max.
      let softMaxCap = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + u.capacity, 0) // MSGC as default
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
          const cap = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, t), 0)
          if (cap > softMaxCap) softMaxCap = cap
        }
      }
      const chargeCapacity = units.filter(u => u.fuelCode === 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, now), 0)

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

    extraSeries(_rows, _codes) { return [] },

    stacking(numCodes) { return numCodes > 1 ? 'normal' : undefined },

    showUnitSelector(numCodes) { return numCodes > 1 },
    showLegend(_numCodes) { return false },
    capacityMW(effectiveCodes) {
      return activeUnits
        .filter((u) => effectiveCodes.has(u.node) && u.fuelCode !== 'BESS-C')
        .reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
    },

    normalCapacityMW(effectiveCodes) {
      return activeUnits
        .filter((u) => effectiveCodes.has(u.node) && u.fuelCode !== 'BESS-C')
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
        return units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, atMs), 0)
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

export function createMultiGeneratorAdapter(generators: Generator[], outages: OutageData | null): NodeAdapter {
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

  const subtitleFuels = [...new Set(allActiveUnits.map(u =>
    u.fuel === 'Battery (Charging)' || u.fuel === 'Battery (Discharging)' ? 'Battery' : u.fuel
  ))]
    .sort((a, b) => (FUEL_NAME_SORT_INDEX[a] ?? 99) - (FUEL_NAME_SORT_INDEX[b] ?? 99))
    .map(label => ({ label, colour: fuelColour(label) }))

  const title = generators.length <= 2
    ? generators.map(g => g.name).join(', ')
    : `${generators[0].name} +${generators.length - 1} more`

  return {
    title,
    subtitle: [...new Set(generators.map(g => g.operator))].join(', '),
    chartType: 'area',
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
      const suffix = unit.fuel === 'Battery (Charging)' ? `${unit.name} (charging)` : unit.name
      const prefix = genNameFor(code)
      if (!prefix || prefix === unit.name) return suffix
      return `${prefix} — ${suffix}`
    },

    colourFor(code) {
      const unit = allUnits.find(u => u.node === code)
      return unit ? fuelColour(unit.fuel) : ''
    },

    transformValue(val) { return val },

    yAxisOptions(effectiveCodes, rows) {
      const units = effectiveCodes ? allActiveUnits.filter(u => effectiveCodes.has(u.node)) : allActiveUnits
      const adjusted = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
      let softMaxCap = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + u.capacity, 0)
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
          const cap = units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, t), 0)
          if (cap > softMaxCap) softMaxCap = cap
        }
      }
      const chargeCapacity = units.filter(u => u.fuelCode === 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
      return {
        title: { text: 'MW' },
        softMin: chargeCapacity > 0 ? -(chargeCapacity + 1) : 0,
        softMax: (adjusted > 0 ? adjusted : softMaxCap) + 1,
        gridLineDashStyle: 'Dash',
        plotLines: [],
      }
    },

    extraSeries(_rows, _codes) { return [] },
    stacking(numCodes) { return numCodes > 1 ? 'normal' : undefined },
    showUnitSelector(numCodes) { return numCodes > 1 },
    showLegend(_numCodes) { return true },

    capacityMW(effectiveCodes) {
      return allActiveUnits
        .filter(u => effectiveCodes.has(u.node) && u.fuelCode !== 'BESS-C')
        .reduce((sum, u) => sum + unitCapacityAt(u, now), 0)
    },

    normalCapacityMW(effectiveCodes) {
      return allActiveUnits
        .filter(u => effectiveCodes.has(u.node) && u.fuelCode !== 'BESS-C')
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
        return units.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + unitCapacityAt(u, atMs), 0)
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

export function createSubstationAdapter(substation: Substation, allGenerators: Generator[]): NodeAdapter {
  // Generator codes contain a space; bus codes don't
  const unitFor = (code: string) => {
    if (!code.includes(' ')) return null
    for (const gen of allGenerators) {
      const unit = gen.units.find((u) => u.node === code)
      if (unit) return unit
    }
    return null
  }
  // As for generators, a battery's charging node is marked to tell it apart
  const unitLabel = (unit: Unit) => (unit.fuel === 'Battery (Charging)' ? `${unit.name} (charging)` : unit.name)

  return {
    title: `${substation.description} Substation`,
    subtitle: '',
    chartType: 'line',

    // Buses first, then generators alphabetically by name
    getCodes(recent) {
      const codes = substationCodes(recent, substation.siteId)
      const genName = (code: string) => { const unit = unitFor(code); return unit ? unitLabel(unit) : code }
      return [
        ...codes.filter((c) => !c.includes(' ')),
        ...codes.filter((c) => c.includes(' ')).sort((a, b) => genName(a).localeCompare(genName(b))),
      ]
    },

    labelFor(code, codes) {
      const unit = unitFor(code)
      if (unit) return unitLabel(unit)
      return code.includes(' ') ? code.split(' ')[1] : busLabel(code, codes)
    },

    colourFor(code, _index) {
      const unit = unitFor(code)
      return unit ? fuelColour(unit.fuel) : codeVoltageColour(code)
    },

    transformValue(val) { return -val },

    yAxisOptions(_effectiveCodes, _rows) {
      return {
        title: { text: 'Load (MW)' },
        softMin: 0,
        gridLineDashStyle: 'Dash',
        plotLines: [],
      }
    },

    extraSeries(rows, codes) {
      // A lone bus's total would just repeat it
      if (codes.length < 2) return []
      return [{
        type: 'line',
        name: 'Total',
        // Off by default unless the substation has generators (codes with a space)
        visible: codes.some((c) => c.includes(' ')),
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

    showUnitSelector(numCodes) { return numCodes > 1 },
    showLegend(_numCodes) { return false },
    capacityMW(_effectiveCodes) { return null },
    normalCapacityMW(_effectiveCodes) { return null },
    unitOutageMW(_code) { return 0 },
    capacitySeries(_rows, _effectiveCodes) { return null },
    subtitleFuels: [],
    queryNodes: [substation.siteId],
    movedNodes: {},
  }
}
