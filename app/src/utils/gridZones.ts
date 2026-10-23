import { isGeneratorCode } from './chart'
import { fuelFamily } from './colours'
import { isCharging } from './generators'
import type { RecentData, Substation, Unit } from '../types'

export interface GridZoneTotals {
  demandMW: number
  generationMW: number
  // Generation by fuel family, largest first, leaving out fuels generating nothing
  byFuel: { fuel: string; mw: number }[]
}

// A grid zone's demand and generation in the latest interval of `data`. Every code starts with
// its substation's siteId, and the substation says which zone it's in.
export function gridZoneTotals(zone: number, data: RecentData | null, substations: Substation[], unitsByNode: Map<string, Unit>): GridZoneTotals | null {
  const lastRow = data?.data[data.data.length - 1]
  if (!data || !lastRow) return null
  const sites = new Set(substations.filter(s => s.gridZone === zone).map(s => s.siteId))
  let demandMW = 0
  const fuels = new Map<string, number>()
  data.series.forEach((code, i) => {
    if (!sites.has(code.slice(0, 3))) return
    const mw = (lastRow[i + 1] as number) || 0
    const unit = isGeneratorCode(code) ? unitsByNode.get(code) : undefined
    // A bus's load is negative generation, as is a battery's charging, which draws power
    // rather than generating it
    if (!isGeneratorCode(code) || (unit && isCharging(unit))) {
      demandMW -= mw
      return
    }
    const fuel = unit ? fuelFamily(unit.fuel) : 'Unknown'
    fuels.set(fuel, (fuels.get(fuel) ?? 0) + mw)
  })
  const byFuel = [...fuels]
    .map(([fuel, mw]) => ({ fuel, mw }))
    .filter(f => f.mw > 0)
    .sort((a, b) => b.mw - a.mw)
  return { demandMW, generationMW: byFuel.reduce((sum, f) => sum + f.mw, 0), byFuel }
}
