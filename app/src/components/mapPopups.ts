import { ucUnitsForSite } from '../utils/geo'
import type { UnderConstructionUnit } from '../utils/geo'
import { underConstruction } from '../../../frontend/old/utilities/underConstruction'
import { fuelColour, fuelFamilies, statusColour, voltageColour } from '../utils/colours'
import { formatMW, formatMonthYear } from '../utils/format'
import { busLabel, isGeneratorCode } from '../utils/chart'
import { inServiceAt, inServiceDuring, isCharging, isCommissioning, isDecommissioned, shortUnitName, unitNotes } from '../utils/generators'
import { installedCapacityOf, unitCapacityAt, unitOutageMWAt } from '../utils/outages'
import type { Period } from '../utils/time'
import type { OutageData } from '../api'
import type { Generator, Substation, RecentData, Unit } from '../types'

// HTML for the map's hover popups, which MapLibre takes as a string rather than React

function renderUnitStats(u: { capacityMW: number | null; capacityMWp: number | null; capacityMWh: number | null; yearlyGenerationGWh: number | null; openBy: string | null }): string {
  const capacityParts = [
    u.capacityMW ? `${u.capacityMW} MW` : null,
    u.capacityMWp ? `${u.capacityMWp} MWp` : null,
    u.capacityMWh ? `${u.capacityMWh} MWh` : null,
  ].filter(Boolean).join(' / ')
  return [
    capacityParts ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Capacity</span><span>${capacityParts}</span></div>` : '',
    u.yearlyGenerationGWh ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Annual generation</span><span>${u.yearlyGenerationGWh} GWh</span></div>` : '',
    u.openBy ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Expected open</span><span>${formatMonthYear(u.openBy)}</span></div>` : '',
  ].filter(Boolean).join('')
}

function renderStatusPill(status: string): string {
  const pillColour = statusColour(status)
  return status
    ? `<span style="display:inline-block;padding:var(--space-2xs) var(--space-md);border-radius:999px;background:${pillColour.bg};color:${pillColour.text};font-size:var(--font-size-xs);font-weight:500;flex-shrink:0">${status}</span>`
    : ''
}

// The generator panel's capacity bar stripes, in red to stand out on a 3px bar
const OUTAGE_STRIPES = 'repeating-linear-gradient(45deg, var(--color-danger) 0, var(--color-danger) 2px, transparent 2px, transparent 5px)'

type PopupUnit = Unit & { outageMW: number; available: number }

function dotHtml(colour: string): string {
  return `<span style="width:8px;height:8px;border-radius:50%;background:${colour};flex-shrink:0"></span>`
}

// A unit's 3px bar: its generation from the start, and any outage at the far end.
// An outage leaves what's left of installed capacity (see unitCapacityAt), so the
// bar is then scaled to installed capacity to fit the outage in beside generation.
// `reversed` runs it right to left, for a battery's charging half.
function unitBarHtml(u: PopupUnit, genMW: number | null, reversed = false): string {
  const scale = Math.abs(u.outageMW > 0 ? installedCapacityOf(u) : u.available)
  const fillPct = genMW !== null && scale !== 0 ? Math.min(100, (Math.abs(genMW) / scale) * 100) : 0
  return `<div style="flex:1;display:flex;${reversed ? 'flex-direction:row-reverse;' : ''}justify-content:space-between;height:3px;background:var(--color-fill);border-radius:2px;overflow:hidden">
    <div style="width:${fillPct}%;background:${fuelColour(u.fuel)};border-radius:2px"></div>
    ${u.outageMW > 0 ? `<div style="width:${Math.min(100 - fillPct, (u.outageMW / scale) * 100)}%;background:${OUTAGE_STRIPES}"></div>` : ''}
  </div>`
}

// `period` is what the map shows (see periodOf): its units, and their outages at its end.
// The `live` views (Today and 3d) also list units still being commissioned once they're
// dispatching, shown as though in full outage so they don't count towards capacity.
// Units retired by its end are listed without capacity, except those that moved node
// (as Pātea's did), which are only listed at the node they moved to.
export function generatorPopupHtml(generator: Generator, data: RecentData | null, outages: OutageData | null, period: Period, live: boolean): string {
  const lastRow = data?.data[data.data.length - 1]
  const atMs = period.to
  const genOf = (u: Unit): number | null => {
    const idx = data ? data.series.indexOf(u.node) : -1
    return (idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : null
  }
  const commissioning = (u: Unit) => live && isCommissioning(u, atMs) && genOf(u) !== null
  const retired = (u: Unit) => isDecommissioned(u, atMs)
  const movedOn = (u: Unit) => retired(u) && generator.units.some(s => s.unitCode === u.unitCode && inServiceAt(s, atMs))
  const activeUnits: PopupUnit[] = generator.units
    .filter(u => (inServiceDuring(u, period) && !movedOn(u)) || commissioning(u))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => commissioning(u)
      ? { ...u, outageMW: Math.abs(installedCapacityOf(u)), available: 0 }
      : retired(u) ? { ...u, capacity: 0, outageMW: 0, available: 0 }
        : { ...u, outageMW: outages ? unitOutageMWAt(u, outages, atMs) : 0, available: unitCapacityAt(u, outages, atMs) })
  // A battery's charging unit goes by its discharging unit's name, and shares its row:
  // one bar out from zero in the middle, charging to the left and discharging to the right
  const chargingUnitOf = (u: PopupUnit) => isCharging(u) ? undefined : activeUnits.find(c => isCharging(c) && c.name === u.name)
  const pairedCharging = new Set(activeUnits.map(chargingUnitOf))
  // The popup's heading already names the generator, so unit names drop it, and a
  // unit named just as its generator goes unnamed
  const rows = activeUnits.filter(u => !pairedCharging.has(u)).map(u => ({ u, name: shortUnitName(u.name, generator.name) }))
  // With one row, or none named, the fuel goes under the heading as in the generator
  // panel, in place of a dot on each row
  const fuelInHeading = rows.length === 1 || rows.every(r => !r.name)
  const unitRows = rows.map(({ u, name }) => {
    const charging = chargingUnitOf(u)
    const chargeMW = charging ? genOf(charging) : null
    const dischargeMW = genOf(u)
    const genMW = chargeMW === null ? dischargeMW : (dischargeMW ?? 0) + chargeMW
    // A charging battery is measured against what it can draw rather than what it can give
    const capUnit = charging && (genMW ?? 0) < 0 ? charging : u
    const { outageMW, available } = capUnit
    const pct = genMW !== null && available !== 0 ? Math.min(100, Math.round((Math.abs(genMW) / Math.abs(available)) * 100)) : 0
    const colour = fuelColour(u.fuel)
    const genStr = genMW !== null ? formatMW(genMW) : '—'
    // An outage strikes out the usual capacity for what's left, in red
    const capStr = capUnit.capacity === 0 ? null
      : outageMW > 0 ? `<s style="color:var(--color-text-faint)">${formatMW(capUnit.capacity)}</s> <span style="color:var(--color-danger)">${formatMW(available)}</span>`
        : formatMW(available)
    const isGenerating = (genMW ?? 0) !== 0
    const notes = [unitNotes(u), retired(u) && 'retired'].filter(Boolean).join(', ')
    const label = !notes ? name
      : name ? `${name} <span style="color:var(--color-text-muted)">(${notes})</span>`
        : `<span style="color:var(--color-text-muted)">${notes[0].toUpperCase()}${notes.slice(1)}</span>`
    return `<div>
      <div style="display:flex;align-items:center;gap:6px">
        ${fuelInHeading ? '' : dotHtml(colour)}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isGenerating ? 'var(--color-text-strong)' : 'var(--color-text-faint)'}">${label}</span>
        <span style="color:${isGenerating ? 'var(--color-text-strong)' : 'var(--color-text-faint)'};white-space:nowrap;font-weight:${isGenerating ? '600' : '400'}">${genStr}${capStr ? ` <span style="font-weight:400;color:var(--color-text-muted)">/ ${capStr}${genMW !== null ? ` (${pct}%)` : ''}</span>` : ''}</span>
      </div>
      <div style="display:flex;align-items:center;margin-top:3px;margin-left:${fuelInHeading ? 0 : 14}px">
        ${charging ? `${unitBarHtml(charging, chargeMW, true)}<div style="width:1px;height:7px;margin:-2px 1px;background:var(--color-text-faint);flex-shrink:0"></div>` : ''}
        ${unitBarHtml(u, dischargeMW)}
      </div>
    </div>`
  }).join('')
  const totalGen = activeUnits.reduce((sum, u) => sum + (genOf(u) ?? 0), 0)
  const generatingUnits = activeUnits.filter(u => !isCharging(u))
  const totalCap = generatingUnits.reduce((sum, u) => sum + u.available, 0)
  const totalPct = totalCap > 0 ? Math.min(100, Math.round((totalGen / totalCap) * 100)) : 0
  const hasOutage = activeUnits.some(u => u.outageMW > 0)
  // As in the generator panel, an outage strikes out the usual capacity
  const totalCapStr = hasOutage
    ? `<s style="color:var(--color-text-faint)">${formatMW(generatingUnits.reduce((sum, u) => sum + u.capacity, 0))}</s> ${formatMW(totalCap)}`
    : formatMW(totalCap)
  // A single row would only repeat itself as the total
  const totalRow = rows.length > 1 ? `
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:var(--space-md)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--color-text-muted)">Total</span>
        <span style="font-weight:600">${formatMW(totalGen)} <span style="font-weight:400;color:var(--color-text-muted)">/ ${totalCapStr} (${totalPct}%)</span></span>
      </div>
    </div>` : ''
  const fuels = fuelInHeading
    ? fuelFamilies(activeUnits.map(u => u.fuel)).map(f => `<span style="display:flex;align-items:center;gap:3px"><span style="margin-right:3px">|</span>${dotHtml(f.colour)}${f.label}</span>`).join('')
    : ''
  const ucUnits = generator.site ? ucUnitsForSite(underConstruction, generator.site) : []
  const ucSection = ucUnits.length > 0 ? `
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:${totalRow ? '2px' : 'var(--space-md)'}">
      <div class="eyebrow" style="margin-bottom:4px">Under Construction</div>
      ${ucUnits.map((u, i) => {
        const label = u.locationDescription ?? `Unit ${i + 1}`
        const stats = renderUnitStats(u)
        return `<div style="${i > 0 ? 'margin-top:6px;border-top:1px solid var(--color-divider-subtle);padding-top:var(--space-sm)' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span style="font-weight:500">${label}</span>${renderStatusPill(u.status)}
          </div>
          ${stats}
        </div>`
      }).join('')}
    </div>` : ''
  // As wide as its content, so the operator line and unit names fit without running
  // under the site code or being cut short. The operator line sits in the name's
  // column, leaving the site code a column of its own.
  return `<div style="font-size:var(--font-size-sm);line-height:1.5;min-width:240px">
    <div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:1px 12px;margin-bottom:6px">
      <span style="font-weight:600">${generator.name}</span>
      <span style="background:var(--color-accent-subtle);color:var(--color-accent-strong);border-radius:4px;padding:1px var(--space-sm);font-size:var(--font-size-2xs);font-weight:600">${generator.site}</span>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0 6px;color:var(--color-text-muted)">
        <span>${generator.operator}${generator.secondaryOperator ? ` / ${generator.secondaryOperator}` : ''}</span>${fuels}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--color-divider);padding-top:var(--space-sm)">${unitRows}</div>
    ${totalRow}
    ${ucSection}
  </div>`
}

export function underConstructionPopupHtml(name: string, units: UnderConstructionUnit[]): string {
  if (units.length === 1) {
    const u = units[0]
    const label = u.locationDescription ? `${name} <span style="font-weight:400;color:var(--color-text-muted)">(${u.locationDescription})</span>` : name
    const stats = renderUnitStats(u)
    return `<div style="font-size:var(--font-size-sm);line-height:1.6;width:260px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px"><span style="font-weight:600">${label}</span>${renderStatusPill(u.status)}</div>
      <div style="color:var(--color-text-muted)">${u.operator}</div>
      ${stats ? `<div style="margin-top:4px;border-top:1px solid var(--color-divider);padding-top:var(--space-xs)">${stats}</div>` : ''}
    </div>`
  }
  const unitRows = units.map((u, i) => {
    const label = u.locationDescription ?? `Unit ${i + 1}`
    const stats = renderUnitStats(u)
    return `<div style="${i > 0 ? 'margin-top:6px;border-top:1px solid var(--color-divider);padding-top:var(--space-sm)' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:500">${label}</span>${renderStatusPill(u.status)}</div>
      ${stats}
    </div>`
  }).join('')
  return `<div style="font-size:var(--font-size-sm);line-height:1.6;width:260px">
    <div style="font-weight:600;margin-bottom:2px">${name}</div>
    <div style="color:var(--color-text-muted);margin-bottom:6px">${units[0].operator}</div>
    ${unitRows}
  </div>`
}

export function substationPopupHtml(substation: Substation, data: RecentData | null, unitsByNode: Map<string, Unit>): string {
  const lastRow = data?.data[data.data.length - 1]
  const codes = data ? data.series.filter(s => s.startsWith(substation.siteId)) : []
  const busCodes = codes.filter(c => !isGeneratorCode(c))
  const genCodes = codes.filter(isGeneratorCode)
  const renderRow = (label: string, colour: string, loadMW: number | null) => {
    const isActive = (loadMW ?? 0) !== 0
    const loadStr = loadMW !== null ? formatMW(loadMW) : '—'
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
      ${dotHtml(colour)}
      <span style="flex:1;color:${isActive ? 'var(--color-text-strong)' : 'var(--color-text-faint)'}">${label}</span>
      <span style="color:${isActive ? 'var(--color-text-strong)' : 'var(--color-text-faint)'};font-weight:${isActive ? '600' : '400'};white-space:nowrap">${loadStr}</span>
    </div>`
  }
  const busRows = busCodes.map(code => {
    const idx = data ? data.series.indexOf(code) : -1
    const loadMW = (idx !== -1 && lastRow) ? -((lastRow[idx + 1] as number) || 0) : null
    const kv = code.length >= 4 ? parseInt(code.slice(-4, -1), 10) : NaN
    return renderRow(busLabel(code, busCodes), voltageColour(kv), loadMW)
  }).join('')
  const genRows = genCodes
    .map(code => ({ code, unit: unitsByNode.get(code) }))
    .sort((a, b) => (a.unit?.name ?? a.code).localeCompare(b.unit?.name ?? b.code))
    .map(({ code, unit }) => {
      const idx = data ? data.series.indexOf(code) : -1
      const genMW = (idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : null
      const label = unit ? (isCharging(unit) ? `${unit.name} <span style="color:var(--color-text-muted)">(charging)</span>` : unit.name) : code
      const colour = unit ? fuelColour(unit.fuel) : 'var(--color-text-muted)'
      return renderRow(label, colour, genMW)
    }).join('')
  const totalLoad = busCodes.reduce((sum, code) => {
    const idx = data ? data.series.indexOf(code) : -1
    return sum + ((idx !== -1 && lastRow) ? -((lastRow[idx + 1] as number) || 0) : 0)
  }, 0)
  const totalGen = genCodes.reduce((sum, code) => {
    const idx = data ? data.series.indexOf(code) : -1
    return sum + ((idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : 0)
  }, 0)
  const netLoad = totalLoad - totalGen
  return `<div style="font-size:var(--font-size-sm);line-height:1.5;width:240px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1px">
      <span style="font-weight:600">${substation.description} Substation</span>
      <span style="background:var(--color-surface-muted);color:var(--color-text);border-radius:4px;padding:1px var(--space-sm);font-size:var(--font-size-2xs);font-weight:600;flex-shrink:0">${substation.siteId}</span>
    </div>
    ${codes.length > 0 ? `
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:6px">${busRows}</div>
    ${genRows ? `<div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:2px">
      <div class="eyebrow" style="margin-bottom:4px">Generation</div>
      ${genRows}
    </div>` : ''}
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:2px;display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--color-text-muted)">Net load</span>
      <span style="font-weight:600">${formatMW(netLoad)}</span>
    </div>` : '<div style="color:var(--color-text-faint);margin-top:4px">No data</div>'}
  </div>`
}
