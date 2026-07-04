import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { generatorsToGeoJson, substationsToGeoJson, underConstructionToGeoJson, ucUnitsForSite } from '../utils/geo'
import { underConstruction } from '../../../frontend/utilities/underConstruction'
import { MAPLIBRE_COLOUR_EXPRESSION, MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION, fuelColour, voltageColour } from '../utils/colours'
import { formatMW } from '../utils/format'
import type { Generator, Substation, SelectedNode, RecentData } from '../types'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LINZ_AERIAL_URL = 'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=c01kw0f06zmga8j2dmxg0fjz0ny'
// todo - cache this in CF worker, so it's not as slow as arcgis is...
const TRANSMISSION_LINES_URL = 'https://services3.arcgis.com/AkUq3zcWf7TVqyR9/arcgis/rest/services/TransmissionLines/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson'
const INITIAL_CENTER: [number, number] = [172.5, -41.3]
const INITIAL_ZOOM = 5

const PANEL_WIDTH_VW = 0.5

interface Props {
  onGeneratorClick: (generator: Generator, shiftKey: boolean) => void
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
  const recentDataRef = useRef<RecentData | null>(null)
  const leftPanelOpenRef = useRef(leftPanelOpen)
  useEffect(() => { leftPanelOpenRef.current = leftPanelOpen }, [leftPanelOpen])
  const panelWidthRef = useRef(panelWidth)
  useEffect(() => { panelWidthRef.current = panelWidth }, [panelWidth])
  const isMobileRef = useRef(isMobile)
  useEffect(() => { isMobileRef.current = isMobile }, [isMobile])
  useEffect(() => { recentDataRef.current = recentData }, [recentData])

  useEffect(() => { generatorsRef.current = generators }, [generators])
  useEffect(() => { substationsRef.current = substations }, [substations])

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

      const STATUS_PILL_COLOURS: Record<string, { bg: string; text: string }> = {
        'Commissioning': { bg: '#dcfce7', text: '#15803d' },
        'Pre-Commissioning': { bg: '#d1fae5', text: '#065f46' },
        'Under Construction': { bg: '#fef3c7', text: '#92400e' },
        'Early Works': { bg: '#ffedd5', text: '#c2410c' },
        'Committed': { bg: '#dbeafe', text: '#1d4ed8' },
      }

      const renderUnitStats = (u: { capacityMW: number | null; capacityMWp: number | null; capacityMWh: number | null; yearlyGenerationGWh: number | null; openBy: string | null }) => {
        const capacityParts = [
          u.capacityMW ? `${u.capacityMW} MW` : null,
          u.capacityMWp ? `${u.capacityMWp} MWp` : null,
          u.capacityMWh ? `${u.capacityMWh} MWh` : null,
        ].filter(Boolean).join(' / ')
        return [
          capacityParts ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#888">Capacity</span><span>${capacityParts}</span></div>` : '',
          u.yearlyGenerationGWh ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#888">Annual generation</span><span>${u.yearlyGenerationGWh} GWh</span></div>` : '',
          u.openBy ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#888">Expected open</span><span>${new Date(u.openBy).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}</span></div>` : '',
        ].filter(Boolean).join('')
      }

      const renderStatusPill = (status: string) => {
        const pillColour = STATUS_PILL_COLOURS[status] ?? { bg: '#f3f4f6', text: '#374151' }
        return status
          ? `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${pillColour.bg};color:${pillColour.text};font-size:11px;font-weight:500;flex-shrink:0">${status}</span>`
          : ''
      }

