import type { OutageData, OutageRecord } from '../api'
import type { Unit } from '../types'
import { outageMs } from './time'

export interface OutageSegment {
  start: number
  end: number
  mw: number
}

type UnitCapacity = Pick<Unit, 'node' | 'capacity' | 'installedCapacity'>

// Outages are reported against installed capacity, not MSGC
export function installedCapacityOf(unit: UnitCapacity): number {
  return unit.installedCapacity ?? unit.capacity
}

// A battery's charging unit has negative capacity, but MW lost are always positive
export function maxOutageMWOf(unit: UnitCapacity): number {
  return Math.abs(installedCapacityOf(unit))
}

// Keeps the sign, so a charging unit's capacity stays negative (and none left is 0, not -0)
export function capacityLeftAfter(unit: UnitCapacity, lostMW: number): number {
  const left = Math.max(0, maxOutageMWOf(unit) - lostMW)
  return installedCapacityOf(unit) < 0 && left > 0 ? -left : left
}

// An outage runs from its start up to, not including, its end. POCP often lists one job as
// several overlapping records on one outage block (Ōhau A has had four concurrent 66 MW OHA_5
// records for one 66 MW unit), so a block counts only its largest active record. Separate
// blocks stack, up to `maxMW`.
export function outageMWAt(records: OutageRecord[], atMs: number, maxMW = Infinity): number {
  const byBlock = new Map<string, number>()
  for (const r of records) {
    if (outageMs(r.timeStart) <= atMs && atMs < outageMs(r.timeEnd)) {
      byBlock.set(r.outageBlock, Math.max(byBlock.get(r.outageBlock) ?? 0, r.mwattLost))
    }
  }
  let lost = 0
  for (const mw of byBlock.values()) lost += mw
  return Math.min(lost, maxMW)
}

export function unitOutageMWAt(unit: UnitCapacity, outages: OutageData, atMs: number): number {
  return outageMWAt(outages[unit.node] ?? [], atMs, maxOutageMWOf(unit))
}

// MSGC without an outage, or what an outage leaves of installed capacity
export function unitCapacityAt(unit: UnitCapacity, outages: OutageData | null, atMs: number): number {
  if (!outages) return unit.capacity
  const lost = unitOutageMWAt(unit, outages, atMs)
  if (lost <= 0) return unit.capacity
  return capacityLeftAfter(unit, lost)
}

// Distinct MW-loss segments, counted as outageMWAt does (a 66 MW unit outage with a 198 MW
// station outage inside it becomes 66, 264 capped to `maxMW`, 66). Drops ended segments but
// never clips starts to now, so an ongoing outage shows when it began. Times are outageMs's,
// so `nowMs` must be nzNowMs().
export function mergeOutageSegments(records: OutageRecord[], nowMs: number, maxMW = Infinity): OutageSegment[] {
  const events = [...new Set(records.flatMap((r) => [outageMs(r.timeStart), outageMs(r.timeEnd)]))]
    .sort((a, b) => a - b)
  const segments: OutageSegment[] = []
  for (let i = 0; i < events.length - 1; i++) {
    const mw = outageMWAt(records, events[i], maxMW)
    if (mw <= 0) continue
    const last = segments[segments.length - 1]
    if (last && last.end === events[i] && Math.abs(last.mw - mw) < 0.001) last.end = events[i + 1]
    else segments.push({ start: events[i], end: events[i + 1], mw })
  }
  return segments.filter((s) => s.end > nowMs)
}

// The end of the unbroken run of segments losing at least as much as at `atMs`. Null if nothing is out.
export function outageEasesAt(segments: OutageSegment[], atMs: number): number | null {
  const i = segments.findIndex((s) => s.start <= atMs && atMs < s.end)
  if (i < 0) return null
  let end = segments[i].end
  for (let j = i + 1; j < segments.length && segments[j].start === end && segments[j].mw >= segments[i].mw - 0.001; j++) {
    end = segments[j].end
  }
  return end
}
