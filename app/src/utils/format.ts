/**
 * Format a MW value for display. Values ≥ 100 MW are shown as whole numbers;
 * smaller values get one decimal place to preserve meaningful precision.
 */
export function formatMW(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs >= 1000
    ? Math.round(value).toLocaleString('en-NZ')
    : abs >= 100
      ? Math.round(value).toString()
      : value.toFixed(1)
  return `${formatted} MW`
}
