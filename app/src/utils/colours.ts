import type maplibregl from 'maplibre-gl'

const DEFAULT_COLOUR = '#ff0000'

// Single source of truth for fuel identity, display, and colour.
// fuelNames lists all unit.fuel values that map to this fuel code
// (used to build FUEL_COLOURS for MapLibre and the NodePanel adapter).
const FUELS = [
  { code: 'HYD', label: 'Hydro', colour: 'rgb(69, 130, 180)', fuelNames: ['Hydro'] },
  { code: 'WIN', label: 'Wind', colour: 'rgb(65, 117, 5)', fuelNames: ['Wind'] },
  { code: 'GEO', label: 'Geothermal', colour: '#ff0000', fuelNames: ['Geothermal'] },
  { code: 'SOL', label: 'Solar', colour: 'rgb(254, 213, 0)', fuelNames: ['Solar'] },
  { code: 'GAS', label: 'Gas', colour: 'rgb(253, 180, 98)', fuelNames: ['Gas'] },
  { code: 'CLG', label: 'Coal / Gas', colour: 'rgb(139, 87, 42)', fuelNames: ['Coal/Gas'] },
  { code: 'DIE', label: 'Diesel', colour: 'rgb(135, 72, 0)', fuelNames: ['Diesel'] },
  { code: 'BESS', label: 'Battery (discharging)', colour: '#76721E', fuelNames: ['Battery', 'Battery (Discharging)'] },
  { code: 'BESS-C', label: 'Battery (charging)', colour: '#76721E', fuelNames: ['Battery (Charging)'] },
] as const

// Derived lookups — all keyed by fuel code
export const FUEL_CODE_COLOURS: Record<string, string> =
  Object.fromEntries(FUELS.map(f => [f.code, f.colour]))

export const FUEL_CODE_LABELS: Record<string, string> =
  Object.fromEntries(FUELS.map(f => [f.code, f.label]))

// Canonical display order for fuel codes (used in GridOverviewPanel and NodePanel)
export const FUEL_CODE_ORDER = ['BESS', 'DIE', 'HYD', 'SOL', 'WIN', 'GAS', 'CLG', 'GEO', 'BESS-C'] as const

// Sort index keyed by unit.fuel name — derived from FUEL_CODE_ORDER so both use the same ordering
export const FUEL_NAME_SORT_INDEX: Record<string, number> =
  Object.fromEntries(FUELS.flatMap(f => {
    const idx = FUEL_CODE_ORDER.indexOf(f.code as typeof FUEL_CODE_ORDER[number])
    return f.fuelNames.map(name => [name, idx === -1 ? 99 : idx])
  }))

// Keyed by unit.fuel name — used by NodePanel adapter and MapLibre expression
export const FUEL_COLOURS: Record<string, string> =
  Object.fromEntries(FUELS.flatMap(f => f.fuelNames.map(name => [name, f.colour])))

export function fuelColour(fuel: string): string {
  return FUEL_COLOURS[fuel] ?? DEFAULT_COLOUR
}

export function fuelCodeColour(code: string): string {
  return FUEL_CODE_COLOURS[code] ?? DEFAULT_COLOUR
}

export function fuelCodeLabel(code: string): string {
  return FUEL_CODE_LABELS[code] ?? code
}

export const MAPLIBRE_COLOUR_EXPRESSION: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'fuel'],
  ...Object.entries(FUEL_COLOURS).flat(),
  DEFAULT_COLOUR,
]

export const VOLTAGE_COLOURS: Record<number, string> = {
  220: '#c0392b',
  110: '#8e44ad',
  66: '#2471a3',
  33: '#27ae60',
  11: '#d68910',
}
export const VOLTAGE_COLOUR_DEFAULT = '#7f8c8d'

export function voltageColour(kv: number): string {
  return VOLTAGE_COLOURS[kv] ?? VOLTAGE_COLOUR_DEFAULT
}

export const MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION: maplibregl.ExpressionSpecification = [
  'match',
  ['to-number', ['get', 'designvolt']],
  ...Object.entries(VOLTAGE_COLOURS).flatMap(([kv, colour]) => [Number(kv), colour]),
  VOLTAGE_COLOUR_DEFAULT,
]
