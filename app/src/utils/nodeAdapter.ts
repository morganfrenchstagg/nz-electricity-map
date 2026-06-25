import type Highcharts from 'highcharts'
import type { Generator, RecentData, Substation } from '../types'
import type { ChartRow } from './chart'
import type { OutageData } from '../hooks/useOutages'
import { substationCodes } from './chart'
import { fuelColour, voltageColour, FUEL_NAME_SORT_INDEX } from './colours'
import { formatMW } from './format'

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
  yAxisOptions(effectiveCodes?: Set<string>, rows?: ChartRow[]): Highcharts.YAxisOptions
  extraSeries(rows: ChartRow[], codes: string[]): Highcharts.SeriesOptionsType[]
  stacking(numCodes: number): Highcharts.OptionsStackingValue | undefined
  showUnitSelector(numCodes: number): boolean
  showLegend(numCodes: number): boolean
  capacityMW(effectiveCodes: Set<string>): number | null
  normalCapacityMW(effectiveCodes: Set<string>): number | null
  unitOutageMW(code: string): number
  capacitySeries(rows: ChartRow[], effectiveCodes: Set<string>): Highcharts.SeriesOptionsType | null
  subtitleFuels: { label: string; colour: string }[]
}

export function createGeneratorAdapter(generator: Generator, outages: OutageData | null): NodeAdapter {
  // Convert current time to the same "local time as UTC" convention used by outageMs,
  // so comparisons with outage timestamps are consistent.
  const now = new Date(
    new Date().toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T') + 'Z'
  ).getTime()
  const activeUnits = generator.units.filter((u) => u.active !== false)

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
    subtitle: generator.operator,
    chartType: 'area',

    getCodes(recent) {
      return activeUnits
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
              style: { color: '#222222', fontSize: '10px' },
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
              style: { color: '#222222', fontSize: '10px' },
              align: 'right',
              x: -4,
            },
            zIndex: 3,
          })
        }
      }

      return {
        title: { text: 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
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
            style: { color: '#222222', fontSize: '10px', fontWeight: 'normal', textOutline: 'none' },
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
  const now = new Date(
    new Date().toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T') + 'Z'
  ).getTime()

  const activeUnitsByGen = generators.map(g => ({
    generator: g,
    units: g.units.filter(u => u.active !== false),
  }))
  const allActiveUnits = activeUnitsByGen.flatMap(({ units }) => units)

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
    for (const { generator, units } of activeUnitsByGen) {
      if (units.some(u => u.node === code)) return generator.name
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

    getCodes(recent) {
      return activeUnitsByGen
        .flatMap(({ units }) => units.map(u => u))
        .filter(u => recent.series.includes(u.node))
        .sort((a, b) => {
          const fi = (FUEL_NAME_SORT_INDEX[a.fuel] ?? 99) - (FUEL_NAME_SORT_INDEX[b.fuel] ?? 99)
          return fi !== 0 ? fi : a.name.localeCompare(b.name)
        })
        .map(u => u.node)
    },

    labelFor(code) {
      const unit = allActiveUnits.find(u => u.node === code)
      if (!unit) return code
      const suffix = unit.fuel === 'Battery (Charging)' ? `${unit.name} (charging)` : unit.name
      const prefix = genNameFor(code)
      if (!prefix || prefix === unit.name) return suffix
      return `${prefix} — ${suffix}`
    },

    colourFor(code) {
      const unit = allActiveUnits.find(u => u.node === code)
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
        title: { text: 'MW', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
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
            ? { enabled: true, format: `Capacity: ${formatMW(point[1] as number)}`, align: 'right', style: { color: '#222222', fontSize: '10px', fontWeight: 'normal', textOutline: 'none' }, crop: false, overflow: 'allow' as const, x: -4 }
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
  return {
    title: `${substation.description} Substation`,
    subtitle: '',
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

    yAxisOptions(_effectiveCodes, _rows) {
      return {
        title: { text: 'Load (MW)', style: { fontSize: '11px' } },
        labels: { style: { fontSize: '10px' } },
        softMin: 0,
        gridLineDashStyle: 'Dash',
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
    showLegend(numCodes) { return numCodes > 1 },
    capacityMW(_effectiveCodes) { return null },
    normalCapacityMW(_effectiveCodes) { return null },
    unitOutageMW(_code) { return 0 },
    capacitySeries(_rows, _effectiveCodes) { return null },
    subtitleFuels: [],
  }
}
