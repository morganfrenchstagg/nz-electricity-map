import { ucUnitsForSite } from '../utils/geo'
import type { UnderConstructionUnit } from '../utils/geo'
import { underConstruction } from '../../../frontend/old/utilities/underConstruction'
import { fuelColour, statusColour, voltageColour } from '../utils/colours'
import { formatMW, formatMonthYear } from '../utils/format'
import { busLabel, isGeneratorCode } from '../utils/chart'
import { isCharging } from '../utils/generators'
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

export function generatorPopupHtml(generator: Generator, data: RecentData | null): string {
  const lastRow = data?.data[data.data.length - 1]
  const activeUnits = generator.units.filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  const unitRows = activeUnits.map(u => {
    const idx = data ? data.series.indexOf(u.node) : -1
    const genMW = (idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : null
    const pct = genMW !== null && u.capacity !== 0 ? Math.min(100, Math.round((Math.abs(genMW) / Math.abs(u.capacity)) * 100)) : 0
    const colour = fuelColour(u.fuel)
    const genStr = genMW !== null ? formatMW(genMW) : '—'
    const capStr = u.capacity !== 0 ? formatMW(u.capacity) : null
    const isGenerating = (genMW ?? 0) !== 0
    return `<div style="margin-bottom:5px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${colour};flex-shrink:0"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isGenerating ? 'var(--color-text-strong)' : 'var(--color-text-faint)'}">${isCharging(u) ? `${u.name} <span style="color:var(--color-text-muted)">(charging)</span>` : u.name}</span>
        <span style="color:${isGenerating ? 'var(--color-text-strong)' : 'var(--color-text-faint)'};white-space:nowrap;font-weight:${isGenerating ? '600' : '400'}">${genStr}${capStr ? ` <span style="font-weight:400;color:var(--color-text-muted)">/ ${capStr}${genMW !== null ? ` (${pct}%)` : ''}</span>` : ''}</span>
      </div>
      <div style="height:3px;background:var(--color-fill);border-radius:2px;margin-top:3px;margin-left:14px">
        <div style="height:3px;width:${pct}%;background:${colour};border-radius:2px"></div>
      </div>
    </div>`
  }).join('')
  const totalGen = activeUnits.reduce((sum, u) => {
    const idx = data ? data.series.indexOf(u.node) : -1
    return sum + ((idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : 0)
  }, 0)
  const totalCap = activeUnits.filter(u => !isCharging(u)).reduce((sum, u) => sum + u.capacity, 0)
  const totalPct = totalCap > 0 ? Math.min(100, Math.round((totalGen / totalCap) * 100)) : 0
  const ucUnits = generator.site ? ucUnitsForSite(underConstruction, generator.site) : []
  const ucSection = ucUnits.length > 0 ? `
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-top:2px">
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
  return `<div style="font-size:var(--font-size-sm);line-height:1.5;width:240px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1px">
      <span style="font-weight:600">${generator.name}</span>
      <span style="background:var(--color-accent-subtle);color:var(--color-accent-strong);border-radius:4px;padding:1px var(--space-sm);font-size:var(--font-size-2xs);font-weight:600;flex-shrink:0">${generator.site}</span>
    </div>
    <div style="color:var(--color-text-muted);margin-bottom:6px">${generator.operator}${generator.secondaryOperator ? ` / ${generator.secondaryOperator}` : ''}</div>
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm);margin-bottom:4px">${unitRows}</div>
    <div style="border-top:1px solid var(--color-divider);padding-top:var(--space-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--color-text-muted)">Total</span>
        <span style="font-weight:600">${formatMW(totalGen)} <span style="font-weight:400;color:var(--color-text-muted)">/ ${formatMW(totalCap)} (${totalPct}%)</span></span>
      </div>
    </div>
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
      <span style="width:8px;height:8px;border-radius:50%;background:${colour};flex-shrink:0"></span>
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