      // Single mousemove handler with explicit priority: generators > under-construction > substations.
      // This prevents a nearby substation from stealing the popup when the cursor is over a generator.
      map.on('mousemove', (e) => {
        const canvas = map.getCanvas()

        // 1. Generators (highest priority)
        const genFeatures = map.queryRenderedFeatures(e.point, { layers: ['generators-layer'] })
        if (genFeatures.length > 0) {
          const site = genFeatures[0].properties?.site as string | undefined
          const generator = generatorsRef.current.find(g => g.site === site)
          if (generator) {
            canvas.style.cursor = 'pointer'
            const data = recentDataRef.current
            const lastRow = data?.data[data.data.length - 1]
            const activeUnits = generator.units.filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name))
            const unitRows = activeUnits.map(u => {
              const idx = data ? data.series.indexOf(u.node) : -1
              const genMW = (idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : null
              const pct = genMW !== null && u.capacity !== 0 ? Math.min(100, Math.round((Math.abs(genMW) / Math.abs(u.capacity)) * 100)) : 0
              const colour = fuelColour(u.fuel)
              const genStr = genMW !== null ? formatMW(genMW) : '—'
              const isGenerating = (genMW ?? 0) !== 0
              return `<div style="margin-bottom:5px">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="width:8px;height:8px;border-radius:50%;background:${colour};flex-shrink:0"></span>
                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isGenerating ? '#222' : '#999'}">${u.fuel === 'Battery (Charging)' ? `${u.name} <span style="color:#888">(charging)</span>` : u.name}</span>
                  <span style="color:${isGenerating ? '#222' : '#999'};white-space:nowrap;font-weight:${isGenerating ? '600' : '400'}">${genStr}</span>
                </div>
                <div style="height:3px;background:#e8e8e8;border-radius:2px;margin-top:3px;margin-left:14px">
                  <div style="height:3px;width:${pct}%;background:${colour};border-radius:2px"></div>
                </div>
              </div>`
            }).join('')
            const totalGen = activeUnits.reduce((sum, u) => {
              const idx = data ? data.series.indexOf(u.node) : -1
              return sum + ((idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : 0)
            }, 0)
            const totalCap = activeUnits.filter(u => u.fuelCode !== 'BESS-C').reduce((sum, u) => sum + u.capacity, 0)
            const totalPct = totalCap > 0 ? Math.min(100, Math.round((totalGen / totalCap) * 100)) : 0
            const ucUnits = generator.site ? ucUnitsForSite(underConstruction, generator.site) : []
            const ucSection = ucUnits.length > 0 ? `
              <div style="border-top:1px solid #eee;padding-top:6px;margin-top:2px">
                <div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Under Construction</div>
                ${ucUnits.map((u, i) => {
                  const label = u.locationDescription ?? `Unit ${i + 1}`
                  const stats = renderUnitStats(u)
                  return `<div style="${i > 0 ? 'margin-top:6px;border-top:1px solid #f3f3f3;padding-top:6px' : ''}">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                      <span style="font-weight:500">${label}</span>${renderStatusPill(u.status)}
                    </div>
                    ${stats}
                  </div>`
                }).join('')}
              </div>` : ''
            hoverPopup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.5;width:240px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1px">
                <span style="font-weight:600">${generator.name}</span>
                <span style="background:#e8f0fe;color:#1a56db;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;flex-shrink:0">${generator.site}</span>
              </div>
              <div style="color:#888;margin-bottom:6px">${generator.operator}</div>
              <div style="border-top:1px solid #eee;padding-top:6px;margin-bottom:4px">${unitRows}</div>
              <div style="border-top:1px solid #eee;padding-top:6px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#888">Total</span>
                  <span style="font-weight:600">${formatMW(totalGen)} <span style="font-weight:400;color:#888">/ ${formatMW(totalCap)} (${totalPct}%)</span></span>
                </div>
              </div>
              ${ucSection}
            </div>`).addTo(map)
            return
          }
        }

        // 2. Under-construction markers
        const ucFeatures = map.queryRenderedFeatures(e.point, { layers: ['under-construction-layer'] })
        if (ucFeatures.length > 0) {
          const p = ucFeatures[0].properties as Record<string, string | null>
          type Unit = { locationDescription: string | null; operator: string; status: string; capacityMW: number | null; capacityMWp: number | null; capacityMWh: number | null; yearlyGenerationGWh: number | null; openBy: string | null }
          const units: Unit[] = JSON.parse(p.units ?? '[]')
          const name = String(p.name ?? '')
          let html: string
          if (units.length === 1) {
            const u = units[0]
            const label = u.locationDescription ? `${name} <span style="font-weight:400;color:#888">(${u.locationDescription})</span>` : name
            const stats = renderUnitStats(u)
            html = `<div style="font-size:12px;line-height:1.6;width:260px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px"><span style="font-weight:600">${label}</span>${renderStatusPill(u.status)}</div>
              <div style="color:#888">${u.operator}</div>
              ${stats ? `<div style="margin-top:4px;border-top:1px solid #eee;padding-top:4px">${stats}</div>` : ''}
            </div>`
          } else {
            const unitRows = units.map((u, i) => {
              const label = u.locationDescription ?? `Unit ${i + 1}`
              const stats = renderUnitStats(u)
              return `<div style="${i > 0 ? 'margin-top:6px;border-top:1px solid #eee;padding-top:6px' : ''}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:500">${label}</span>${renderStatusPill(u.status)}</div>
                ${stats}
              </div>`
            }).join('')
            html = `<div style="font-size:12px;line-height:1.6;width:260px">
              <div style="font-weight:600;margin-bottom:2px">${name}</div>
              <div style="color:#888;margin-bottom:6px">${units[0].operator}</div>
              ${unitRows}
            </div>`
          }
          canvas.style.cursor = 'pointer'
          hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map)
          return
        }

        // 3. Substations (lowest priority)
        const subFeatures = map.queryRenderedFeatures(e.point, { layers: ['substations-layer'] })
        if (subFeatures.length > 0) {
          const siteId = subFeatures[0].properties?.siteId as string | undefined
          const substation = substationsRef.current.find(s => s.siteId === siteId)
          if (substation) {
            canvas.style.cursor = 'pointer'
            const data = recentDataRef.current
            const lastRow = data?.data[data.data.length - 1]
            const codes = data ? data.series.filter(s => s.startsWith(substation.siteId)) : []
            const busCodes = codes.filter(c => !c.includes(' '))
            const genCodes = codes.filter(c => c.includes(' '))
            const renderRow = (code: string, label: string, colour: string, loadMW: number | null) => {
              const isActive = (loadMW ?? 0) !== 0
              const loadStr = loadMW !== null ? formatMW(loadMW) : '—'
              return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                <span style="width:8px;height:8px;border-radius:50%;background:${colour};flex-shrink:0"></span>
                <span style="flex:1;color:${isActive ? '#222' : '#999'}">${label}</span>
                <span style="color:${isActive ? '#222' : '#999'};font-weight:${isActive ? '600' : '400'};white-space:nowrap">${loadStr}</span>
              </div>`
            }
            const busRows = busCodes.map(code => {
              const idx = data ? data.series.indexOf(code) : -1
              const loadMW = (idx !== -1 && lastRow) ? -((lastRow[idx + 1] as number) || 0) : null
              const kv = code.length >= 4 ? parseInt(code.slice(-4, -1), 10) : NaN
              const busNum = code.length >= 1 ? parseInt(code.slice(-1), 10) : NaN
              const label = !isNaN(kv) && !isNaN(busNum) ? `${kv}kV – ${busNum}` : code
              return renderRow(code, label, voltageColour(kv), loadMW)
            }).join('')
            const allUnits = generatorsRef.current.flatMap(g => g.units)
            const genRows = genCodes
              .map(code => ({ code, unit: allUnits.find(u => u.node === code) }))
              .sort((a, b) => (a.unit?.name ?? a.code).localeCompare(b.unit?.name ?? b.code))
              .map(({ code, unit }) => {
                const idx = data ? data.series.indexOf(code) : -1
                const genMW = (idx !== -1 && lastRow) ? ((lastRow[idx + 1] as number) || 0) : null
                const label = unit ? (unit.fuel === 'Battery (Charging)' ? `${unit.name} <span style="color:#888">(charging)</span>` : unit.name) : code
                const colour = unit ? fuelColour(unit.fuel) : '#888'
                return renderRow(code, label, colour, genMW)
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
            hoverPopup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.5;width:240px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1px">
                <span style="font-weight:600">${substation.description} Substation</span>
                <span style="background:#f3f4f6;color:#374151;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;flex-shrink:0">${substation.siteId}</span>
              </div>
              ${codes.length > 0 ? `
              <div style="border-top:1px solid #eee;padding-top:6px;margin-top:6px">${busRows}</div>
              ${genRows ? `<div style="border-top:1px solid #eee;padding-top:6px;margin-top:2px">
                <div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Generation</div>
                ${genRows}
              </div>` : ''}
              <div style="border-top:1px solid #eee;padding-top:6px;margin-top:2px;display:flex;justify-content:space-between;align-items:center">
                <span style="color:#888">Net load</span>
                <span style="font-weight:600">${formatMW(netLoad)}</span>
              </div>` : '<div style="color:#999;margin-top:4px">No data</div>'}
            </div>`).addTo(map)
            return
          }
        }

        // Nothing under cursor — clear popup and cursor
        canvas.style.cursor = ''
        hoverPopup.remove()
      })

      map.getCanvas().addEventListener('mouseleave', () => {
        map.getCanvas().style.cursor = ''
        hoverPopup.remove()
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
      <div style={{
        position: 'absolute',
        top: 10,
        left: (!isMobile && leftPanelOpen) ? panelWidth + 10 : 10,
        zIndex: 10,
        display: 'flex',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        border: '1px solid #ccc',
      }}>
        {(['street', 'aerial'] as const).map((mode, i) => (
          <button
            key={mode}
            onClick={() => setShowAerial(mode === 'aerial')}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              borderLeft: i > 0 ? '1px solid #ccc' : 'none',
              background: (mode === 'aerial') === showAerial ? '#1d4ed8' : 'white',
              color: (mode === 'aerial') === showAerial ? 'white' : '#333',
            }}
          >
            {mode === 'street' ? 'Street' : 'Satellite'}
          </button>
        ))}
      </div>
    </div>
  )
}
