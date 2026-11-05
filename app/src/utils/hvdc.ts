import type { HvdcData, RecentData } from '../types'
import { nzLocalMs } from './time'

// Where the HVDC's cables come ashore either side of Cook Strait: Fighting Bay,
// and Oteranga Bay, at the ends of the overhead line in the transmission lines.
// They're drawn straight across between the two.
export const HVDC_CABLE: [number, number][] = [[174.2021, -41.3097], [174.6300, -41.2937]]

// How far the cables run anticlockwise of due east, from Fighting Bay to Oteranga
// Bay, in degrees. On the ground, which the map's projection keeps it at.
export const HVDC_CABLE_ANGLE = (Math.atan2(
  HVDC_CABLE[1][1] - HVDC_CABLE[0][1],
  (HVDC_CABLE[1][0] - HVDC_CABLE[0][0]) * Math.cos((HVDC_CABLE[0][1] * Math.PI) / 180),
) * 180) / Math.PI

// The middle of the cables, where the map shows which way the HVDC's flowing
export const HVDC_CABLE_MIDDLE: [number, number] = [
  (HVDC_CABLE[0][0] + HVDC_CABLE[1][0]) / 2,
  (HVDC_CABLE[0][1] + HVDC_CABLE[1][1]) / 2,
]

// The most the HVDC can carry each way (MW), as Transpower's capacity upgrade, approved
// by the Commerce Commission in 2024, takes it to. em6's limits are often less, e.g.
// for the reserves to cover losing it, and the map shows them as it does an outage.
export const HVDC_CAPACITY_MW = { north: 1200, south: 850 }

// Its overhead line is the only one in the transmission lines at 350 kV
export const HVDC_DESIGN_KV = 350

// The substations its converter stations are at, where it joins each island's
// AC network: Benmore in the South Island, and Haywards in the North
export const HVDC_SITES = { south: 'BEN', north: 'HAY' }

// em6 publishes the HVDC's flows an hour or so behind the dispatch, so its last
// half hour is held for the intervals since, rather than leaving the newest
// without it. Not for longer than this, in case em6 stops publishing. Nor is the
// flow interpolated across a longer gap, e.g. days neither EMI nor em6 has.
const HOLD_MS = 2 * 60 * 60 * 1000

// The HVDC's transfer into an island at a time
export interface HvdcTransfer {
  // MW flowing into the island, negative where it flows out
  mw: number
  // The most it can carry into the island, and out of it (MW)
  inLimit: number
  outLimit: number
}

// One of the HVDC's half hours, at its NZ time in ms (see nzLocalMs)
export interface HvdcPoint {
  ms: number
  // MW flowing north, negative where it flows south
  north: number
  // As em6 gives them, the south limit negative. Null where em6 has none, e.g.
  // before October 2026.
  northLimit: number | null
  southLimit: number | null
}

// The half hours that have a flow. The south flow is taken as MW flowing south
// whatever its sign, as em6 gives the south limit as negative. A series missing
// from `series` reads as null.
export function hvdcPoints(hvdc: HvdcData): HvdcPoint[] {
  const col = (name: string) => hvdc.series.indexOf(name) + 1
  const [northFlow, southFlow, northLimit, southLimit] = ['northFlow', 'southFlow', 'northLimit', 'southLimit'].map(col)
  const num = (value: string | number | null | undefined) => (typeof value === 'number' ? value : null)
  return hvdc.data.flatMap((row) => {
    const north = num(row[northFlow])
    const south = num(row[southFlow])
    if (north === null && south === null) return []
    return [{
      ms: nzLocalMs(row[0] as string),
      north: (north ?? 0) - Math.abs(south ?? 0),
      northLimit: num(row[northLimit]),
      southLimit: num(row[southLimit]),
    }]
  })
}

// The HVDC's transfer into `island` at each of `times` (dispatch timestamps, in
// order). Its flows are by the half hour, so the flow is interpolated between
// them, and the limits are the half hour before's. Null before the first half
// hour, or too long after one with none after it (see HOLD_MS).
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

// The MWh the HVDC sent each way in one of an aggregate view's periods, at the
// period's start in ms (see nzLocalMs)
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
  return hvdc.data.map((row) => ({ ms: nzLocalMs(row[0] as string), north: num(row[north]), south: Math.abs(num(row[south])) }))
}

// The MWh the HVDC brought into `island`, and took out of it, in each of an
// aggregate view's periods, by their rows' timestamps. Over a period it can have
// flowed both ways. Null for a period without a total.
export function hvdcEnergyInto(island: 'NI' | 'SI', hvdc: HvdcData | undefined, times: string[]): ({ in: number; out: number } | null)[] {
  const byMs = new Map((hvdc ? hvdcEnergies(hvdc) : []).map((energy) => [energy.ms, energy]))
  return times.map((time) => {
    const energy = byMs.get(nzLocalMs(time))
    if (!energy) return null
    return island === 'NI' ? { in: energy.north, out: energy.south } : { in: energy.south, out: energy.north }
  })
}

// Several days' HVDC as one, e.g. a range's, in time order. Each day's series
// are lined up by name, with null where a day lacks one (one with no HVDC has none).
export function mergeHvdc(days: (HvdcData | undefined)[]): HvdcData | undefined {
  const present = days.filter((day): day is HvdcData => day !== undefined && day.data.length > 0)
  if (present.length <= 1) return present[0]
  const series = [...new Set(present.flatMap((day) => day.series))]
  const data = present.flatMap((day) => {
    const columns = series.map((name) => day.series.indexOf(name) + 1)
    return day.data.map((row) => [row[0], ...columns.map((c) => (c > 0 ? row[c] ?? null : null))])
  })
  // Timestamps are all NZ times in the same format, so they sort as strings
  return { series, data: data.sort((a, b) => (a[0] as string).localeCompare(b[0] as string)) }
}

// The HVDC's transfer north (into the North Island) at the newest of `data`'s
// intervals, which is what the map shows. Null where there's none for it.
export function latestHvdcNorth(data: RecentData | null): HvdcTransfer | null {
  const newest = data?.data[data.data.length - 1]?.[0]
  return newest === undefined ? null : hvdcInto('NI', data?.hvdc, [newest as string])[0]
}

// Which way the HVDC is flowing, to the MW as its popup shows it. Null with
// nothing to the MW, or no transfer.
export function hvdcDirection(transfer: HvdcTransfer | null): 'north' | 'south' | null {
  if (!transfer || Math.round(Math.abs(transfer.mw)) === 0) return null
  return transfer.mw > 0 ? 'north' : 'south'
}
