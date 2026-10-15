import type { Generator, Unit } from '../types'
import { CHARGING_FUEL_CODE } from './colours'

// A generator is retired once all of its units are
export function isRetired(g: Generator): boolean {
  return !g.units.some((u) => u.active !== false)
}

export function isCharging(unit: Unit): boolean {
  return unit.fuelCode === CHARGING_FUEL_CODE
}

// A battery's charging unit is marked to tell it apart from its discharging one
export function unitLabel(unit: Unit): string {
  return isCharging(unit) ? `${unit.name} (charging)` : unit.name
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
