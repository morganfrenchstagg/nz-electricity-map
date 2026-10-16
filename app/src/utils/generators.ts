import type { Generator, Unit } from '../types'
import { CHARGING_FUEL_CODE } from './colours'
import { nzNowMs, nzWallClockMs } from './time'
import type { Period } from './time'

// Commissioning dates are real instants (e.g. "2021-07-21T02:00:00.000Z"), put in the
// "local time as UTC" convention (see utils/time.ts) to compare with dispatch times.
// The same few dozen dates come up on every render, so each is converted once.
const instants = new Map<string, number>()
function instantMs(iso: string): number {
  let ms = instants.get(iso)
  if (ms === undefined) {
    const instant = Date.parse(iso)
    // nzWallClockMs goes by the second, so the milliseconds go back on (an end at 1:59:59.999pm
    // must stay before a start at 2pm)
    ms = nzWallClockMs(instant) + ((instant % 1000) + 1000) % 1000
    instants.set(iso, ms)
  }
  return ms
}

// A unit is in service from its commissioning through its decommissioning, the
// last instant it was (as when a unit moves node, e.g. Pātea's old nodes end at
// 1:59:59.999pm as its new ones start at 2pm). One not yet given a commissioning
// date is still being commissioned, so isn't in service yet.
function serviceStart(unit: Unit): number {
  return unit.commissioned ? instantMs(unit.commissioned) : Infinity
}

function serviceEnd(unit: Unit): number {
  return unit.decomissioned ? instantMs(unit.decomissioned) : Infinity
}

export function inServiceAt(unit: Unit, atMs: number): boolean {
  return serviceStart(unit) <= atMs && atMs <= serviceEnd(unit)
}

// In service at any point in the period, so it has dispatch data to show there
export function inServiceDuring(unit: Unit, period: Period): boolean {
  return serviceStart(unit) <= period.to && period.from <= serviceEnd(unit)
}

export function isDecommissioned(unit: Unit, atMs = nzNowMs()): boolean {
  return serviceEnd(unit) < atMs
}

// Not in service yet: still being commissioned, or due to be. The live views show
// one once it's dispatching, though it doesn't count towards capacity until it's in service.
export function isCommissioning(unit: Unit, atMs = nzNowMs()): boolean {
  return atMs < serviceStart(unit)
}

// Where any of the units come into or go out of service between `from` and `to`,
// stepping their total capacity
export function serviceChangesBetween(units: Unit[], from: number, to: number): number[] {
  return units
    .flatMap((u) => [serviceStart(u), serviceEnd(u) + 1])
    .filter((ms) => ms > from && ms <= to)
}

// A generator is retired once all of its units are decommissioned. One whose units
// are still being commissioned isn't.
export function isRetired(g: Generator, atMs = nzNowMs()): boolean {
  return g.units.every((u) => isDecommissioned(u, atMs))
}

export function isCharging(unit: Unit): boolean {
  return unit.fuelCode === CHARGING_FUEL_CODE
}

// What a unit's name is marked with: a battery's charging unit, to tell it apart
// from its discharging one, and a unit still being commissioned
export function unitNotes(unit: Unit): string {
  return [isCharging(unit) && 'charging', isCommissioning(unit) && 'commissioning'].filter(Boolean).join(', ')
}

export function unitLabel(unit: Unit): string {
  const notes = unitNotes(unit)
  return notes ? `${unit.name} (${notes})` : unit.name
}

// A unit's name without its generator's leading it ("Huntly Unit 5" is "Unit 5"),
// for where the generator is already named. A unit named just as its generator is ''.
export function shortUnitName(unitName: string, generatorName: string): string {
  if (!unitName.startsWith(generatorName)) return unitName
  const rest = unitName.slice(generatorName.length)
  // Only a whole word, so "Te" wouldn't cut "Tekapo" short
  return rest === '' || /^[\s-]/.test(rest) ? rest.replace(/^[\s-]+/, '') : unitName
}

// Every unit by its node. A node shared by several units maps to the first.
export function unitsByNode(generators: Generator[]): Map<string, Unit> {
  const units = new Map<string, Unit>()
  for (const unit of generators.flatMap((g) => g.units)) {
    if (!units.has(unit.node)) units.set(unit.node, unit)
  }
  return units
}
