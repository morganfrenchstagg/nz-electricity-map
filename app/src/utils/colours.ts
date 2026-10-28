import type maplibregl from 'maplibre-gl'

const DEFAULT_COLOUR = '#ff0000'

// Single source of truth for fuel identity, display, and colour.
// fuelNames lists all unit.fuel values that map to this fuel code
// (used to build FUEL_COLOURS for MapLibre and the generator adapter).
// renewable marks the fuels counted in the grid's renewable share.
const FUELS = [
  { code: 'HYD', label: 'Hydro', colour: 'rgb(69, 130, 180)', fuelNames: ['Hydro'], renewable: true },
  { code: 'WIN', label: 'Wind', colour: 'rgb(65, 117, 5)', fuelNames: ['Wind'], renewable: true },
  { code: 'GEO', label: 'Geothermal', colour: '#ff0000', fuelNames: ['Geothermal'], renewable: true },
  { code: 'SOL', label: 'Solar', colour: 'rgb(254, 213, 0)', fuelNames: ['Solar'], renewable: true },
  { code: 'GAS', label: 'Gas', colour: 'rgb(253, 180, 98)', fuelNames: ['Gas'], renewable: false },
  { code: 'CLG', label: 'Coal / Gas', colour: 'rgb(139, 87, 42)', fuelNames: ['Coal/Gas'], renewable: false },
  { code: 'DIE', label: 'Diesel', colour: 'rgb(135, 72, 0)', fuelNames: ['Diesel'], renewable: false },
  { code: 'BIO', label: 'Biomass', colour: '#6a3d9a', fuelNames: ['Biomass'], renewable: true },
  { code: 'BESS', label: 'Battery (discharging)', colour: '#76721E', fuelNames: ['Battery', 'Battery (Discharging)'], renewable: true },
  { code: 'BESS-C', label: 'Battery (charging)', colour: '#76721E', fuelNames: ['Battery (Charging)'], renewable: false },
  { code: 'HVDC-IN', label: 'Imported', colour: '#6366f1', fuelNames: [], renewable: false },
  { code: 'HVDC-OUT', label: 'Exported', colour: '#6366f1', fuelNames: [], renewable: false },
] as const

// A battery's charging is listed as a unit of its own. It draws power rather
// than generating it, so it's left out of capacity and generation totals.
export const CHARGING_FUEL_CODE = 'BESS-C'

// Not a fuel, but charted as one in GridOverviewPanel's island views: the HVDC
// bringing power into the island like a generator, or taking it out below zero,
// like a battery charging. The panel names them for the island at the other end.
export const HVDC_IMPORT_CODE = 'HVDC-IN'
export const HVDC_EXPORT_CODE = 'HVDC-OUT'

// A battery's charging and discharging units are listed as one fuel, Battery
export function fuelFamily(fuel: string): string {
  return fuel === 'Battery (Charging)' || fuel === 'Battery (Discharging)' ? 'Battery' : fuel
}

// Each fuel family among `fuels` (unit.fuel names), in display order, with its colour
export function fuelFamilies(fuels: string[]): { label: string; colour: string }[] {
  return [...new Set(fuels.map(fuelFamily))]
    .sort((a, b) => (FUEL_NAME_SORT_INDEX[a] ?? 99) - (FUEL_NAME_SORT_INDEX[b] ?? 99))
    .map((label) => ({ label, colour: fuelColour(label) }))
}

// Derived lookups — all keyed by fuel code
export const FUEL_CODE_COLOURS: Record<string, string> =
  Object.fromEntries(FUELS.map(f => [f.code, f.colour]))

export const FUEL_CODE_LABELS: Record<string, string> =
  Object.fromEntries(FUELS.map(f => [f.code, f.label]))

export const RENEWABLE_FUEL_CODES: ReadonlySet<string> =
  new Set(FUELS.filter(f => f.renewable).map(f => f.code))

// Canonical display order for fuel codes (used in GridOverviewPanel, and by fuel name via FUEL_NAME_SORT_INDEX)
export const FUEL_CODE_ORDER = ['HVDC-IN', 'BESS', 'DIE', 'HYD', 'SOL', 'WIN', 'GAS', 'CLG', 'BIO', 'GEO', 'BESS-C', 'HVDC-OUT'] as const

// Sort index keyed by unit.fuel name — derived from FUEL_CODE_ORDER so both use the same ordering
export const FUEL_NAME_SORT_INDEX: Record<string, number> =
  Object.fromEntries(FUELS.flatMap(f => {
    const idx = FUEL_CODE_ORDER.indexOf(f.code as typeof FUEL_CODE_ORDER[number])
    return f.fuelNames.map(name => [name, idx === -1 ? 99 : idx])
  }))

// Keyed by unit.fuel name — used by the generator adapter and MapLibre expression
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

// ['match', input, label, output, label, output, ..., fallback]. MapLibre's
// type needs the first label/output pair written out, which a spread of the
// whole table can't promise, so it's split off from the rest.
function matchExpression(
  input: maplibregl.ExpressionSpecification,
  [first, ...rest]: [string | number, string][],
  fallback: string,
): maplibregl.ExpressionSpecification {
  return ['match', input, ...first, ...rest.flat(), fallback]
}

export const MAPLIBRE_COLOUR_EXPRESSION = matchExpression(
  ['get', 'fuel'],
  Object.entries(FUEL_COLOURS),
  DEFAULT_COLOUR,
)

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

export const MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION = matchExpression(
  ['to-number', ['get', 'designvolt']],
  Object.entries(VOLTAGE_COLOURS).map(([kv, colour]) => [Number(kv), colour]),
  VOLTAGE_COLOUR_DEFAULT,
)

// Pill colours for an under-construction project's status, shared by the map
// popups and the pipeline table. The hue tracks how far along the build is.
export const STATUS_COLOURS: Record<string, { bg: string; text: string }> = {
  'Commissioning': { bg: '#dcfce7', text: '#15803d' },
  'Pre-Commissioning': { bg: '#d1fae5', text: '#059669' },
  'Under Construction': { bg: '#ffedd5', text: '#c2410c' },
  'Early Works': { bg: '#f3f4f6', text: '#374151' },
  'Committed': { bg: '#dbeafe', text: '#1d4ed8' },
}
export const STATUS_COLOUR_DEFAULT = { bg: '#f3f4f6', text: '#374151' }

export function statusColour(status: string): { bg: string; text: string } {
  return STATUS_COLOURS[status] ?? STATUS_COLOUR_DEFAULT
}
