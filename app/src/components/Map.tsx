import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { generatorsToGeoJson, substationsToGeoJson, underConstructionToGeoJson, ucUnitsForSite } from '../utils/geo'
import type { UnderConstructionUnit } from '../utils/geo'
import { underConstruction } from '../../../frontend/old/utilities/underConstruction'
import { MAPLIBRE_COLOUR_EXPRESSION, MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION, fuelColour, statusColour, voltageColour } from '../utils/colours'
import { formatMW } from '../utils/format'
import { busLabel, isGeneratorCode } from '../utils/chart'
import { isCharging, unitsByNode } from '../utils/generators'
import { TRANSMISSION_LINES_URL } from '../api'
import type { Generator, Substation, SelectedNode, RecentData, Unit } from '../types'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LINZ_AERIAL_URL = 'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=c01kw0f06zmga8j2dmxg0fjz0ny'
const INITIAL_CENTER: [number, number] = [172.5, -41.3]
const INITIAL_ZOOM = 5

// Hoverable layers in priority order: generators > under-construction > substations.
// This prevents a nearby substation from stealing the popup when the cursor is over a generator.
const HOVER_LAYERS = ['generators-layer', 'under-construction-layer', 'substations-layer']

// Each hoverable source promotes its id property to the feature id, so this names the feature
// under the cursor and the popup is only rebuilt when it changes
const hoverKey = (feature?: maplibregl.MapGeoJSONFeature) => feature && `${feature.layer.id}:${feature.id}`

function renderUnitStats(u: { capacityMW: number | null; capacityMWp: number | null; capacityMWh: number | null; yearlyGenerationGWh: number | null; openBy: string | null }): string {
  const capacityParts = [
    u.capacityMW ? `${u.capacityMW} MW` : null,
    u.capacityMWp ? `${u.capacityMWp} MWp` : null,
    u.capacityMWh ? `${u.capacityMWh} MWh` : null,
  ].filter(Boolean).join(' / ')
  return [
    capacityParts ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Capacity</span><span>${capacityParts}</span></div>` : '',
    u.yearlyGenerationGWh ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Annual generation</span><span>${u.yearlyGenerationGWh} GWh</span></div>` : '',
    u.openBy ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--color-text-muted)">Expected open</span><span>${new Date(u.openBy).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}</span></div>` : '',
  ].filter(Boolean).join('')
}

function renderStatusPill(status: string): string {
  const pillColour = statusColour(status)
  return status
    ? `<span style="display:inline-block;padding:var(--space-2xs) var(--space-md);border-radius:999px;background:${pillColour.bg};color:${pillColour.text};font-size:var(--font-size-xs);font-weight:500;flex-shrink:0">${status}</span>`
    : ''
}

