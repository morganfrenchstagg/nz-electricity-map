import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { generatorsToGeoJson, substationsToGeoJson } from '../utils/geo'
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
}

export default function Map({ onGeneratorClick, onSubstationClick, selectedNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const { generators, substations } = useDefinitions()
  const generatorsRef = useRef<Generator[]>(generators)
  const substationsRef = useRef<Substation[]>(substations)

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
        }
      })

      for (const layer of ['substations-layer', 'generators-layer']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
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

    if (selectedNode) {
      const [lng, lat] = selectedNode.kind === 'generator'
        ? [selectedNode.generator.location.long, selectedNode.generator.location.lat]
        : [selectedNode.substation.long, selectedNode.substation.lat]

      map.easeTo({
        center: [lng, lat],
        padding: { left: window.innerWidth * PANEL_WIDTH_VW, right: 0, top: 0, bottom: 0 },
        duration: 400,
      })
    } else {
      map.easeTo({
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
        duration: 300,
      })
    }
  }, [selectedNode])

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />
}
