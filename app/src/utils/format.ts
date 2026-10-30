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
 * The month of a "YYYY-MM-DD" date, e.g. "Mar 2026". Read and written in UTC,
 * so it doesn't land on the month before in browsers west of UTC.
 */
export function formatMonthYear(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`)
    .toLocaleDateString('en-NZ', { timeZone: 'UTC', month: 'short', year: 'numeric' })
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

/**
 * Format a GWh value for display, at formatWithUnit's precision.
 */
export function formatGWh(value: number): string {
  return formatWithUnit(value, 'GWh')
}

// A unit values are charted and shown in: its label, how many of the data's
// MW or MWh make one of it, and how to format a value already in it
export interface DisplayUnit {
  label: string
  size: number
  format: (value: number) => string
}

export const MW_UNIT: DisplayUnit = { label: 'MW', size: 1, format: formatMW }
const MWH_UNIT: DisplayUnit = { label: 'MWh', size: 1, format: formatMWh }
const GWH_UNIT: DisplayUnit = { label: 'GWh', size: 1000, format: formatGWh }
// Shares of a total, charted as percentages rather than divided down from MW or MWh
export const PERCENT_UNIT: DisplayUnit = { label: '%', size: 1, format: (value) => `${value.toFixed(1)}%` }

// Under 5 GWh, GWh would leave a chart's axis or a total on a few small,
// fiddly numbers
const GWH_FROM_MWH = 5000

/**
 * The unit for MWh values reaching up to `largestMWh`: GWh from 5 GWh, and
 * MWh below that.
 */
export function energyUnit(largestMWh: number): DisplayUnit {
  return Math.abs(largestMWh) < GWH_FROM_MWH ? MWH_UNIT : GWH_UNIT
}

/**
 * Format a MWh value for display in MWh or GWh, whichever energyUnit picks
 * for its size.
 */
export function formatEnergy(mwh: number): string {
  const unit = energyUnit(mwh)
  return unit.format(mwh / unit.size)
}
