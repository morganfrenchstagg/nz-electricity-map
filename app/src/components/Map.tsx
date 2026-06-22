import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { generatorsToGeoJson, substationsToGeoJson, underConstructionToGeoJson } from '../utils/geo'
import { underConstruction } from '../../../frontend/utilities/underConstruction'
import { MAPLIBRE_COLOUR_EXPRESSION, MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION } from '../utils/colours'
import type { Generator, Substation, SelectedNode } from '../types'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
// todo - cache this in CF worker, so it's not as slow as arcgis is...
const TRANSMISSION_LINES_URL = 'https://services3.arcgis.com/AkUq3zcWf7TVqyR9/arcgis/rest/services/TransmissionLines/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson'
const INITIAL_CENTER: [number, number] = [172.5, -41.3]
const INITIAL_ZOOM = 5

const PANEL_WIDTH_VW = 0.5

interface Props {
  onGeneratorClick: (generator: Generator) => void
  onSubstationClick: (substation: Substation) => void
  selectedNode: SelectedNode
  leftPanelOpen: boolean
}

export default function Map({ onGeneratorClick, onSubstationClick, selectedNode, leftPanelOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const { generators, substations } = useDefinitions()
  const generatorsRef = useRef<Generator[]>(generators)
  const substationsRef = useRef<Substation[]>(substations)
  const leftPanelOpenRef = useRef(leftPanelOpen)
  useEffect(() => { leftPanelOpenRef.current = leftPanelOpen }, [leftPanelOpen])

  useEffect(() => { generatorsRef.current = generators }, [generators])
  useEffect(() => { substationsRef.current = substations }, [substations])

  // Keep callback refs so map event handlers always see the latest callbacks
  const onGeneratorClickRef = useRef(onGeneratorClick)
  const onSubstationClickRef = useRef(onSubstationClick)
  useEffect(() => { onGeneratorClickRef.current = onGeneratorClick }, [onGeneratorClick])
  useEffect(() => { onSubstationClickRef.current = onSubstationClick }, [onSubstationClick])

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
      if (leftPanelOpenRef.current) {
        map.setPadding({ left: window.innerWidth * PANEL_WIDTH_VW, right: 0, top: 0, bottom: 0 })
      }

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

      })

      for (const layer of ['substations-layer', 'generators-layer', 'under-construction-layer']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }

      let hoverPopup: maplibregl.Popup | null = null

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
          u.yearlyGenerationGWh ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#888">Annual</span><span>${u.yearlyGenerationGWh} GWh</span></div>` : '',
          u.openBy ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#888">Expected open</span><span>${new Date(u.openBy).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}</span></div>` : '',
        ].filter(Boolean).join('')
      }

      const renderStatusPill = (status: string) => {
        const pillColour = STATUS_PILL_COLOURS[status] ?? { bg: '#f3f4f6', text: '#374151' }
        return status
          ? `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${pillColour.bg};color:${pillColour.text};font-size:11px;font-weight:500;flex-shrink:0">${status}</span>`
          : ''
      }

      map.on('mouseenter', 'under-construction-layer', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const p = feature.properties as Record<string, string | null>
        const lngLat = feature.geometry.type === 'Point'
          ? (feature.geometry.coordinates as [number, number])
          : e.lngLat

        type Unit = { locationDescription: string | null; operator: string; status: string; capacityMW: number | null; capacityMWp: number | null; capacityMWh: number | null; yearlyGenerationGWh: number | null; openBy: string | null }
        const units: Unit[] = JSON.parse(p.units ?? '[]')
        const name = String(p.name ?? '')

        let html: string
        if (units.length === 1) {
          const u = units[0]
          const label = u.locationDescription ? `${name} <span style="font-weight:400;color:#888">(${u.locationDescription})</span>` : name
          const stats = renderUnitStats(u)
          html = `<div style="font-size:12px;line-height:1.6;min-width:160px">
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
          html = `<div style="font-size:12px;line-height:1.6;min-width:180px">
            <div style="font-weight:600;margin-bottom:2px">${name}</div>
            <div style="color:#888;margin-bottom:6px">${units[0].operator}</div>
            ${unitRows}
          </div>`
        }

        hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map)
      })

      map.on('mouseleave', 'under-construction-layer', () => {
        hoverPopup?.remove()
        hoverPopup = null
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

    const panelPadding = { left: window.innerWidth * PANEL_WIDTH_VW, right: 0, top: 0, bottom: 0 }
    const zeroPadding = { left: 0, right: 0, top: 0, bottom: 0 }

    if (selectedNode) {
      const [lng, lat] = selectedNode.kind === 'generator'
        ? [selectedNode.generator.location.long, selectedNode.generator.location.lat]
        : [selectedNode.substation.long, selectedNode.substation.lat]

      map.easeTo({ center: [lng, lat], padding: panelPadding, duration: 400 })
    } else {
      map.easeTo({ padding: leftPanelOpen ? panelPadding : zeroPadding, duration: 300 })
    }
  }, [selectedNode, leftPanelOpen])

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />
}
