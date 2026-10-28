export interface Unit {
  name: string
  unitCode: string
  node: string
  capacity: number
  fuel: string
  fuelCode: string
  // When the unit came into and went out of service, as ISO instants (see utils/generators)
  commissioned?: string
  decomissioned?: string
  installedCapacity?: number
  outageBlock?: string
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

// A generation project in the pipeline (see data/underConstruction). It sits
// on the map at its location, or else with the generator at its site.
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
  hvdc?: HvdcData // only from dispatch/recent
}

// em6's HVDC flows and transfer limits (MW) over the last day, a row for each
// half hour: its NZ time, then northFlow, southFlow, northLimit and southLimit
// (as named in `series`), or null where em6 has none. The south limit is negative.
export interface HvdcData {
  series: string[]
  data: (string | number | null)[][]
}

// A generator, or several picked together (see NodePickerModal)
export type GeneratorNode =
  | { kind: 'generator'; generator: Generator }
  | { kind: 'generators'; generators: Generator[] }

export type SubstationNode = { kind: 'substation'; substation: Substation }

export type SelectedNode = GeneratorNode | SubstationNode | null
