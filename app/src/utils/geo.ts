import type { Generator, Substation } from '../types'

export function generatorsToGeoJson(generators: Generator[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = generators.map((g) => {
    const activeUnits = g.units.filter((u) => u.active !== false)
    const dominantFuel = activeUnits[0]?.fuel ?? g.units[0]?.fuel ?? 'Unknown'
    const totalCapacityMW = activeUnits.reduce((sum, u) => sum + u.capacity, 0)

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [g.location.long, g.location.lat],
      },
      properties: {
        site: g.site,
        name: g.name,
        operator: g.operator,
        fuel: dominantFuel,
        totalCapacityMW,
        island: g.island,
        gridZone: g.gridZone,
      },
    }
  })

  return { type: 'FeatureCollection', features }
}

export function substationsToGeoJson(substations: Substation[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = substations.map((s) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [s.long, s.lat],
    },
    properties: {
      siteId: s.siteId,
      description: s.description,
      type: s.type,
      island: s.island,
    },
  }))

  return { type: 'FeatureCollection', features }
}
