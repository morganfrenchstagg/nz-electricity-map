import type { HvdcData } from '../types'
import { nzLocalMs } from './time'

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

interface HvdcPoint {
  ms: number
  // MW flowing north, negative where it flows south
  north: number
  northLimit: number | null
  southLimit: number | null
}

// em6's half hours that have a flow. Its south flow is taken as MW flowing south
// whatever its sign, as em6 gives the south limit as negative. A series missing
// from `series` reads as null.
function hvdcPoints(hvdc: HvdcData): HvdcPoint[] {
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