function generatorPopupHtml(generator: Generator, data: RecentData | null): string {
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

function underConstructionPopupHtml(name: string, units: UnderConstructionUnit[]): string {
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

function substationPopupHtml(substation: Substation, data: RecentData | null, unitsByNode: Map<string, Unit>): string {
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

interface Props {
  onGeneratorClick: (generator: Generator) => void
  onSubstationClick: (substation: Substation) => void
  onClear: () => void
  selectedNode: SelectedNode
  leftPanelOpen: boolean
  panelWidth: number
  recentData: RecentData | null
  isMobile?: boolean
}

export default function Map({ onGeneratorClick, onSubstationClick, onClear, selectedNode, leftPanelOpen, panelWidth, recentData, isMobile = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [showAerial, setShowAerial] = useState(false)
  const { generators, substations } = useDefinitions()
  const generatorsRef = useRef<Generator[]>(generators)
  const substationsRef = useRef<Substation[]>(substations)
  const nodeUnits = useMemo(() => unitsByNode(generators), [generators])
  const unitsByNodeRef = useRef(nodeUnits)
  const recentDataRef = useRef<RecentData | null>(null)
  // Rebuilds the open hover popup; set once the map has loaded
  const refreshHoverRef = useRef(() => {})
  const leftPanelOpenRef = useRef(leftPanelOpen)
  useEffect(() => { leftPanelOpenRef.current = leftPanelOpen }, [leftPanelOpen])
  const panelWidthRef = useRef(panelWidth)
  useEffect(() => { panelWidthRef.current = panelWidth }, [panelWidth])
  const isMobileRef = useRef(isMobile)
  useEffect(() => { isMobileRef.current = isMobile }, [isMobile])
  useEffect(() => {
    recentDataRef.current = recentData
    refreshHoverRef.current()
  }, [recentData])

  useEffect(() => { generatorsRef.current = generators }, [generators])
  useEffect(() => { substationsRef.current = substations }, [substations])
  useEffect(() => { unitsByNodeRef.current = nodeUnits }, [nodeUnits])

  // Keep callback refs so map event handlers always see the latest callbacks
  const onGeneratorClickRef = useRef(onGeneratorClick)
  const onSubstationClickRef = useRef(onSubstationClick)
  const onClearRef = useRef(onClear)
  useEffect(() => { onGeneratorClickRef.current = onGeneratorClick }, [onGeneratorClick])
  useEffect(() => { onSubstationClickRef.current = onSubstationClick }, [onSubstationClick])
  useEffect(() => { onClearRef.current = onClear }, [onClear])

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      if (leftPanelOpenRef.current && !isMobileRef.current) {
        map.setPadding({ left: panelWidthRef.current, right: 0, top: 0, bottom: 0 })
      }

      map.addSource('linz-aerial', {
        type: 'raster',
        tiles: [LINZ_AERIAL_URL],
        tileSize: 256,
        attribution: '© <a href="https://www.linz.govt.nz/crown-property/crown-copyright">LINZ CC BY 4.0</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      })
      map.addLayer({
        id: 'linz-aerial-layer',
        type: 'raster',
        source: 'linz-aerial',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1 },
      })

      map.addSource('transmission-lines', {
        type: 'geojson',
        data: TRANSMISSION_LINES_URL,
      })
      map.addLayer({
        id: 'transmission-lines-layer',
        type: 'line',
        source: 'transmission-lines',
        paint: {
          'line-color': MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION,
          'line-width': 1.5,
          'line-opacity': 0.7,
        },
      })

      map.addSource('under-construction', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'id',
      })
      map.addLayer({
        id: 'under-construction-layer',
        type: 'circle',
        source: 'under-construction',
        paint: {
          'circle-color': MAPLIBRE_COLOUR_EXPRESSION,
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addSource('substations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'siteId',
      })
      map.addLayer({
        id: 'substations-layer',
        type: 'circle',
        source: 'substations',
        paint: {
          'circle-color': '#888888',
          'circle-radius': 4,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addSource('generators', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'site',
      })
      map.addLayer({
        id: 'generators-layer',
        type: 'circle',
        source: 'generators',
        paint: {
          'circle-color': MAPLIBRE_COLOUR_EXPRESSION,
          'circle-radius': 7,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addSource('selected-node', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'selected-node-layer',
        type: 'circle',
        source: 'selected-node',
        paint: {
          'circle-color': 'transparent',
          'circle-radius': 13,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#3b82f6',
        },
      })

      map.on('click', (e) => {
        // Generators take priority over substations when both overlap
        const genFeatures = map.queryRenderedFeatures(e.point, { layers: ['generators-layer'] })
        if (genFeatures.length > 0) {
          const site = genFeatures[0].properties?.site as string | undefined
          const generator = generatorsRef.current.find((g) => g.site === site)
          if (generator) { onGeneratorClickRef.current(generator); return }
        }

        const subFeatures = map.queryRenderedFeatures(e.point, { layers: ['substations-layer'] })
        if (subFeatures.length > 0) {
          const siteId = subFeatures[0].properties?.siteId as string | undefined
          const substation = substationsRef.current.find((s) => s.siteId === siteId)
          if (substation) onSubstationClickRef.current(substation)
          return
        }

        onClearRef.current()
      })

      const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '300px' })
      let hovered: maplibregl.MapGeoJSONFeature | undefined

      const hoverHtml = (feature: maplibregl.MapGeoJSONFeature): string | null => {
        const p = feature.properties
        if (feature.layer.id === 'generators-layer') {
          const generator = generatorsRef.current.find(g => g.site === p.site)
          return generator ? generatorPopupHtml(generator, recentDataRef.current) : null
        }
        if (feature.layer.id === 'under-construction-layer') {
          return underConstructionPopupHtml(String(p.name ?? ''), JSON.parse(p.units ?? '[]'))
        }
        const substation = substationsRef.current.find(s => s.siteId === p.siteId)
        return substation ? substationPopupHtml(substation, recentDataRef.current, unitsByNodeRef.current) : null
      }

      // Builds the popup for the hovered feature; only called when that feature or the data changes
      const renderHover = () => {
        const html = hovered && hoverHtml(hovered)
        map.getCanvas().style.cursor = html ? 'pointer' : ''
        if (!html) { hoverPopup.remove(); return }
        hoverPopup.setHTML(html)
        if (!hoverPopup.isOpen()) hoverPopup.addTo(map)
      }
      refreshHoverRef.current = () => { if (hovered) renderHover() }

      map.on('mousemove', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: HOVER_LAYERS })
        const feature = HOVER_LAYERS.map(layer => features.find(f => f.layer.id === layer)).find(f => f)
        // Following the cursor is cheap; the popup is rebuilt only when the cursor reaches another feature
        hoverPopup.setLngLat(e.lngLat)
        if (hoverKey(feature) === hoverKey(hovered)) return
        hovered = feature
        renderHover()
      })

      map.getCanvas().addEventListener('mouseleave', () => {
        hovered = undefined
        renderHover()
      })
    })

    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || generators.length === 0) return
    const update = () => {
      const src = map.getSource('generators') as maplibregl.GeoJSONSource | undefined
      src?.setData(generatorsToGeoJson(generators))
    }
    map.isStyleLoaded() ? update() : map.once('load', update)
  }, [generators])

  useEffect(() => {
    const map = mapRef.current
    if (!map || generators.length === 0) return
    const update = () => {
      const src = map.getSource('under-construction') as maplibregl.GeoJSONSource | undefined
      src?.setData(underConstructionToGeoJson(underConstruction, generators))
    }
    map.isStyleLoaded() ? update() : map.once('load', update)
  }, [generators])

  useEffect(() => {
    const map = mapRef.current
    if (!map || substations.length === 0) return
    const update = () => {
      const src = map.getSource('substations') as maplibregl.GeoJSONSource | undefined
      src?.setData(substationsToGeoJson(substations))
    }
    map.isStyleLoaded() ? update() : map.once('load', update)
  }, [substations])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => {
      const src = map.getSource('selected-node') as maplibregl.GeoJSONSource | undefined
      if (!src) return
      if (!selectedNode) {
        src.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const points: [number, number][] =
        selectedNode.kind === 'generator' ? [[selectedNode.generator.location.long, selectedNode.generator.location.lat]]
          : selectedNode.kind === 'generators' ? selectedNode.generators.map(g => [g.location.long, g.location.lat])
            : [[selectedNode.substation.long, selectedNode.substation.lat]]
      src.setData({ type: 'FeatureCollection', features: points.map(coords => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} })) })
    }
    map.isStyleLoaded() ? update() : map.once('load', update)
  }, [selectedNode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const panelPadding = isMobile ? { left: 0, right: 0, top: 0, bottom: 0 } : { left: panelWidthRef.current, right: 0, top: 0, bottom: 0 }
    const zeroPadding = { left: 0, right: 0, top: 0, bottom: 0 }

    if (selectedNode) {
      const [lng, lat] = selectedNode.kind === 'generator'
        ? [selectedNode.generator.location.long, selectedNode.generator.location.lat]
        : selectedNode.kind === 'generators'
          ? [selectedNode.generators[0].location.long, selectedNode.generators[0].location.lat]
          : [selectedNode.substation.long, selectedNode.substation.lat]

      map.easeTo({ center: [lng, lat], padding: panelPadding, duration: isMobile ? 0 : 400 })
    } else {
      map.easeTo({ padding: leftPanelOpen ? panelPadding : zeroPadding, duration: 300 })
    }
  }, [selectedNode, leftPanelOpen, isMobile])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const set = () => {
      if (map.getLayer('linz-aerial-layer')) {
        map.setLayoutProperty('linz-aerial-layer', 'visibility', showAerial ? 'visible' : 'none')
      }
    }
    map.isStyleLoaded() ? set() : map.once('load', set)
  }, [showAerial])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        role="group"
        aria-label="Map style"
        className="toggle-group toggle-group--map"
        style={{ position: 'absolute', top: 10, left: (!isMobile && leftPanelOpen) ? panelWidth + 10 : 10, zIndex: 10 }}
      >
        {(['street', 'aerial'] as const).map((mode) => (
          <button key={mode} onClick={() => setShowAerial(mode === 'aerial')} aria-pressed={(mode === 'aerial') === showAerial}>
            {mode === 'street' ? 'Street' : 'Satellite'}
          </button>
        ))}
      </div>
    </div>
  )
}
