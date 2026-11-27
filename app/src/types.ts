export interface Unit {
  name: string
  unitCode: string
  node: string
  capacity: number
  fuel: string
  fuelCode: string
  // Service start and end, as ISO instants (see utils/generators)
  commissioned?: string
  decomissioned?: string
  installedCapacity?: number
  outageBlock?: string
  // Nodes of units this one stands in for while they're only metered together (as Southdown's
  // two were), until it's decommissioned. The units it combines hold its capacity (see combinedUnitOf).
  combines?: string[]
}

export interface Generator {
  site: string
  name: string
  units: Unit[]
  location: { lat: number; long: number }
  gridZone: string
  island: 'NI' | 'SI'
  operator: string
  secondaryOperator?: string
  scheme?: string
  alias?: string
}

export interface Substation {
  siteId: string
  description: string
  lat: number
  long: number
  type: 'ACSTN' | 'TEE'
  gridZone: number
  island: 'north' | 'south'
}

// A pipeline project (see data/underConstruction). Mapped at its location, or else with the
// generator at its site.
export interface UnderConstructionNode {
  name: string
  locationDescription?: string
  site?: string
  substation?: string
  fuel: string
  operator: string
  status: string
  costMillionDollars?: number
  capacityMW?: number
  capacityMWp?: number
  capacityMWh?: number
  yearlyGenerationGWh?: number
  openBy?: string
  link?: string
  location?: { lat: number; long: number }
}

export interface RecentData {
  series: string[]
  data: (string | number)[][]
  pricing: (string | number | null)[][] // null where a node has no price
  hvdc?: HvdcData
}

// HVDC flows and transfer limits (MW), a row per half hour: NZ time, then northFlow, southFlow,
// northLimit, southLimit (as named in `series`), null where missing. dispatch/recent has em6's
// last day; a past dispatch/:date has EMI's metered flows once published, with em6's limits,
// kept only from October 2026. em6 gives the south limit as negative.
//
// On aggregate views, a row per period, timestamped like the dispatch rows, with the MWh sent
// northFlow and southFlow (see useAggregates).
export interface HvdcData {
  series: string[]
  data: (string | number | null)[][]
}

// A generator, or several picked together (see NodePickerModal)
export type GeneratorNode =
  { kind: 'generator'; generator: Generator } | { kind: 'generators'; generators: Generator[] }

// A substation, or several picked together (see NodePickerModal)
export type SubstationNode =
  { kind: 'substation'; substation: Substation } | { kind: 'substations'; substations: Substation[] }

// The HVDC link between the islands, picked from the map (see HvdcPanel)
export type HvdcNode = { kind: 'hvdc' }

export type SelectedNode = GeneratorNode | SubstationNode | HvdcNode | null
