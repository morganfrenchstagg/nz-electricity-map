/**
 * Format a MW value for display. Values ≥ 100 MW are shown as whole numbers;
 * smaller values get one decimal place to preserve meaningful precision.
 */
export function formatMW(value: number): string {
  const abs = Math.abs(value)

  if (Number.isInteger(value)) {
    return `${value} MW`;
  }

  if (abs >= 1000) {
    return `${Math.round(value).toLocaleString('en-NZ')} MW`;
  }

  if (abs >= 100) {
    return `${value.toFixed(1)} MW`;
  }

  if (abs >= 5) {
    return `${value.toFixed(2)} MW`;
  }

  if (abs > 0) {
    return `${value.toFixed(3)} MW`;
  }

  if (abs === 0) {
    return '0 MW'
  }

  return `${value} MW`
}
