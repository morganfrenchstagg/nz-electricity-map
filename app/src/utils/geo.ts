import type { Generator, Substation } from '../types'
import type { UnderConstructionNode } from '../../../frontend/utilities/underConstruction'

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

export function underConstructionToGeoJson(
  nodes: UnderConstructionNode[],
  generators: Generator[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []

  for (const node of nodes) {
    let lat: number | undefined
    let long: number | undefined

    if (node.location) {
      lat = node.location.lat
      long = node.location.long
    } else if (node.site) {
      const gen = generators.find((g) => g.site === node.site)
      if (gen) { lat = gen.location.lat; long = gen.location.long }
    }

    if (lat === undefined || long === undefined) continue

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [long, lat] },
      properties: {
        name: node.name,
        locationDescription: node.locationDescription ?? null,
        fuel: node.fuel,
        operator: node.operator,
        status: node.status,
        capacityMW: node.capacityMW ?? null,
        capacityMWp: node.capacityMWp ?? null,
        capacityMWh: node.capacityMWh ?? null,
        yearlyGenerationGWh: node.yearlyGenerationGWh ?? null,
        openBy: node.openBy ?? null,
      },
    })
  }

  return { type: 'FeatureCollection', features }
}
