import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { useOutages } from '../hooks/useOutages'
import { isLiveMode, isPastMode, periodOf } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { generatorsToGeoJson, substationsToGeoJson, underConstructionToGeoJson } from '../utils/geo'
import { underConstruction } from '../data/underConstruction'
import { MAPLIBRE_COLOUR_EXPRESSION, MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION } from '../utils/colours'
import { unitsByNode } from '../utils/generators'
import { HVDC_CABLE, HVDC_CABLE_ANGLE, HVDC_CABLE_MIDDLE, hvdcDirection, latestHvdcNorth } from '../utils/hvdc'
import { generatorPopupHtml, hvdcPopupHtml, substationPopupHtml, underConstructionPopupHtml } from './mapPopups'
import { TRANSMISSION_LINES_URL } from '../api'
import { DATA_ATTRIBUTION_HTML } from '../attribution'
import type { OutageData } from '../api'
import type { InitialView } from '../utils/mapView'
import type { Generator, Substation, SelectedNode, RecentData } from '../types'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LINZ_AERIAL_URL = 'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=c01kw0f06zmga8j2dmxg0fjz0ny'
const INITIAL_CENTER: [number, number] = [172.5, -41.3]
const INITIAL_ZOOM = 5

// The HVDC's hover areas, wider than its lines: its overhead line, and its cables across Cook Strait
const HVDC_HOVER_LAYERS = ['hvdc-line-hover-layer', 'hvdc-cables-hover-layer']

// Hoverable layers in priority order: generators > under-construction > substations > HVDC.
// This prevents a nearby substation from stealing the popup when the cursor is over a generator,
// and the HVDC from stealing it from the stations along it.
const HOVER_LAYERS = ['generators-layer', 'under-construction-layer', 'substations-layer', ...HVDC_HOVER_LAYERS]

// Each hoverable source promotes its id property to the feature id, so this names the feature
// under the cursor and the popup is only rebuilt when it changes. The HVDC's popup is the same
// all along it, so it's one feature.
const hoverKey = (feature?: maplibregl.MapGeoJSONFeature) =>
  feature && (HVDC_HOVER_LAYERS.includes(feature.layer.id) ? 'hvdc' : `${feature.layer.id}:${feature.id}`)

// What the open panel is for: circled, or for the HVDC, its lines in this colour
const SELECTED_COLOUR = '#3b82f6'

// The HVDC's overhead line, the only one at 350 kV
const HVDC_LINE_FILTER: maplibregl.ExpressionSpecification = ['==', ['to-number', ['get', 'designvolt']], 350]

// The HVDC's lines, and the chevrons on its cables for the way it's flowing. Darker
// than the grey of the voltages without a colour of their own, to stand out.
const HVDC_COLOUR = '#5f6b6d'
const HVDC_HALO = 'rgba(255,255,255,0.8)'

// The chevrons show once Cook Strait is wide enough on the map to hold them
const HVDC_CHEVRONS_MIN_ZOOM = 7.5

// Three chevrons pointing east, each over a white halo to stand out on the cables and
// the satellite map. They're lit in turn the way they point (see index.css).
const HVDC_CHEVRONS_SVG = `<svg width="44" height="20" viewBox="0 0 44 20" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
  [7, 18, 29].map((x) => {
    const d = `M${x} 4 L${x + 8} 10 L${x} 16`
    return `<g><path d="${d}" stroke="${HVDC_HALO}" stroke-width="7"/><path d="${d}" stroke="${HVDC_COLOUR}" stroke-width="3.5"/></g>`
  }).join('')
}</svg>`

// The generation pipeline is what's being built now, so past days and ranges leave it off the map
const pipelineFor = (mode: DateMode) => isPastMode(mode) ? [] : underConstruction

interface Props {
  onGeneratorClick: (generator: Generator) => void
  onSubstationClick: (substation: Substation) => void
  onHvdcClick: () => void
  onClear: () => void
  selectedNode: SelectedNode
  leftPanelOpen: boolean
  panelWidth: number
  // Where the map opens beside the panel, in place of INITIAL_CENTER and INITIAL_ZOOM
  initialView?: Pick<InitialView, 'center' | 'zoom'> | null
  recentData: RecentData | null
  // The generators in service during it are on the map, and Today and 3d keep
  // outages up to date (see useOutages)
  dateMode: DateMode
  isMobile?: boolean
}

