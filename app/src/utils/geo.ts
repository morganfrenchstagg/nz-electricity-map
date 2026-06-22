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

export interface UnderConstructionUnit {
  locationDescription: string | null
  fuel: string
  operator: string
  status: string
  capacityMW: number | null
  capacityMWp: number | null
  capacityMWh: number | null
  yearlyGenerationGWh: number | null
  openBy: string | null
}

export function ucUnitsForSite(nodes: UnderConstructionNode[], site: string): UnderConstructionUnit[] {
  if (!site) return []
  return nodes
    .filter(n => n.site === site)
    .map(n => ({
      locationDescription: n.locationDescription ?? null,
      fuel: n.fuel,
      operator: n.operator,
      status: n.status,
      capacityMW: n.capacityMW ?? null,
      capacityMWp: n.capacityMWp ?? null,
      capacityMWh: n.capacityMWh ?? null,
      yearlyGenerationGWh: n.yearlyGenerationGWh ?? null,
      openBy: n.openBy ?? null,
    }))
}

export function underConstructionToGeoJson(
  nodes: UnderConstructionNode[],
  generators: Generator[],
): GeoJSON.FeatureCollection {
  // Nodes whose site matches an existing generator are shown in the generator tooltip instead
  const generatorSites = new Set(generators.map(g => g.site))

  // Group nodes by resolved coordinates so co-located units share one feature
  const grouped = new Map<string, { lat: number; long: number; name: string; fuel: string; units: UnderConstructionUnit[] }>()

  for (const node of nodes) {
    if (node.site && generatorSites.has(node.site)) continue

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

    const key = `${lat},${long}`
    const existing = grouped.get(key)
    const unit: UnderConstructionUnit = {
      locationDescription: node.locationDescription ?? null,
      fuel: node.fuel,
      operator: node.operator,
      status: node.status,
      capacityMW: node.capacityMW ?? null,
      capacityMWp: node.capacityMWp ?? null,
      capacityMWh: node.capacityMWh ?? null,
      yearlyGenerationGWh: node.yearlyGenerationGWh ?? null,
      openBy: node.openBy ?? null,
    }
    if (existing) {
      existing.units.push(unit)
    } else {
      grouped.set(key, { lat, long, name: node.name, fuel: node.fuel, units: [unit] })
    }
  }

  const features: GeoJSON.Feature[] = [...grouped.values()].map(({ lat, long, name, fuel, units }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [long, lat] },
    properties: {
      name,
      fuel,
      units: JSON.stringify(units),
    },
  }))

  return { type: 'FeatureCollection', features }
}
