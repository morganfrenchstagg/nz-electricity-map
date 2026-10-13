/**
 * Formats a value with fewer decimal places the larger it is, so small values
 * keep their precision without large ones getting noisy:
 * - 1000 and over: rounded to a whole number, with thousands separators
 * - whole numbers: as they are
 * - 100 and over: one decimal place
 * - 5 and over: two decimal places
 * - under 5: three decimal places
 * Negative values follow the same rules by their size.
 */
function formatWithUnit(value: number, unit: string): string {
  const abs = Math.abs(value)

  if (abs >= 1000) {
    return `${Math.round(value).toLocaleString('en-NZ')} ${unit}`;
  }

  if (Number.isInteger(value)) {
    return `${value} ${unit}`;
  }

  if (abs >= 100) {
    return `${value.toFixed(1)} ${unit}`;
  }

  if (abs >= 5) {
    return `${value.toFixed(2)} ${unit}`;
  }

  if (abs > 0) {
    return `${value.toFixed(3)} ${unit}`;
  }

  return `${value} ${unit}`
}

/**
 * Format a MW value for display, at formatWithUnit's precision.
 */
export function formatMW(value: number): string {
  return formatWithUnit(value, 'MW')
}

/**
 * Format a MWh value for display, at formatWithUnit's precision.
 */
export function formatMWh(value: number): string {
  return formatWithUnit(value, 'MWh')
}