export default function Map({ onGeneratorClick, onSubstationClick, onHvdcClick, onClear, selectedNode, leftPanelOpen, panelWidth, initialView, recentData, dateMode, isMobile = false }: Props) {
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
  // Set once the load handler has added the map's sources and layers
  const mapLoadedRef = useRef(false)
  const hvdcFlowMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Runs `update` once the sources are added. Not isStyleLoaded(), which is false again
  // while a source reloads after setData, and 'load' doesn't fire again to run it then.
  const whenLoaded = (map: maplibregl.Map, update: () => void) => mapLoadedRef.current ? update() : map.once('load', update)
  const leftPanelOpenRef = useRef(leftPanelOpen)
  useEffect(() => { leftPanelOpenRef.current = leftPanelOpen }, [leftPanelOpen])
  const panelWidthRef = useRef(panelWidth)
  useEffect(() => { panelWidthRef.current = panelWidth }, [panelWidth])
  const isMobileRef = useRef(isMobile)
  useEffect(() => { isMobileRef.current = isMobile }, [isMobile])
  // Ahead of recentData's, so a popup refreshed for a new day's data shows that day's units
  const dateModeRef = useRef(dateMode)
  useEffect(() => { dateModeRef.current = dateMode }, [dateMode])
  useEffect(() => {
    recentDataRef.current = recentData
    refreshHoverRef.current()
  }, [recentData])
  const outages = useOutages(isLiveMode(dateMode))
  // The nodes dispatching in the live views, where units still being commissioned are shown once they are
  const dispatching = useMemo(
    () => isLiveMode(dateMode) && recentData ? new Set(recentData.series) : undefined,
    [dateMode, recentData],
  )
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
  const onHvdcClickRef = useRef(onHvdcClick)
  const onClearRef = useRef(onClear)
  useEffect(() => { onGeneratorClickRef.current = onGeneratorClick }, [onGeneratorClick])
  useEffect(() => { onSubstationClickRef.current = onSubstationClick }, [onSubstationClick])
  useEffect(() => { onHvdcClickRef.current = onHvdcClick }, [onHvdcClick])
  useEffect(() => { onClearRef.current = onClear }, [onClear])

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: initialView?.center ?? INITIAL_CENTER,
      zoom: initialView?.zoom ?? INITIAL_ZOOM,
      attributionControl: { compact: true, customAttribution: DATA_ATTRIBUTION_HTML },
    })
    // Compact attribution starts open until the map is first dragged; start on just its ⓘ button
    map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // The chevrons on the HVDC's cables for the way it's flowing, added to the map while
    // em6 has a flow (see hvdcFlow below). A marker, so the browser animates them without
    // the map redrawing every frame. Turned with the map, to lie along the cables.
    const chevrons = document.createElement('div')
    chevrons.className = 'hvdc-flow'
    chevrons.innerHTML = HVDC_CHEVRONS_SVG
    hvdcFlowMarkerRef.current = new maplibregl.Marker({ element: chevrons, rotationAlignment: 'map' }).setLngLat(HVDC_CABLE_MIDDLE)
    const showChevrons = () => chevrons.classList.toggle('is-hidden', map.getZoom() < HVDC_CHEVRONS_MIN_ZOOM)
    showChevrons()
    map.on('zoom', showChevrons)

    map.on('load', () => {
      if (leftPanelOpenRef.current && !isMobileRef.current) {
        map.setPadding({ left: panelWidthRef.current, right: 0, top: 0, bottom: 0 })
      }

      map.addSource('linz-aerial', {
        type: 'raster',
        tiles: [LINZ_AERIAL_URL],
        tileSize: 256,
        // Credited in DATA_ATTRIBUTION_HTML, so it shows in either map style
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
      // The HVDC, from Benmore to Haywards, thicker than the other lines to be easier to see,
      // and outlined in white for the satellite map. Beneath the other lines, so it doesn't
      // cover them where they meet or run alongside it. Its undersea cables, which the
      // transmission lines leave out, carry its overhead line across Cook Strait, dashed as
      // they're under the sea.
      map.addSource('hvdc-cables', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: HVDC_CABLE }, properties: {} },
      })
      const hvdcOutline: maplibregl.LineLayerSpecification['paint'] = { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.7 }
      map.addLayer({ id: 'hvdc-line-outline-layer', type: 'line', source: 'transmission-lines', filter: HVDC_LINE_FILTER, layout: { 'line-cap': 'round' }, paint: hvdcOutline })
      map.addLayer({ id: 'hvdc-cables-outline-layer', type: 'line', source: 'hvdc-cables', layout: { 'line-cap': 'round' }, paint: hvdcOutline })
      map.addLayer({
        id: 'hvdc-line-layer',
        type: 'line',
        source: 'transmission-lines',
        filter: HVDC_LINE_FILTER,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': HVDC_COLOUR, 'line-width': 3 },
      })
      map.addLayer({
        id: 'hvdc-cables-layer',
        type: 'line',
        source: 'hvdc-cables',
        paint: { 'line-color': HVDC_COLOUR, 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({
        id: 'transmission-lines-layer',
        type: 'line',
        source: 'transmission-lines',
        filter: ['!', HVDC_LINE_FILTER], // drawn on its own, just beneath
        paint: {
          'line-color': MAPLIBRE_VOLTAGE_COLOUR_EXPRESSION,
          'line-width': 1.5,
          'line-opacity': 0.7,
        },
      })
      // Hovering anywhere along the HVDC shows its flow. Unseen, and wider than its lines
      // to be easier to find.
      const hvdcHoverPaint: maplibregl.LineLayerSpecification['paint'] = { 'line-color': '#000000', 'line-width': 10, 'line-opacity': 0 }
      map.addLayer({
        id: 'hvdc-line-hover-layer',
        type: 'line',
        source: 'transmission-lines',
        filter: HVDC_LINE_FILTER,
        paint: hvdcHoverPaint,
      })
      map.addLayer({ id: 'hvdc-cables-hover-layer', type: 'line', source: 'hvdc-cables', paint: hvdcHoverPaint })

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
          'circle-stroke-color': SELECTED_COLOUR,
        },
      })
      mapLoadedRef.current = true

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

        // Then the HVDC, anywhere along it
        if (map.queryRenderedFeatures(e.point, { layers: HVDC_HOVER_LAYERS }).length > 0) {
          onHvdcClickRef.current()
          return
        }

        onClearRef.current()
      })

      const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '380px' })
      let hovered: maplibregl.MapGeoJSONFeature | undefined

      const hoverHtml = (feature: maplibregl.MapGeoJSONFeature): string | null => {
        const p = feature.properties
        if (feature.layer.id === 'generators-layer') {
          const generator = generatorsRef.current.find(g => g.site === p.site)
          return generator ? generatorPopupHtml(generator, recentDataRef.current, outagesRef.current, periodOf(dateModeRef.current), isLiveMode(dateModeRef.current), pipelineFor(dateModeRef.current)) : null
        }
        if (feature.layer.id === 'under-construction-layer') {
          return underConstructionPopupHtml(String(p.name ?? ''), JSON.parse(p.units ?? '[]'))
        }
        // None on past days, as their dispatch has no HVDC
        if (HVDC_HOVER_LAYERS.includes(feature.layer.id)) {
          const transfer = latestHvdcNorth(recentDataRef.current)
          return transfer && hvdcPopupHtml(transfer)
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
      src?.setData(generatorsToGeoJson(generators, periodOf(dateMode), dispatching))
    }
    whenLoaded(map, update)
  }, [generators, dateMode, dispatching])

  useEffect(() => {
    const map = mapRef.current
    if (!map || generators.length === 0) return
    const update = () => {
      const src = map.getSource('under-construction') as maplibregl.GeoJSONSource | undefined
      src?.setData(underConstructionToGeoJson(pipelineFor(dateMode), generators, periodOf(dateMode), dispatching))
    }
    whenLoaded(map, update)
  }, [generators, dateMode, dispatching])

  // The chevrons point east along the cables for a flow north, as the North Island is
  // to the right of Cook Strait, or west for a flow south. Past days' dispatch has no
  // HVDC, so they have none.
  const hvdcFlow = hvdcDirection(latestHvdcNorth(recentData))
  useEffect(() => {
    const map = mapRef.current
    const marker = hvdcFlowMarkerRef.current
    if (!map || !marker) return
    if (!hvdcFlow) { marker.remove(); return }
    // Marker rotation is clockwise, and the cables run anticlockwise of east
    marker.setRotation((hvdcFlow === 'north' ? 0 : 180) - HVDC_CABLE_ANGLE).addTo(map)
  }, [hvdcFlow])

  useEffect(() => {
    const map = mapRef.current
    if (!map || substations.length === 0) return
    const update = () => {
      const src = map.getSource('substations') as maplibregl.GeoJSONSource | undefined
      src?.setData(substationsToGeoJson(substations))
    }
    whenLoaded(map, update)
  }, [substations])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => {
      const src = map.getSource('selected-node') as maplibregl.GeoJSONSource | undefined
      if (!src) return
      // The HVDC is picked out in the selection's blue rather than circled
      const hvdcColour = selectedNode?.kind === 'hvdc' ? SELECTED_COLOUR : HVDC_COLOUR
      for (const layer of ['hvdc-line-layer', 'hvdc-cables-layer']) map.setPaintProperty(layer, 'line-color', hvdcColour)
      if (!selectedNode || selectedNode.kind === 'hvdc') {
        src.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const points: [number, number][] =
        selectedNode.kind === 'generator' ? [[selectedNode.generator.location.long, selectedNode.generator.location.lat]]
          : selectedNode.kind === 'generators' ? selectedNode.generators.map(g => [g.location.long, g.location.lat])
            : [[selectedNode.substation.long, selectedNode.substation.lat]]
      src.setData({ type: 'FeatureCollection', features: points.map(coords => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} })) })
    }
    whenLoaded(map, update)
  }, [selectedNode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const panelPadding = isMobile ? { left: 0, right: 0, top: 0, bottom: 0 } : { left: panelWidthRef.current, right: 0, top: 0, bottom: 0 }
    const zeroPadding = { left: 0, right: 0, top: 0, bottom: 0 }

    // The HVDC runs the length of the South Island, so the map stays where it was clicked
    if (selectedNode && selectedNode.kind !== 'hvdc') {
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
    whenLoaded(map, set)
  }, [showAerial])

  // How much of the map's left side the panel covers
  const panelInset = (!isMobile && leftPanelOpen) ? panelWidth : 0

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', '--map-panel-inset': `${panelInset}px` } as React.CSSProperties}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        role="group"
        aria-label="Map style"
        className="toggle-group toggle-group--map"
        style={{ position: 'absolute', top: 10, left: panelInset + 10, zIndex: 10 }}
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
