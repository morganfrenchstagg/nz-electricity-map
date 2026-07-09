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

  if (abs === 0) {
    return `0 ${unit}`
  }

  return `${value} ${unit}`
}

/**
 * Format a MW value for display. Values ≥ 100 MW are shown as whole numbers;
 * smaller values get one decimal place to preserve meaningful precision.
 */
export function formatMW(value: number): string {
  return formatWithUnit(value, 'MW')
}

/**
 * Format a MWh value for display, using the same precision rules as formatMW.
 */
export function formatMWh(value: number): string {
  return formatWithUnit(value, 'MWh')
}
