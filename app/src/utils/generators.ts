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
