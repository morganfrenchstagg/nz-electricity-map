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

// em6 publishes the HVDC's flows an hour or so behind the dispatch, so its last
// half hour is held for the intervals since, rather than leaving the newest
// without it. Not for longer than this, in case em6 stops publishing.
const HOLD_MS = 2 * 60 * 60 * 1000

// The HVDC's transfer into an island at a time
export interface HvdcTransfer {
  // MW flowing into the island, negative where it flows out
  mw: number
  // The most it can carry into the island, and out of it (MW)
  inLimit: number
  outLimit: number
}

// One of em6's half hours, at its NZ time in ms (see nzLocalMs)
export interface HvdcPoint {
  ms: number
  // MW flowing north, negative where it flows south
  north: number
  // As em6 gives them, the south limit negative
  northLimit: number | null
  southLimit: number | null
}

// em6's half hours that have a flow. Its south flow is taken as MW flowing south
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
// order). em6 only has each half hour, so the flow is interpolated between them,
// and the limits are the half hour before's. Null before em6's first half hour,
// or too long after its last (see HOLD_MS).
export function hvdcInto(island: 'NI' | 'SI', hvdc: HvdcData | undefined, times: string[]): (HvdcTransfer | null)[] {
  const points = hvdc ? hvdcPoints(hvdc) : []
  let j = 0
  return times.map((time) => {
    const ms = nzLocalMs(time)
    while (j + 1 < points.length && points[j + 1].ms <= ms) j++
    const a = points[j]
    const b = points[j + 1]
    if (!a || ms < a.ms || (!b && ms - a.ms > HOLD_MS)) return null
    const north = b ? a.north + ((b.north - a.north) * (ms - a.ms)) / (b.ms - a.ms) : a.north
    const northLimit = a.northLimit ?? 0
    const southLimit = Math.abs(a.southLimit ?? 0)
    return island === 'NI'
      ? { mw: north, inLimit: northLimit, outLimit: southLimit }
      : { mw: -north || 0, inLimit: southLimit, outLimit: northLimit } // 0, not -0
  })
}

// The HVDC's transfer north (into the North Island) at the newest of `data`'s
// intervals, which is what the map shows. Null where em6 has none for it.
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
