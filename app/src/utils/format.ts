/**
 * Fewer decimal places the larger the value, so small values keep their
 * precision without large ones getting noisy. Negative values go by their size.
 */
function formatWithUnit(value: number, unit: string): string {
  const abs = Math.abs(value)

  if (abs >= 1000) {
    return `${Math.round(value).toLocaleString('en-NZ')} ${unit}`
  }

  if (Number.isInteger(value)) {
    return `${value} ${unit}`
  }

  if (abs >= 100) {
    return `${value.toFixed(1)} ${unit}`
  }

  if (abs >= 5) {
    return `${value.toFixed(2)} ${unit}`
  }

  if (abs > 0) {
    return `${value.toFixed(3)} ${unit}`
  }

  return `${value} ${unit}`
}

/**
 * "YYYY-MM-DD" to e.g. "Mar 2026". In UTC, so browsers west of UTC don't show
 * the month before.
 */
export function formatMonthYear(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-NZ', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  })
}

export function formatMW(value: number): string {
  return formatWithUnit(value, 'MW')
}

export function formatMWh(value: number): string {
  return formatWithUnit(value, 'MWh')
}

export function formatGWh(value: number): string {
  return formatWithUnit(value, 'GWh')
}

// size: how many MW or MWh make one of the unit. format takes a value already
// in the unit.
export interface DisplayUnit {
  label: string
  size: number
  format: (value: number) => string
}

export const MW_UNIT: DisplayUnit = { label: 'MW', size: 1, format: formatMW }
const MWH_UNIT: DisplayUnit = { label: 'MWh', size: 1, format: formatMWh }
const GWH_UNIT: DisplayUnit = { label: 'GWh', size: 1000, format: formatGWh }
// For shares of a total, not converted from MW or MWh
export const PERCENT_UNIT: DisplayUnit = { label: '%', size: 1, format: (value) => `${value.toFixed(1)}%` }

// Below 5 GWh, values in GWh are small and fiddly on an axis or a total
const GWH_FROM_MWH = 5000

export function energyUnit(largestMWh: number): DisplayUnit {
  return Math.abs(largestMWh) < GWH_FROM_MWH ? MWH_UNIT : GWH_UNIT
}

export function formatEnergy(mwh: number): string {
  const unit = energyUnit(mwh)
  return unit.format(mwh / unit.size)
}
