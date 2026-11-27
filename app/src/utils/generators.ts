import type { Generator, Unit } from '../types'
import { CHARGING_FUEL_CODE } from './colours'
import { nzNowMs, nzWallClockMs } from './time'
import type { Period } from './time'

// Commissioning dates are real instants, put in the "local time as UTC" convention
// (see utils/time.ts) to compare with dispatch times. Cached: the same few dozen recur every render.
const instants = new Map<string, number>()
function instantMs(iso: string): number {
  let ms = instants.get(iso)
  if (ms === undefined) {
    const instant = Date.parse(iso)
    // nzWallClockMs drops the milliseconds; restore them so an end at 1:59:59.999pm stays before a 2pm start
    ms = nzWallClockMs(instant) + (((instant % 1000) + 1000) % 1000)
    instants.set(iso, ms)
  }
  return ms
}

// In service from commissioning through decommissioning, its last instant (Pātea's old nodes
// end at 1:59:59.999pm as its new ones start at 2pm). No commissioning date: not in service yet.
function serviceStart(unit: Unit): number {
  return unit.commissioned ? instantMs(unit.commissioned) : Infinity
}

function serviceEnd(unit: Unit): number {
  return unit.decomissioned ? instantMs(unit.decomissioned) : Infinity
}

export function inServiceAt(unit: Unit, atMs: number): boolean {
  return serviceStart(unit) <= atMs && atMs <= serviceEnd(unit)
}

// At any point in the period, so it has dispatch data there
export function inServiceDuring(unit: Unit, period: Period): boolean {
  return serviceStart(unit) <= period.to && period.from <= serviceEnd(unit)
}

export function isDecommissioned(unit: Unit, atMs = nzNowMs()): boolean {
  return serviceEnd(unit) < atMs
}

// Not in service yet. Live views show it once it's dispatching, but it doesn't count
// towards capacity until it's in service.
export function isCommissioning(unit: Unit, atMs = nzNowMs()): boolean {
  return atMs < serviceStart(unit)
}

// Times in (from, to] where the units' total capacity steps
export function serviceChangesBetween(units: Unit[], from: number, to: number): number[] {
  return units.flatMap((u) => [serviceStart(u), serviceEnd(u) + 1]).filter((ms) => ms > from && ms <= to)
}

// All units decommissioned; units still being commissioned don't count as retired
export function isRetired(g: Generator, atMs = nzNowMs()): boolean {
  return g.units.every((u) => isDecommissioned(u, atMs))
}

export function isCharging(unit: Unit): boolean {
  return unit.fuelCode === CHARGING_FUEL_CODE
}

// Marks a battery's charging unit apart from its discharging one, and a unit still being commissioned
export function unitNotes(unit: Unit): string {
  return [isCharging(unit) && 'charging', isCommissioning(unit) && 'commissioning'].filter(Boolean).join(', ')
}

export function unitLabel(unit: Unit): string {
  const notes = unitNotes(unit)
  return notes ? `${unit.name} (${notes})` : unit.name
}

// A unit's name without its generator's ("Huntly Unit 5" → "Unit 5"); '' if nothing's left.
// Kept whole when the rest wouldn't read as a name, like "& Southdown 5" or "5".
export function shortUnitName(unitName: string, generatorName: string): string {
  if (!unitName.startsWith(generatorName)) return unitName
  const rest = unitName.slice(generatorName.length)
  if (rest === '') return ''
  // Only a whole word, so "Te" wouldn't cut "Tekapo" short
  if (!/^[\s-]/.test(rest)) return unitName
  const short = rest.replace(/^[\s-]+/, '')
  return /^[\p{L}\p{N}]/u.test(short) && !/^\d+$/.test(short) ? short : unitName
}

// The unit among `units` that combines this one (see Unit.combines)
export function combinedUnitOf(unit: Unit, units: Unit[]): Unit | undefined {
  return units.find((c) => c.combines?.includes(unit.node))
}

// A unit combined into another has no generation of its own while that one stands in.
// It's left out over a period unless in service after that one ends (Huntly's Rankine
// units outlasted theirs; Southdown's two didn't). No period means all of its service.
export function isCombinedOver(unit: Unit, units: Unit[], period: Period = { from: -Infinity, to: Infinity }): boolean {
  const combined = combinedUnitOf(unit, units)
  if (!combined) return false
  const after = Math.max(period.from, serviceEnd(combined) + 1)
  return after > period.to || !inServiceDuring(unit, { from: after, to: period.to })
}

// Every unit by its node. A node shared by several units maps to the first.
export function unitsByNode(generators: Generator[]): Map<string, Unit> {
  const units = new Map<string, Unit>()
  for (const unit of generators.flatMap((g) => g.units)) {
    if (!units.has(unit.node)) units.set(unit.node, unit)
  }
  return units
}
