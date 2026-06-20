export const FUEL_COLOURS: Record<string, string> = {
  Wind: '#87CEEB',
  Hydro: '#191970',
  Geothermal: '#ffaf40',
  Solar: '#ccff00',
  Battery: '#76721E',
  'Battery (Discharging)': '#76721E',
  'Battery (Charging)': '#76721E',
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
