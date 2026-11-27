import type { HvdcData, RecentData } from '../types'
import { nzLocalMs } from './time'

// Cable landings either side of Cook Strait, Fighting Bay and Oteranga Bay, at
// the ends of the overhead line in the transmission lines. Drawn straight across.
export const HVDC_CABLE: [number, number][] = [
  [174.2021, -41.3097],
  [174.63, -41.2937],
]

// Degrees anticlockwise of due east, Fighting Bay to Oteranga Bay, on the
// ground. The map's projection preserves it.
export const HVDC_CABLE_ANGLE =
  (Math.atan2(
    HVDC_CABLE[1][1] - HVDC_CABLE[0][1],
    (HVDC_CABLE[1][0] - HVDC_CABLE[0][0]) * Math.cos((HVDC_CABLE[0][1] * Math.PI) / 180),
  ) *
    180) /
  Math.PI

// Where the map shows which way the HVDC is flowing
export const HVDC_CABLE_MIDDLE: [number, number] = [
  (HVDC_CABLE[0][0] + HVDC_CABLE[1][0]) / 2,
  (HVDC_CABLE[0][1] + HVDC_CABLE[1][1]) / 2,
]

// Max MW each way after Transpower's upgrade (approved by the Commerce Commission
// in 2024). em6's limits are often lower, e.g. so reserves can cover losing it;
// the map shows them as it does an outage.
export const HVDC_CAPACITY_MW = { north: 1200, south: 850 }

// em6 publishes HVDC flows about an hour behind dispatch, so its last half hour
// is held for the newer intervals, up to this long in case em6 stops publishing.
// Flow isn't interpolated across a longer gap either (e.g. days EMI and em6 lack).
const HOLD_MS = 2 * 60 * 60 * 1000

// Into one island, at one time
export interface HvdcTransfer {
  // MW into the island, negative out of it
  mw: number
  // Max MW in and out
  inLimit: number
  outLimit: number
}

// One half hour, at its NZ time in ms (see nzLocalMs)
export interface HvdcPoint {
  ms: number
  // MW north, negative south
  north: number
  // As em6 gives them, south negative. Null where em6 has none, e.g. before
  // October 2026.
  northLimit: number | null
  southLimit: number | null
}

// Half hours with a flow. South flow counts as southward whatever its sign, as
// em6 gives the south limit negative. A missing series reads as null.
export function hvdcPoints(hvdc: HvdcData): HvdcPoint[] {
  const col = (name: string) => hvdc.series.indexOf(name) + 1
  const [northFlow, southFlow, northLimit, southLimit] = ['northFlow', 'southFlow', 'northLimit', 'southLimit'].map(col)
  const num = (value: string | number | null | undefined) => (typeof value === 'number' ? value : null)
  return hvdc.data.flatMap((row) => {
    const north = num(row[northFlow])
    const south = num(row[southFlow])
    if (north === null && south === null) return []
    return [
      {
        ms: nzLocalMs(row[0] as string),
        north: (north ?? 0) - Math.abs(south ?? 0),
        northLimit: num(row[northLimit]),
        southLimit: num(row[southLimit]),
      },
    ]
  })
}

// Transfer into `island` at each of `times` (dispatch timestamps, in order).
// Flow is interpolated between half hours; limits are the previous half hour's.
// Null before the first half hour, or beyond HOLD_MS with no next one.
export function hvdcInto(island: 'NI' | 'SI', hvdc: HvdcData | undefined, times: string[]): (HvdcTransfer | null)[] {
  const points = hvdc ? hvdcPoints(hvdc) : []
  let j = 0
  return times.map((time) => {
    const ms = nzLocalMs(time)
    while (j + 1 < points.length && points[j + 1].ms <= ms) j++
    const a = points[j]
    if (!a || ms < a.ms) return null
    const next = points[j + 1]
    const b = next && next.ms - a.ms <= HOLD_MS ? next : undefined
    if (!b && ms - a.ms > HOLD_MS) return null
    const north = b ? a.north + ((b.north - a.north) * (ms - a.ms)) / (b.ms - a.ms) : a.north
    const northLimit = a.northLimit ?? 0
    const southLimit = Math.abs(a.southLimit ?? 0)
    return island === 'NI'
      ? { mw: north, inLimit: northLimit, outLimit: southLimit }
      : { mw: -north || 0, inLimit: southLimit, outLimit: northLimit } // 0, not -0
  })
}

// MWh each way in one aggregate-view period, at its start in NZ ms (see nzLocalMs)
export interface HvdcEnergy {
  ms: number
  north: number
  south: number
}

// An aggregate view's periods (see HvdcData). A series missing from `series` reads as 0.
export function hvdcEnergies(hvdc: HvdcData): HvdcEnergy[] {
  const col = (name: string) => hvdc.series.indexOf(name) + 1
  const [north, south] = [col('northFlow'), col('southFlow')]
  const num = (value: string | number | null | undefined) => (typeof value === 'number' ? value : 0)
  return hvdc.data.map((row) => ({
    ms: nzLocalMs(row[0] as string),
    north: num(row[north]),
    south: Math.abs(num(row[south])),
  }))
}

// MWh into and out of `island` per aggregate-view period, matched by timestamp.
// It can flow both ways within a period. Null for a period without a total.
export function hvdcEnergyInto(
  island: 'NI' | 'SI',
  hvdc: HvdcData | undefined,
  times: string[],
): ({ in: number; out: number } | null)[] {
  const byMs = new Map((hvdc ? hvdcEnergies(hvdc) : []).map((energy) => [energy.ms, energy]))
  return times.map((time) => {
    const energy = byMs.get(nzLocalMs(time))
    if (!energy) return null
    return island === 'NI' ? { in: energy.north, out: energy.south } : { in: energy.south, out: energy.north }
  })
}

// Merges days' HVDC in time order, lining series up by name. Null where a day
// lacks a series.
export function mergeHvdc(days: (HvdcData | undefined)[]): HvdcData | undefined {
  const present = days.filter((day): day is HvdcData => day !== undefined && day.data.length > 0)
  if (present.length <= 1) return present[0]
  const series = [...new Set(present.flatMap((day) => day.series))]
  const data = present.flatMap((day) => {
    const columns = series.map((name) => day.series.indexOf(name) + 1)
    return day.data.map((row) => [row[0], ...columns.map((c) => (c > 0 ? (row[c] ?? null) : null))])
  })
  // Timestamps are all NZ times in the same format, so they sort as strings
  return { series, data: data.sort((a, b) => (a[0] as string).localeCompare(b[0] as string)) }
}

// Transfer into the North Island at `data`'s newest interval, as the map shows.
// Null if there's none.
export function latestHvdcNorth(data: RecentData | null): HvdcTransfer | null {
  const newest = data?.data[data.data.length - 1]?.[0]
  return newest === undefined ? null : hvdcInto('NI', data?.hvdc, [newest as string])[0]
}

// Null if the flow rounds to 0 MW, as the popup shows it, or there's no transfer
export function hvdcDirection(transfer: HvdcTransfer | null): 'north' | 'south' | null {
  if (!transfer || Math.round(Math.abs(transfer.mw)) === 0) return null
  return transfer.mw > 0 ? 'north' : 'south'
}
