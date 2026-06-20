export const FUEL_COLOURS: Record<string, string> = {
  Wind: 'rgb(65, 117, 5)',
  Hydro: '#191970',
  Geothermal: '#ffaf40',
  Solar: 'rgb(254, 213, 0)',
  Battery: '#76721E',
  'Battery (Discharging)': '#76721E',
  'Battery (Charging)': '#76721E',
  'Coal/Gas': 'rgb(139, 87, 42)'
}

const DEFAULT_COLOUR = '#ff0000'

export function fuelColour(fuel: string): string {
  return FUEL_COLOURS[fuel] ?? DEFAULT_COLOUR
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
  66:  '#2471a3',
  33:  '#27ae60',
  11:  '#d68910',
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
