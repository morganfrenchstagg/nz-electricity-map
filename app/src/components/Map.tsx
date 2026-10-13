import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { useOutages } from '../hooks/useOutages'
import { generatorsToGeoJson, substationsToGeoJson, underConstructionToGeoJson } from '../utils/geo'
import { underConstruction } from '../../../frontend/old/utilities/underConstruction'
import { MAPLIBRE_COLOUR_EXPRESSION, MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION } from '../utils/colours'
import { unitsByNode } from '../utils/generators'
import { generatorPopupHtml, substationPopupHtml, underConstructionPopupHtml } from './mapPopups'
import { TRANSMISSION_LINES_URL } from '../api'
import type { OutageData } from '../api'
import type { Generator, Substation, SelectedNode, RecentData } from '../types'

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
  const outages = useOutages()
  const outagesRef = useRef<OutageData | null>(outages)
  useEffect(() => {
    outagesRef.current = outages
    refreshHoverRef.current()
  }, [outages])

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
          return generator ? generatorPopupHtml(generator, recentDataRef.current, outagesRef.current) : null
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
