import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDefinitions } from '../hooks/useDefinitions'
import { generatorsToGeoJson, substationsToGeoJson } from '../utils/geo'
import { MAPLIBRE_COLOUR_EXPRESSION } from '../utils/colours'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const INITIAL_CENTER: [number, number] = [172.5, -41.3]
const INITIAL_ZOOM = 5

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const { generators, substations } = useDefinitions()

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

      map.on('click', 'substations-layer', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const p = feature.properties as {
          siteId: string
          description: string
          type: string
          island: string
        }
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]

        new maplibregl.Popup()
          .setLngLat(coords)
          .setHTML(
            `<strong>${p.description}</strong><br/>
             <small>${p.siteId}</small><br/>
             ${p.type} · ${p.island === 'north' ? 'North Island' : 'South Island'}`
          )
          .addTo(map)
      })

      map.on('click', 'generators-layer', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const p = feature.properties as {
          name: string
          operator: string
          fuel: string
          totalCapacityMW: number
          site: string
        }
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]

        new maplibregl.Popup()
          .setLngLat(coords)
          .setHTML(
            `<strong>${p.name}</strong><br/>
             <small>${p.site}</small><br/>
             ${p.operator}<br/>
             ${p.fuel} · ${p.totalCapacityMW} MW`
          )
          .addTo(map)
      })

      for (const layer of ['substations-layer', 'generators-layer']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }
    })

    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || generators.length === 0) return

    const updateSource = () => {
      const source = map.getSource('generators') as maplibregl.GeoJSONSource | undefined
      source?.setData(generatorsToGeoJson(generators))
    }

    if (map.isStyleLoaded()) {
      updateSource()
    } else {
      map.once('load', updateSource)
    }
  }, [generators])

  useEffect(() => {
    const map = mapRef.current
    if (!map || substations.length === 0) return

    const updateSource = () => {
      const source = map.getSource('substations') as maplibregl.GeoJSONSource | undefined
      source?.setData(substationsToGeoJson(substations))
    }

    if (map.isStyleLoaded()) {
      updateSource()
    } else {
      map.once('load', updateSource)
    }
  }, [substations])

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />
}
